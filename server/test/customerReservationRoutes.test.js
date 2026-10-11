const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { createCustomerReservationRouter } = require("../routes/customerReservationRoutes");
const Reservation = require("../models/Reservation");

const branchId = "a".repeat(24), otherBranchId = "b".repeat(24);
const hammerId = "c".repeat(24), paintId = "d".repeat(24);
const customerId = "e".repeat(24), secondCustomerId = "f".repeat(24);
const body = () => ({ branch: branchId, customerName: "Alex Customer", customerPhone: "09123456789",
  items: [{ product: hammerId, quantity: 2, unitPrice: 25 }, { product: paintId, quantity: 1, unitPrice: 50 }] });
const clone = (value) => structuredClone(value);

async function fixture(t, overrides = {}) {
  const branches = [{ _id: branchId, name: "Main branch", code: "MAIN", address: "12 Main St", phone: "1234567", isActive: true }];
  const products = [{ _id: hammerId, name: "Hammer", sku: "HAM", unit: "piece", sellingPrice: 25 }, { _id: paintId, name: "Paint", sku: "PNT", unit: "liter", sellingPrice: 50 }];
  const state = { records: [], stock: { [hammerId]: { quantity: 8, reservedQuantity: 1 }, [paintId]: { quantity: 4, reservedQuantity: 0 } }, commits: 0, aborts: 0, indexes: 0, stockWrites: 0, customerReads: 0 };
  function matches(record, filter) {
    return Object.entries(filter).every(([key, value]) => value?.$in ? value.$in.includes(record[key]) : String(record[key]) === String(value));
  }
  function query(getValue) {
    let populated = false;
    return {
      populate() { populated = true; return this; }, session() { return this; }, sort() { return this; }, limit() { return this; },
      then(resolve, reject) {
        let value = getValue();
        const attach = (record) => record && (populated ? { ...clone(record), branch: branches.find((branch) => branch._id === record.branch) || record.branch } : clone(record));
        value = Array.isArray(value) ? value.map(attach) : attach(value);
        return Promise.resolve(value).then(resolve, reject);
      },
    };
  }
  const ReservationModel = {
    async createIndexes() { state.indexes += 1; },
    findOne: (filter) => query(() => state.records.find((record) => matches(record, filter)) || null),
    findById: (id) => query(() => state.records.find((record) => record._id === id) || null),
    find: (filter) => query(() => state.records.filter((record) => matches(record, filter))),
    async create([record]) {
      if (state.records.some((item) => item.customer === record.customer && item.requestId === record.requestId)) throw Object.assign(new Error("Duplicate request"), { code: 11000 });
      const created = { ...record, _id: (state.records.length + 1).toString(16).padStart(24, "0"), createdAt: new Date() };
      state.records.push(created);
      return [clone(created)];
    },
    async findOneAndUpdate(filter, update) {
      const record = state.records.find((item) => matches(item, filter));
      if (!record) return null;
      Object.assign(record, update.$set);
      return clone(record);
    },
  };
  let queue = Promise.resolve();
  const transaction = async (work) => {
    const previous = queue;
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    const snapshot = clone({ stock: state.stock, records: state.records });
    try { const result = await work({ testSession: true }); state.commits += 1; return result; }
    catch (error) { state.stock = snapshot.stock; state.records = snapshot.records; state.aborts += 1; throw error; }
    finally { release(); }
  };
  const app = express();
  app.use(express.json());
  app.use("/api/customer-reservations", createCustomerReservationRouter({
    ReservationModel, transaction,
    CustomerModel: { async findOne(filter) { state.customerReads += 1; return { _id: filter.firebaseUid === "customer-two" ? secondCustomerId : customerId, isActive: overrides.active !== false }; } },
    BranchModel: { findOne: (filter) => query(() => branches.find((branch) => branch._id === filter._id) || null) },
    ProductModel: { findOne: (filter) => query(() => products.find((product) => product._id === filter._id) || null) },
    InventoryModel: { async findOneAndUpdate(filter, update, options) {
      assert.equal(options.session.testSession, true);
      assert.equal(filter.branch, branchId);
      const stock = state.stock[filter.product];
      const needed = filter.$expr?.$gte[1] || filter.reservedQuantity?.$gte;
      if (!stock || (filter.$expr ? stock.quantity - stock.reservedQuantity : stock.reservedQuantity) < needed) return null;
      stock.reservedQuantity += update.$inc.reservedQuantity;
      state.stockWrites += 1;
      return clone(stock);
    } },
    getAuth: () => ({ async verifyIdToken(token, revoked) {
      assert.equal(revoked, true);
      return { uid: token === "customer-two" ? "customer-two" : "customer-one", email: "alex@example.com", email_verified: overrides.verified !== false, firebase: { sign_in_provider: "password" } };
    } }),
  }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request({ method = "POST", path = "", cart = body(), key = "reserve-request-1", token = "customer-one" } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/customer-reservations${path}`, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), "Idempotency-Key": key },
      ...(method === "POST" ? { body: JSON.stringify(cart) } : {}),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  }
  return { request, state, products };
}

test("a verified customer's whole cart becomes one real branch hold using server prices and identity", async (t) => {
  const { request, state } = await fixture(t);
  const result = await request({ cart: { ...body(), customer: secondCustomerId, customerEmail: "spoof@example.com", status: "COMPLETED", expiresAt: "2099-01-01" } });
  assert.equal(result.status, 201);
  assert.equal(result.cache, "no-store");
  assert.equal(result.body.reservation.branch.address, "12 Main St");
  assert.equal(result.body.reservation.items.length, 2);
  assert.equal(result.body.reservation.total, 100);
  assert.match(result.body.reservation.reservationNumber, /^RES-WEB-[A-F0-9]{16}$/);
  assert.equal(state.records[0].customer, customerId);
  assert.equal(state.records[0].customerEmail, "alex@example.com");
  assert.equal(state.records[0].status, "ACTIVE");
  assert.ok(Math.abs(new Date(state.records[0].expiresAt).getTime() - Date.now() - 7200000) < 2000);
  assert.equal(state.stock[hammerId].reservedQuantity, 3);
  assert.equal(state.stock[paintId].reservedQuantity, 1);
  assert.equal(result.body.reservation.requestHash, undefined);
  assert.equal(state.commits, 1);
  await new Reservation(state.records[0]).validate();
});

test("retrying or simultaneously submitting the same request never holds stock twice", async (t) => {
  const { request, state } = await fixture(t);
  const results = await Promise.all([request(), request()]);
  assert.deepEqual(results[0].body, results[1].body);
  assert.equal((await request()).body.reservation.id, results[0].body.reservation.id);
  assert.equal(state.records.length, 1);
  assert.equal(state.stock[hammerId].reservedQuantity, 3);
  assert.equal(state.stock[paintId].reservedQuantity, 1);
  assert.equal(state.indexes, 1);
});

test("a key reused for another cart is rejected without another hold", async (t) => {
  const { request, state } = await fixture(t);
  await request();
  const changed = body(); changed.items[0].quantity = 3;
  assert.equal((await request({ cart: changed })).status, 409);
  assert.equal(state.records.length, 1);
  assert.equal(state.stock[hammerId].reservedQuantity, 3);
});

test("short stock on a later item rolls back every earlier hold", async (t) => {
  const { request, state } = await fixture(t);
  state.stock[paintId].quantity = 0;
  assert.equal((await request()).status, 409);
  assert.equal(state.stockWrites, 1);
  assert.equal(state.stock[hammerId].reservedQuantity, 1);
  assert.equal(state.records.length, 0);
  assert.equal(state.aborts, 1);
});

test("two customers cannot reserve the same last available units", async (t) => {
  const { request, state } = await fixture(t);
  state.stock[hammerId].quantity = 3;
  const results = await Promise.all([request(), request({ token: "customer-two" })]);
  assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]);
  assert.equal(state.stock[hammerId].reservedQuantity, 3);
  assert.equal(state.records.length, 1);
});

test("stale or manipulated prices and unavailable branches are rejected", async (t) => {
  const { request, state, products } = await fixture(t);
  products[1].sellingPrice = 60;
  assert.equal((await request()).status, 409);
  assert.equal(state.stock[hammerId].reservedQuantity, 1);
  assert.equal((await request({ cart: { ...body(), branch: otherBranchId } })).status, 404);
  assert.equal(state.records.length, 0);
});

test("invalid cart quantities, duplicate products, invalid IDs, and missing keys cannot change stock", async (t) => {
  const { request, state } = await fixture(t);
  for (const quantity of [0, -1, 1.5, "2", 10000, null]) {
    const cart = body(); cart.items[0].quantity = quantity;
    assert.equal((await request({ cart })).status, 400);
  }
  const duplicate = body(); duplicate.items.push(duplicate.items[0]);
  assert.equal((await request({ cart: duplicate })).status, 400);
  assert.equal((await request({ cart: { ...body(), items: [] } })).status, 400);
  assert.equal((await request({ cart: { ...body(), branch: { $ne: null } } })).status, 400);
  assert.equal((await request({ key: "" })).status, 400);
  assert.equal(state.stockWrites, 0);
});

test("unsigned, unverified, and disabled customers cannot reserve", async (t) => {
  const unsigned = await fixture(t);
  assert.equal((await unsigned.request({ token: null })).status, 401);
  assert.equal(unsigned.state.customerReads, 0);
  const unverified = await fixture(t, { verified: false });
  const denied = await unverified.request();
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "EMAIL_NOT_VERIFIED");
  assert.equal(unverified.state.customerReads, 0);
  const disabled = await fixture(t, { active: false });
  assert.equal((await disabled.request()).status, 403);
  assert.equal(disabled.state.stockWrites, 0);
});

test("customers see only their own reservations and cannot cancel another customer's hold", async (t) => {
  const { request, state } = await fixture(t);
  const reservation = (await request()).body.reservation;
  assert.equal((await request({ method: "GET", token: "customer-two" })).body.reservations.length, 0);
  assert.equal((await request({ method: "GET" })).body.reservations[0].id, reservation.id);
  assert.equal((await request({ path: `/${reservation.id}/cancel`, token: "customer-two" })).status, 404);
  assert.equal(state.stock[hammerId].reservedQuantity, 3);
});

test("cancellation releases every cart line exactly once, including safe retries", async (t) => {
  const { request, state } = await fixture(t);
  const reservation = (await request()).body.reservation;
  const result = await request({ path: `/${reservation.id}/cancel` });
  assert.equal(result.body.reservation.status, "CANCELLED");
  await request({ path: `/${reservation.id}/cancel` });
  assert.equal(state.stock[hammerId].reservedQuantity, 1);
  assert.equal(state.stock[paintId].reservedQuantity, 0);
});

test("cancel after expiry releases holds as expired; completed pickups never release stock again", async (t) => {
  const { request, state } = await fixture(t);
  const reservation = (await request()).body.reservation;
  state.records[0].expiresAt = new Date(Date.now() - 1000);
  assert.equal((await request({ method: "GET" })).body.reservations[0].status, "EXPIRED");
  assert.equal((await request({ path: `/${reservation.id}/cancel` })).body.reservation.status, "EXPIRED");
  assert.equal(state.stock[hammerId].reservedQuantity, 1);
  state.records[0].status = "COMPLETED";
  const writes = state.stockWrites;
  assert.equal((await request({ path: `/${reservation.id}/cancel` })).body.reservation.status, "COMPLETED");
  assert.equal(state.stockWrites, writes);
});
