const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const mongoose = require("mongoose");

const Branch = require("../models/Branch");
const Product = require("../models/Product");
const Reservation = require("../models/Reservation");
const Sale = require("../models/Sale");
const Inventory = require("../models/BranchInventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const StockOperation = require("../models/StockOperation");
const { checkoutReservation } = require("../controllers/reservationCheckoutController");
const { expireReservation, processExpiredReservations } = require("../lib/reservationExpiry");

const branchId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const otherBranchId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const heldProductId = "cccccccccccccccccccccccc";
const extraProductId = "dddddddddddddddddddddddd";
const reservationId = "eeeeeeeeeeeeeeeeeeeeeeee";
const userId = "ffffffffffffffffffffffff";
const user = { _id: userId, role: "CASHIER", branch: { _id: branchId } };

afterEach(() => mock.restoreAll());

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const request = (key = "reservation-sale-1", items = [{ product: heldProductId, quantity: 2 }]) => ({
  user,
  params: { id: reservationId },
  headers: { "idempotency-key": key },
  body: { branch: branchId, items, discount: 0, paymentMethod: "CASH", amountPaid: 100 },
});

const mockTransaction = () => {
  const state = { commits: 0, aborts: 0 };
  const session = {
    async withTransaction(work) {
      try {
        const result = await work();
        state.commits += 1;
        return result;
      } catch (error) {
        state.aborts += 1;
        throw error;
      }
    },
    async endSession() {},
  };
  mock.method(mongoose, "startSession", async () => session);
  return { session, state };
};

const mockLedger = () => {
  let stored = null;
  mock.method(StockOperation, "init", async () => {});
  mock.method(StockOperation, "findOne", () => ({ lean: async () => stored }));
  mock.method(StockOperation, "create", async ([record]) => { stored = record; return [record]; });
  mock.method(Sale, "init", async () => {});
};

const reservation = (overrides = {}) => ({
  _id: reservationId,
  reservationNumber: "RES-000123",
  branch: branchId,
  product: heldProductId,
  quantity: 2,
  status: "READY_FOR_PICKUP",
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides,
});

const mockCheckoutReads = (record) => {
  mock.method(Reservation, "findOne", (filter) => {
    assert.deepEqual(filter, { _id: reservationId, branch: branchId });
    return { session: async () => record };
  });
  mock.method(Branch, "findOne", () => ({ session: async () => ({ _id: branchId, isActive: true }) }));
  mock.method(Product, "findOne", (filter) => ({ session: async () => ({
    _id: filter._id,
    sellingPrice: filter._id === heldProductId ? 25 : 10,
  }) }));
};

test("POS checkout consumes the reserved units, creates one linked sale, and can be retried safely", async () => {
  const { session, state } = mockTransaction();
  mockLedger();
  mockCheckoutReads(reservation());
  let claims = 0;
  mock.method(Reservation, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(filter.branch, branchId);
    assert.equal(filter.expiresAt.$gt instanceof Date, true);
    assert.equal(update.$set.status, "COMPLETED");
    assert.equal(options.session, session);
    claims += 1;
    return { _id: reservationId };
  });
  const stockChanges = [];
  mock.method(Inventory, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(options.session, session);
    stockChanges.push({ filter, update });
    return { quantity: filter.product === heldProductId ? 8 : 4 };
  });
  const history = [];
  mock.method(InventoryTransaction, "create", async ([entry], options) => {
    assert.equal(options.session, session);
    history.push(entry);
  });
  let savedSale;
  mock.method(Sale.prototype, "save", async function (options) {
    assert.equal(options.session, session);
    savedSale = this;
    return this;
  });
  mock.method(Sale, "findById", () => ({
    session() { return this; },
    populate() { return this; },
    async lean() { return savedSale.toObject(); },
  }));

  const first = response();
  const saleItems = [{ product: heldProductId, quantity: 2 }, { product: extraProductId, quantity: 1 }];
  await checkoutReservation(request("reservation-sale-1", saleItems), first);
  assert.equal(first.statusCode, 201);
  assert.equal(String(first.body.sale.reservation), reservationId);
  assert.equal(first.body.sale.totalAmount, 60);
  assert.equal(savedSale.items.length, 2);
  assert.equal(claims, 1);
  assert.deepEqual(stockChanges[0].update.$inc, { quantity: -2, reservedQuantity: -2 });
  assert.equal(stockChanges[0].filter.reservedQuantity.$gte, 2);
  assert.deepEqual(stockChanges[1].update.$inc, { quantity: -1 });
  assert.equal(stockChanges[1].filter.$expr.$gte[1], 1);
  assert.deepEqual(history.map((entry) => entry.quantity), [2, 1]);
  assert.equal(state.commits, 1);

  const retry = response();
  await checkoutReservation(request("reservation-sale-1", saleItems), retry);
  assert.deepEqual(retry.body, JSON.parse(JSON.stringify(first.body)));
  assert.equal(claims, 1);
  assert.equal(stockChanges.length, 2);
  assert.equal(history.length, 2);
  assert.equal(state.commits, 1);
});

