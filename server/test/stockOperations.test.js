const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const mongoose = require("mongoose");

const Sale = require("../models/Sale");
const PurchaseOrder = require("../models/PurchaseOrder");
const Inventory = require("../models/BranchInventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const StockOperation = require("../models/StockOperation");
const Reservation = require("../models/Reservation");
const { refundSale } = require("../controllers/saleController");
const { receivePurchaseOrder } = require("../controllers/purchaseOrderController");
const { adjustStock, transferStock } = require("../controllers/inventoryTransactionController");
const { getReservations } = require("../controllers/reservationController");
const { runStockOperation } = require("../lib/stockOperations");

const branchA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const branchB = "bbbbbbbbbbbbbbbbbbbbbbbb";
const productId = "cccccccccccccccccccccccc";
const lineId = "dddddddddddddddddddddddd";
const user = { _id: "eeeeeeeeeeeeeeeeeeeeeeee", role: "SUPER_ADMIN" };

afterEach(() => mock.restoreAll());

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const request = (body, key = "request-key-123", id = "order-1") => ({
  user,
  params: { id },
  body,
  headers: { "idempotency-key": key },
});

const mockSession = () => {
  const state = { commits: 0, aborts: 0, ended: 0 };
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
    async endSession() { state.ended += 1; },
  };
  mock.method(mongoose, "startSession", async () => session);
  return { session, state };
};

const mockOperationLedger = () => {
  mock.method(StockOperation, "init", async () => {});
  mock.method(StockOperation, "findOne", () => ({ lean: async () => null }));
  mock.method(StockOperation, "create", async () => []);
};

test("a sale line cannot be refunded twice in one request", async () => {
  const { state } = mockSession();
  mockOperationLedger();
  const saleItem = { _id: lineId, product: productId, quantity: 1, refundedQuantity: 0, unitPrice: 100 };
  const items = [saleItem];
  items.id = (id) => items.find((item) => String(item._id) === String(id));
  mock.method(Sale, "findOne", () => ({ session: async () => ({
    items, status: "COMPLETED", subtotal: 100, totalAmount: 100, refundedAmount: 0,
  }) }));
  mock.method(Inventory, "findOneAndUpdate", () => assert.fail("Duplicate refund must not change stock"));
  const res = response();
  await refundSale(request({ reason: "Return", items: [
    { itemId: lineId, product: productId, quantity: 1 },
    { itemId: lineId, product: productId, quantity: 1 },
  ] }, "refund-duplicate", "sale-1"), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /only once/);
  assert.equal(state.commits, 0);
  assert.equal(state.aborts, 1);
});

test("a purchase order line cannot be received twice in one request", async () => {
  const { state } = mockSession();
  mockOperationLedger();
  const orderItem = { _id: lineId, product: productId, quantity: 10, receivedQuantity: 0 };
  const items = [orderItem];
  items.id = (id) => items.find((item) => String(item._id) === String(id));
  mock.method(PurchaseOrder, "findOne", () => ({ session: async () => ({ items, status: "ORDERED" }) }));
  mock.method(Inventory, "findOneAndUpdate", () => assert.fail("Duplicate receipt must not change stock"));
  const res = response();
  await receivePurchaseOrder(request({ items: [
    { itemId: lineId, quantity: 6 },
    { itemId: lineId, quantity: 6 },
  ] }, "receipt-duplicate"), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /only once/);
  assert.equal(state.commits, 0);
  assert.equal(state.aborts, 1);
});

test("a history write failure aborts purchase receipt transaction before saving the order", async () => {
  const { session, state } = mockSession();
  mockOperationLedger();
  const orderItem = { _id: lineId, product: productId, quantity: 10, receivedQuantity: 0 };
  const items = [orderItem];
  items.id = () => orderItem;
  const order = { _id: "order-1", branch: branchA, poNumber: "PO-1", items, status: "ORDERED" };
  mock.method(PurchaseOrder, "findOne", () => ({ session: async () => order }));
  mock.method(Inventory, "findOneAndUpdate", async (_filter, update, options) => {
    assert.equal(options.session, session);
    assert.equal(update.$inc.quantity, 6);
    return { quantity: 6 };
  });
  mock.method(InventoryTransaction, "create", async () => { throw new Error("History write failed"); });
  const res = response();
  const originalError = console.error;
  console.error = () => {};
  try {
    await receivePurchaseOrder(request({ items: [{ itemId: lineId, quantity: 6 }] }, "receipt-failure"), res);
  } finally {
    console.error = originalError;
  }
  assert.equal(res.statusCode, 500);
  assert.equal(state.commits, 0);
  assert.equal(state.aborts, 1);
  assert.equal(order.status, "ORDERED");
});

test("stock adjustment cannot go below reserved units", async () => {
  const { state } = mockSession();
  mockOperationLedger();
  mock.method(Inventory, "findOne", () => ({ session: async () => ({ quantity: 10, reservedQuantity: 8 }) }));
  mock.method(Inventory, "findOneAndUpdate", () => assert.fail("Reserved units must remain held"));
  const res = response();
  await adjustStock(request({ inventoryId: "inventory-a", newQuantity: 7, reason: "Count" }, "adjust-reserved"), res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /reserved/);
  assert.equal(state.commits, 0);
});

