const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");

afterEach(() => mock.restoreAll());

const request = () => ({
  method: "GET",
  path: "/sales",
  headers: { authorization: "Bearer fixture-token" },
});
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const mockUser = (user) => {
  mock.method(jwt, "verify", () => ({ id: "staff-1" }));
  mock.method(User, "findById", () => ({
    select() { return this; },
    async populate() { return user; },
  }));
};

test("rejects a missing bearer token", async () => {
  const res = response();
  await protect({ ...request(), headers: {} }, res, () => assert.fail("Must not continue"));
  assert.equal(res.statusCode, 401);
});

for (const name of ["TokenExpiredError", "JsonWebTokenError", "NotBeforeError"]) {
  test(`returns 401 for ${name}`, async () => {
    mock.method(jwt, "verify", () => { throw Object.assign(new Error("Invalid token"), { name }); });
    const res = response();
    await protect(request(), res, () => assert.fail("Must not continue"));
    assert.equal(res.statusCode, 401);
  });
}

test("accepts an active user with a valid token", async () => {
  const user = { _id: "staff-1", isActive: true };
  mockUser(user);
  const req = request();
  const next = mock.fn();
  await protect(req, response(), next);

  assert.equal(req.user, user);
  assert.equal(next.mock.callCount(), 1);
});

for (const user of [null, { _id: "staff-1", isActive: false }]) {
  test(`returns 401 for a ${user ? "disabled" : "deleted"} account`, async () => {
    mockUser(user);
    const res = response();
    await protect(request(), res, () => assert.fail("Must not continue"));
    assert.equal(res.statusCode, 401);
  });
}

test("returns 503 instead of ending a valid session when the database is unavailable", async () => {
  mock.method(jwt, "verify", () => ({ id: "staff-1" }));
  mock.method(User, "findById", () => ({
    select() { return this; },
    async populate() { throw new Error("Database connection unavailable"); },
  }));
  mock.method(console, "error", () => {});
  const res = response();
  await protect(request(), res, () => assert.fail("Must not continue"));

  assert.equal(res.statusCode, 503);
  assert.match(res.body.message, /try again/i);
});