test("expired reservations cannot be checked out or change stock", async () => {
  const { state } = mockTransaction();
  mockLedger();
  mockCheckoutReads(reservation({ expiresAt: new Date(Date.now() - 60_000) }));
  mock.method(Reservation, "findOneAndUpdate", () => assert.fail("Expired hold must not be claimed"));
  mock.method(Inventory, "findOneAndUpdate", () => assert.fail("Expired hold must not change stock"));
  const result = response();
  await checkoutReservation(request(), result);
  assert.equal(result.statusCode, 409);
  assert.match(result.body.message, /expired/);
  assert.equal(state.aborts, 1);
});

test("a completed reservation cannot create a second receipt with a new request key", async () => {
  const { state } = mockTransaction();
  mockLedger();
  mockCheckoutReads(reservation({ status: "COMPLETED" }));
  mock.method(Sale.prototype, "save", () => assert.fail("A second sale must not be saved"));
  mock.method(Inventory, "findOneAndUpdate", () => assert.fail("Stock must not be deducted again"));
  const result = response();
  await checkoutReservation(request("another-sale-key"), result);
  assert.equal(result.statusCode, 409);
  assert.equal(state.aborts, 1);
});

test("checkout is scoped to the cashier's branch", async () => {
  mockTransaction();
  mockLedger();
  mock.method(Reservation, "findOne", (filter) => {
    assert.deepEqual(filter, { _id: reservationId, branch: branchId });
    return { session: async () => null };
  });
  mock.method(Inventory, "findOneAndUpdate", () => assert.fail("Other branch stock must not change"));
  const result = response();
  await checkoutReservation(request(), result);
  assert.equal(result.statusCode, 404);
});

test("a lost reservation claim aborts checkout before stock changes", async () => {
  const { state } = mockTransaction();
  mockLedger();
  mockCheckoutReads(reservation());
  mock.method(Reservation, "findOneAndUpdate", async () => null);
  mock.method(Inventory, "findOneAndUpdate", () => assert.fail("Unclaimed hold must not change stock"));
  const result = response();
  await checkoutReservation(request(), result);
  assert.equal(result.statusCode, 409);
  assert.equal(state.aborts, 1);
});

test("expiry releases an active or ready hold once and never releases a completed sale", async () => {
  const { session, state } = mockTransaction();
  const old = reservation({ expiresAt: new Date(Date.now() - 60_000) });
  let claims = 0;
  mock.method(Reservation, "findOneAndUpdate", async (filter, update, options) => {
    assert.deepEqual(filter.status.$in, ["ACTIVE", "READY_FOR_PICKUP"]);
    assert.equal(update.$set.status, "EXPIRED");
    assert.equal(options.session, session);
    claims += 1;
    return claims === 1 ? old : null;
  });
  let releases = 0;
  mock.method(Inventory, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(filter.reservedQuantity.$gte, 2);
    assert.equal(update.$inc.reservedQuantity, -2);
    assert.equal(options.session, session);
    releases += 1;
    return { reservedQuantity: 0 };
  });
  assert.equal(await expireReservation(old), true);
  assert.equal(await expireReservation(old), false);
  assert.equal(await expireReservation(reservation({ status: "COMPLETED", expiresAt: old.expiresAt })), false);
  assert.equal(releases, 1);
  assert.equal(state.commits, 2);
});

test("expiry pass scans held reservations without a browser request", async () => {
  mockTransaction();
  const old = reservation({ expiresAt: new Date(Date.now() - 60_000), branch: otherBranchId });
  mock.method(Reservation, "find", (filter) => {
    assert.equal(filter.branch, undefined);
    assert.deepEqual(filter.status.$in, ["ACTIVE", "READY_FOR_PICKUP"]);
    return { sort() { return this; }, limit() { return this; }, async select() { return [old]; } };
  });
  mock.method(Reservation, "findOneAndUpdate", async () => old);
  let releases = 0;
  mock.method(Inventory, "findOneAndUpdate", async () => { releases += 1; return { reservedQuantity: 0 }; });
  const result = await processExpiredReservations({ maxBatches: 1 });
  assert.equal(result.expired, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(releases, 1);
});