test("transfer uses unreserved units and logs both sides together", async () => {
  const { session, state } = mockSession();
  mockOperationLedger();
  const source = { _id: "source", branch: branchA, product: productId, quantity: 10, reservedQuantity: 8 };
  const destination = { _id: "destination", branch: branchB, product: productId, quantity: 4, reservedQuantity: 0 };
  mock.method(Inventory, "findById", (id) => ({ session: async () => id === "source" ? source : destination }));
  const updates = [];
  mock.method(Inventory, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(options.session, session);
    updates.push({ filter, update });
    return filter._id === "source"
      ? { ...source, quantity: 8 }
      : { ...destination, quantity: 6 };
  });
  mock.method(InventoryTransaction, "create", async (details, options) => {
    assert.equal(options.session, session);
    assert.equal(details.length, 2);
    assert.deepEqual(details.map((item) => [item.previousQuantity, item.newQuantity]), [[10, 8], [4, 6]]);
    return details;
  });

  const denied = response();
  await transferStock(request({ fromInventoryId: "source", toInventoryId: "destination", quantity: 5 }, "transfer-denied"), denied);
  assert.equal(denied.statusCode, 409);
  assert.equal(updates.length, 0);

  const allowed = response();
  await transferStock(request({ fromInventoryId: "source", toInventoryId: "destination", quantity: 2 }, "transfer-allowed"), allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(state.commits, 1);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0].filter.$expr.$gte[1], 2);
  assert.equal(updates[0].update.$inc.quantity, -2);
});

test("reusing an operation key returns the first result without doing the work again", async () => {
  const { state } = mockSession();
  mock.method(StockOperation, "init", async () => {});
  let stored = null;
  mock.method(StockOperation, "findOne", () => ({ lean: async () => stored }));
  mock.method(StockOperation, "create", async ([record]) => { stored = record; return [record]; });
  let executions = 0;
  const req = request({ quantity: 2 }, "retry-key-123");
  const first = await runStockOperation(req, "receive:item-1", async () => {
    executions += 1;
    return { status: 201, body: { stock: 2 } };
  });
  const second = await runStockOperation(req, "receive:item-1", async () => {
    executions += 1;
    return { status: 201, body: { stock: 4 } };
  });
  assert.deepEqual(second, first);
  assert.equal(executions, 1);
  assert.equal(state.commits, 1);
  await assert.rejects(
    runStockOperation(request({ quantity: 3 }, "retry-key-123"), "receive:item-1", async () => {}),
    { status: 409 },
  );
});

test("a stock write without a request key is rejected before opening a transaction", async () => {
  mock.method(mongoose, "startSession", () => assert.fail("No transaction should start"));
  const res = response();
  await adjustStock({ user, body: { inventoryId: "inventory-a", newQuantity: 4, reason: "Count" } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Idempotency-Key/);
});

test("a replay cannot reveal an old branch after staff are reassigned", async () => {
  mock.method(StockOperation, "init", async () => {});
  const req = {
    ...request({ quantity: 1 }, "old-branch-key"),
    user: { _id: user._id, role: "INVENTORY_STAFF", branch: { _id: branchB } },
  };
  const operation = "receive:inventory-a";
  const crypto = require("node:crypto");
  const requestHash = crypto.createHash("sha256")
    .update(JSON.stringify({ operation, body: req.body }))
    .digest("hex");
  mock.method(StockOperation, "findOne", () => ({ lean: async () => ({
    operation,
    requestHash,
    result: { status: 201, body: { inventory: { branch: branchA } } },
  }) }));
  await assert.rejects(runStockOperation(req, operation, async () => assert.fail("No write should run")), { status: 404 });
});

test("an expired ready-for-pickup reservation releases its hold in one transaction", async () => {
  const { session, state } = mockSession();
  const expired = { _id: "reservation-a", branch: branchA, product: productId, quantity: 2 };
  mock.method(Reservation, "find", (filter) => filter.expiresAt
    ? { select: async () => [expired] }
    : { populate() { return this; }, sort: async () => [] });
  mock.method(Reservation, "findOneAndUpdate", async (filter, update, options) => {
    assert.deepEqual(filter.status.$in, ["ACTIVE", "READY_FOR_PICKUP"]);
    assert.equal(update.$set.status, "EXPIRED");
    assert.equal(options.session, session);
    return expired;
  });
  mock.method(Inventory, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(filter.reservedQuantity.$gte, 2);
    assert.equal(update.$inc.reservedQuantity, -2);
    assert.equal(options.session, session);
    return { reservedQuantity: 0 };
  });
  const res = response();
  await getReservations({
    user: { ...user, role: "INVENTORY_STAFF", branch: { _id: branchA } },
    query: {},
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(state.commits, 1);
});
