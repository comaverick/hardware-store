const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const Customer = require("../models/Customer");
const User = require("../models/User");
const customerRoutes = require("../routes/customerRoutes");

const accounts = [
  { _id: "customer-1", firebaseUid: "private-uid-1", name: "Alex Customer", email: "alex+shop@example.com", emailVerified: true, isActive: true, createdAt: "2026-10-01T00:00:00Z" },
  { _id: "customer-2", firebaseUid: "private-uid-2", name: "Sam Builder", email: "sam@example.com", emailVerified: false, isActive: true, createdAt: "2026-10-02T00:00:00Z" },
  { _id: "customer-3", firebaseUid: "private-uid-3", name: "Alex Contractor", email: "contractor@example.com", emailVerified: true, isActive: false, createdAt: "2026-10-03T00:00:00Z" },
];

async function fixture(t, options = {}) {
  const calls = [];
  t.mock.method(jwt, "verify", () => {
    if (options.tokenError) throw options.tokenError;
    return options.claims || { id: "staff-1" };
  });
  t.mock.method(User, "findById", () => ({
    select() { return this; },
    async populate() {
      return { _id: "staff-1", role: options.role || "CASHIER", isActive: options.staffActive !== false };
    },
  }));

  const matchingAccounts = (filter) => accounts.filter((account) => (
    (filter.isActive === undefined || account.isActive === filter.isActive)
    && (filter.emailVerified === undefined || account.emailVerified === filter.emailVerified)
    && (!filter.$or || filter.$or.some((condition) => Object.entries(condition).some(([field, pattern]) => pattern.test(account[field]))))
  ));

  t.mock.method(Customer, "find", (filter) => {
    const call = { method: "find", filter };
    calls.push(call);
    return {
      select(fields) { call.fields = fields; return this; },
      sort(order) { call.order = order; return this; },
      skip(skip) { call.skip = skip; return this; },
      limit(limit) { call.limit = limit; return this; },
      async lean() {
        if (options.databaseError) throw new Error("Database unavailable");
        const fields = ["_id", ...call.fields.split(" ")];
        return matchingAccounts(filter)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(call.skip, call.skip + call.limit)
          .map((account) => Object.fromEntries(Object.entries(account).filter(([field]) => fields.includes(field))));
      },
    };
  });
  t.mock.method(Customer, "countDocuments", async (filter) => {
    calls.push({ method: "count", filter });
    if (options.countError) throw new Error("Database unavailable");
    return matchingAccounts(filter).length;
  });

  const app = express();
  app.use("/api/customers", customerRoutes);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const request = async (query = "", authorization = "Bearer staff-session") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/customers${query}`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  return { request, calls };
}

test("lists existing customer accounts newest first without exposing Firebase identifiers", async (t) => {
  const { request, calls } = await fixture(t);
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.cache, "no-store");
  assert.equal(response.body.total, 3);
  assert.equal(response.body.page, 1);
  assert.equal(response.body.pageSize, 10);
  assert.deepEqual(response.body.customers.map((account) => account._id), ["customer-3", "customer-2", "customer-1"]);
  assert.equal(response.body.customers[0].firebaseUid, undefined);
  assert.equal(calls[0].fields, "name email emailVerified isActive createdAt updatedAt");
  assert.deepEqual(calls[0].order, { createdAt: -1, _id: -1 });
});

test("rejects unauthenticated requests before looking up customer records", async (t) => {
  const { request, calls } = await fixture(t);
  assert.equal((await request("", null)).status, 401);
  assert.equal((await request("", "Basic other-token")).status, 401);
  assert.equal(calls.length, 0);
});

test("a customer Firebase token cannot read the staff customer directory", async (t) => {
  const { request, calls } = await fixture(t, {
    claims: { id: "staff-1", uid: "customer-1", aud: "storefront", firebase: { sign_in_provider: "password" } },
  });
  assert.equal((await request()).status, 401);
  assert.equal(calls.length, 0);
});

test("expired staff sessions cannot read customer records", async (t) => {
  const { request, calls } = await fixture(t, { tokenError: Object.assign(new Error("Expired"), { name: "TokenExpiredError" }) });
  assert.equal((await request()).status, 401);
  assert.equal(calls.length, 0);
});

test("disabled staff accounts cannot read customer records", async (t) => {
  const { request, calls } = await fixture(t, { staffActive: false });
  assert.equal((await request()).status, 401);
  assert.equal(calls.length, 0);
});

test("combines case-insensitive name search, account status, and email verification", async (t) => {
  const { request, calls } = await fixture(t);
  const response = await request("?search=aLeX&status=inactive&verification=verified");
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 1);
  assert.deepEqual(response.body.customers.map((account) => account._id), ["customer-3"]);
  assert.deepEqual(calls[0].filter, calls[1].filter);
});

test("searches email addresses literally, including regex metacharacters", async (t) => {
  const { request } = await fixture(t);
  const response = await request(`?search=${encodeURIComponent(" ALEX+shop@example.com ")}`);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.customers[0]._id, "customer-1");
  assert.equal((await request("?search=.*")).body.total, 0);
});

test("returns only the requested page while counting all matching customers", async (t) => {
  const { request, calls } = await fixture(t);
  const response = await request("?page=2&pageSize=2");
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 3);
  assert.equal(response.body.page, 2);
  assert.equal(response.body.pageSize, 2);
  assert.deepEqual(response.body.customers.map((account) => account._id), ["customer-1"]);
  assert.equal(calls[0].skip, 2);
  assert.equal(calls[0].limit, 2);
});

test("filters active unverified accounts and returns an explicit empty result for no matches", async (t) => {
  const { request } = await fixture(t);
  const response = await request("?status=active&verification=unverified");
  assert.equal(response.body.total, 1);
  assert.equal(response.body.customers[0]._id, "customer-2");
  const empty = await request("?search=nonexistent");
  assert.deepEqual(empty.body, { customers: [], total: 0, page: 1, pageSize: 10 });
});

test("rejects invalid or unbounded filter inputs before querying the database", async (t) => {
  const { request, calls } = await fixture(t);
  for (const query of [
    "?page=0", "?page=-1", "?page=1.5", "?page=1e3", "?page=9007199254740992",
    "?page=9007199254740991&pageSize=100", "?pageSize=0", "?pageSize=101",
    "?pageSize=abc", "?page=1&page=2", "?status=deleted", "?verification=yes",
    "?search=a&search=b", `?search=${"a".repeat(201)}`,
  ]) {
    assert.equal((await request(query)).status, 400, query);
  }
  assert.equal(calls.length, 0);
});

for (const failure of ["databaseError", "countError"]) {
  test(`returns a retryable error when ${failure === "databaseError" ? "customer records" : "customer counts"} are unavailable`, async (t) => {
    t.mock.method(console, "error", () => {});
    const { request } = await fixture(t, { [failure]: true });
    const response = await request();
    assert.equal(response.status, 503);
    assert.match(response.body.message, /try again/i);
    assert.equal(response.body.customers, undefined);
  });
}
