const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { createCustomerAuthRouter } = require("../routes/customerAuthRoutes");

const claims = {
  uid: "firebase-customer-1",
  name: "Alex Customer",
  email: "Alex@example.com",
  email_verified: true,
  firebase: { sign_in_provider: "password" },
};

async function fixture(t, options = {}) {
  const calls = [];
  const verifications = [];
  const model = {
    async createIndexes() {},
    async findOneAndUpdate(filter, update, settings) {
      calls.push({ filter, update, settings });
      return { _id: "mongo-customer-1", ...update.$set, isActive: true };
    },
    ...options.model,
  };
  const app = express();
  app.use("/api/customer-auth", createCustomerAuthRouter({
    CustomerModel: model,
    getAuth: () => ({
      async verifyIdToken(token, checkRevoked) {
        verifications.push({ token, checkRevoked });
        if (options.error) throw options.error;
        return options.claims || claims;
      },
    }),
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (authorization = "Bearer firebase-id-token", query = "") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/customer-auth/me${query}`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  return { request, calls, verifications };
}

test("requires a bearer token before consulting Firebase or the database", async (t) => {
  const { request, calls, verifications } = await fixture(t);
  for (const header of [null, "Basic other-token", "Bearer token extra"]) {
    assert.equal((await request(header)).status, 401);
  }
  assert.equal(verifications.length, 0);
  assert.equal(calls.length, 0);
});

test("verifies revocation and uses only the verified Firebase UID for a customer profile", async (t) => {
  const { request, calls, verifications } = await fixture(t);
  const response = await request("Bearer firebase-id-token", "?uid=staff-user&email=other@example.com&role=SUPER_ADMIN");
  assert.equal(response.status, 200);
  assert.equal(response.cache, "no-store");
  assert.deepEqual(verifications, [{ token: "firebase-id-token", checkRevoked: true }]);
  assert.deepEqual(calls[0].filter, { firebaseUid: claims.uid });
  assert.equal(calls[0].settings.upsert, true);
  assert.equal(calls[0].settings.runValidators, true);
  assert.deepEqual(response.body, { customer: {
    id: "mongo-customer-1", name: "Alex Customer", email: "alex@example.com", emailVerified: true,
  } });
  assert.equal(response.body.customer.role, undefined);
  assert.equal(response.body.customer.firebaseUid, undefined);
});

test("Google accounts use the same customer endpoint", async (t) => {
  const { request } = await fixture(t, { claims: { ...claims, firebase: { sign_in_provider: "google.com" } } });
  assert.equal((await request()).status, 200);
});

test("an unverified email is reported honestly for the verification screen", async (t) => {
  const { request } = await fixture(t, { claims: { ...claims, email_verified: false } });
  assert.equal((await request()).body.customer.emailVerified, false);
});

for (const code of ["auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found", "auth/invalid-id-token"]) {
  test(`${code} cannot access a customer profile`, async (t) => {
    const { request, calls } = await fixture(t, { error: Object.assign(new Error("Rejected token"), { code }) });
    assert.equal((await request()).status, 401);
    assert.equal(calls.length, 0);
  });
}

test("anonymous, staff-shaped, or incomplete identity claims never reach the database", async (t) => {
  for (const invalid of [
    { ...claims, firebase: { sign_in_provider: "anonymous" } },
    { id: "staff-1", role: "SUPER_ADMIN" },
    { ...claims, email: undefined },
  ]) {
    const { request, calls } = await fixture(t, { claims: invalid });
    assert.equal((await request()).status, 401);
    assert.equal(calls.length, 0);
  }
});

test("a Firebase outage returns 503 so the client can preserve its session", async (t) => {
  t.mock.method(console, "error", () => {});
  const { request, calls } = await fixture(t, { error: Object.assign(new Error("Offline"), { code: "auth/internal-error" }) });
  assert.equal((await request()).status, 503);
  assert.equal(calls.length, 0);
});

test("a database outage returns 503 rather than treating the ID token as invalid", async (t) => {
  t.mock.method(console, "error", () => {});
  const { request } = await fixture(t, { model: { async createIndexes() { throw new Error("Database unavailable"); } } });
  assert.equal((await request()).status, 503);
});

test("index setup retries after an initial database outage and is then cached", async (t) => {
  t.mock.method(console, "error", () => {});
  let attempts = 0;
  const { request } = await fixture(t, { model: {
    async createIndexes() {
      attempts += 1;
      if (attempts === 1) throw new Error("Database unavailable");
    },
  } });
  assert.equal((await request()).status, 503);
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 200);
  assert.equal(attempts, 2);
});

test("disabled store customer profiles cannot access account details", async (t) => {
  const { request } = await fixture(t, { model: {
    async findOneAndUpdate() { return { _id: "disabled", isActive: false }; },
  } });
  assert.equal((await request()).status, 403);
});

test("concurrent first sign-ins recover from a unique UID insert race", async (t) => {
  let count = 0;
  const { request } = await fixture(t, { model: {
    async findOneAndUpdate(filter, update, settings) {
      count += 1;
      if (count === 1) throw Object.assign(new Error("Duplicate UID"), { code: 11000 });
      assert.equal(settings.upsert, undefined);
      assert.deepEqual(filter, { firebaseUid: claims.uid });
      return { _id: "existing-customer", ...update.$set, isActive: true };
    },
  } });
  assert.equal((await request()).body.customer.id, "existing-customer");
  assert.equal(count, 2);
});
