const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const { once } = require("node:events");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const BranchInventory = require("../models/BranchInventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const Reservation = require("../models/Reservation");
const Product = require("../models/Product");
const Branch = require("../models/Branch");
const Sale = require("../models/Sale");
const StockOperation = require("../models/StockOperation");
const { receiveStock, adjustStock } = require("../controllers/inventoryTransactionController");
const { updateInventory } = require("../controllers/branchInventoryController");
const { getReservations, updateReservationStatus } = require("../controllers/reservationController");
const { getProduct } = require("../controllers/productController");
const smartInventoryRoutes = require("../routes/smartInventoryRoutes");
const inventoryTransactionRoutes = require("../routes/inventoryTransactionRoutes");
const purchaseOrderRoutes = require("../routes/purchaseOrderRoutes");

const branchA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const branchB = "bbbbbbbbbbbbbbbbbbbbbbbb";
const staff = { _id: "staff-1", role: "INVENTORY_STAFF", branch: { _id: branchA }, isActive: true };

afterEach(() => mock.restoreAll());

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const startServer = async (mountPath, router) => {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const mockLogin = (user) => {
  mock.method(jwt, "verify", () => ({ id: user._id }));
  mock.method(User, "findById", () => ({
    select() { return this; },
    async populate() { return user; },
  }));
};

const mockStockTransaction = () => {
  mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (work) => work(),
    endSession: async () => {},
  }));
  mock.method(StockOperation, "init", async () => {});
  mock.method(StockOperation, "findOne", () => ({ lean: async () => null }));
  mock.method(StockOperation, "create", async () => []);
};

test("restock requires a login and rejects another branch", async () => {
  const server = await startServer("/api/smart-inventory", smartInventoryRoutes);
  try {
    const anonymous = await fetch(`${server.url}/api/smart-inventory/${branchA}`);
    assert.equal(anonymous.status, 401);

    mockLogin(staff);
    const foreign = await fetch(`${server.url}/api/smart-inventory/${branchB}`, {
      headers: { Authorization: "Bearer fixture-token" },
    });
    assert.equal(foreign.status, 403);

    mock.method(Branch, "findById", async (id) => ({ _id: id, name: "Branch A", code: "A", isActive: true }));
    mock.method(BranchInventory, "find", () => ({ async populate() { return []; } }));
    mock.method(Sale, "find", () => ({ async select() { return []; } }));
    const own = await fetch(`${server.url}/api/smart-inventory/${branchA}`, {
      headers: { Authorization: "Bearer fixture-token" },
    });
    assert.equal(own.status, 200);
    assert.equal((await own.json()).branch._id, branchA);
  } finally {
    await server.close();
  }
});

test("super admins can read restock data for another branch", async () => {
  mockLogin({ _id: "super-1", role: "SUPER_ADMIN", branch: null, isActive: true });
  mock.method(Branch, "findById", async (id) => ({ _id: id, name: "Branch B", code: "B", isActive: true }));
  mock.method(BranchInventory, "find", () => ({ async populate() { return []; } }));
  mock.method(Sale, "find", () => ({ async select() { return []; } }));
  const server = await startServer("/api/smart-inventory", smartInventoryRoutes);
  try {
    const result = await fetch(`${server.url}/api/smart-inventory/${branchB}`, {
      headers: { Authorization: "Bearer fixture-token" },
    });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).branch._id, branchB);
  } finally {
    await server.close();
  }
});

test("cashiers cannot post stock changes", async () => {
  mockLogin({ ...staff, role: "CASHIER" });
  mock.method(AuditLog, "create", async () => ({}));
  const server = await startServer("/api/inventory-transactions", inventoryTransactionRoutes);
  try {
    const result = await fetch(`${server.url}/api/inventory-transactions/adjust`, {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inventoryId: "inventory-b", newQuantity: 0, reason: "Test" }),
    });
    assert.equal(result.status, 403);
  } finally {
    await server.close();
  }
});

test("cashiers cannot receive purchase orders", async () => {
  mockLogin({ ...staff, role: "CASHIER" });
  mock.method(AuditLog, "create", async () => ({}));
  const server = await startServer("/api/purchase-orders", purchaseOrderRoutes);
  try {
    const result = await fetch(`${server.url}/api/purchase-orders/${branchA}/receive`, {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: [{ itemId: "item-a", quantity: 1 }] }),
    });
    assert.equal(result.status, 403);
  } finally {
    await server.close();
  }
});

test("branch managers cannot make an unapproved cross-branch transfer", async () => {
  mockLogin({ ...staff, role: "MANAGER" });
  mock.method(AuditLog, "create", async () => ({}));
  const server = await startServer("/api/inventory-transactions", inventoryTransactionRoutes);
  try {
    const result = await fetch(`${server.url}/api/inventory-transactions/transfer`, {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fromInventoryId: "inventory-a", toInventoryId: "inventory-b", quantity: 1 }),
    });
    assert.equal(result.status, 403);
  } finally {
    await server.close();
  }
});

test("receiving and adjusting stock query only the assigned branch", async () => {
  mockStockTransaction();
  const filters = [];
  mock.method(BranchInventory, "findOneAndUpdate", async (filter) => {
    filters.push(filter);
    return null;
  });
  mock.method(BranchInventory, "findOne", (filter) => {
    filters.push(filter);
    return { session: async () => null };
  });
  mock.method(InventoryTransaction, "create", () => assert.fail("No stock transaction should be created"));

  const received = response();
  await receiveStock({ user: staff, body: { inventoryId: "inventory-b", quantity: 2, requestId: "branch-check-receive" } }, received);
  assert.equal(received.statusCode, 404);

  const adjusted = response();
  await adjustStock({ user: staff, body: { inventoryId: "inventory-b", newQuantity: 0, reason: "Count", requestId: "branch-check-adjust" } }, adjusted);
  assert.equal(adjusted.statusCode, 404);
  assert.deepEqual(filters, [
    { _id: "inventory-b", branch: branchA },
    { _id: "inventory-b", branch: branchA },
  ]);
});

test("receiving stock still works in the assigned branch", async () => {
  mockStockTransaction();
  const inventory = {
    _id: "inventory-a",
    branch: branchA,
    product: "product-a",
    quantity: 5,
  };
  mock.method(BranchInventory, "findOneAndUpdate", async (filter) => {
    assert.deepEqual(filter, { _id: inventory._id, branch: branchA });
    return inventory;
  });
  mock.method(InventoryTransaction, "create", async (details) => [{
    ...details[0],
    async populate() {},
  }]);

  const result = response();
  await receiveStock({ user: staff, body: { inventoryId: inventory._id, quantity: 3, requestId: "own-branch-receive" } }, result);
  assert.equal(result.statusCode, 201);
  assert.equal(inventory.quantity, 5);
  assert.equal(result.body.transaction.branch, branchA);
});

test("direct inventory updates cannot change branch, stock, or reservations", async () => {
  mock.method(BranchInventory, "findOneAndUpdate", () => assert.fail("No update should run"));

  for (const changes of [
    { branch: branchB },
    { quantity: 99 },
    { reservedQuantity: 0 },
  ]) {
    const result = response();
    await updateInventory({ user: staff, params: { id: "inventory-a" }, body: changes }, result);
    assert.equal(result.statusCode, 400);
  }
});

test("allowed inventory metadata updates remain branch-scoped", async () => {
  mock.method(BranchInventory, "findOneAndUpdate", (filter, update) => {
    assert.deepEqual(filter, { _id: "inventory-a", branch: branchA });
    assert.deepEqual(update, { $set: { shelfLocation: "A-12" } });
    return {
      populate() { return this; },
      then(resolve) { resolve({ _id: "inventory-a", shelfLocation: "A-12" }); },
    };
  });

  const result = response();
  await updateInventory({ user: staff, params: { id: "inventory-a" }, body: { shelfLocation: "A-12" } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.shelfLocation, "A-12");
});

test("reservation lists reject a requested foreign branch before reading records", async () => {
  mock.method(Reservation, "find", () => assert.fail("No reservations should be queried"));
  const result = response();
  await getReservations({ user: staff, query: { branch: branchB } }, result);
  assert.equal(result.statusCode, 403);
});

test("reservation lists default to the assigned branch", async () => {
  const filters = [];
  mock.method(Reservation, "find", (filter) => {
    filters.push(filter);
    return {
      async select() { return []; },
      populate() { return this; },
      async sort() { return []; },
    };
  });
  const result = response();
  await getReservations({ user: staff, query: {} }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(filters[0].branch, branchA);
  assert.deepEqual(filters[1], { branch: branchA });
});

test("a reservation status change cannot find another branch's record", async () => {
  mock.method(Reservation, "findOne", async (filter) => {
    assert.deepEqual(filter, { _id: "reservation-b", branch: branchA });
    return null;
  });
  mock.method(BranchInventory, "findOneAndUpdate", () => assert.fail("No hold should be changed"));
  const result = response();
  await updateReservationStatus({ user: staff, params: { id: "reservation-b" }, body: { status: "CANCELLED" } }, result);
  assert.equal(result.statusCode, 404);
});

test("staff can update a reservation in their own branch", async () => {
  mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (work) => work(),
    endSession: async () => {},
  }));
  const reservation = {
    branch: branchA,
    status: "ACTIVE",
    async save() {},
  };
  mock.method(Reservation, "findOne", (filter) => {
    assert.deepEqual(filter, { _id: "reservation-a", branch: branchA });
    return {
      session: async () => reservation,
      then: (resolve) => resolve(reservation),
    };
  });
  mock.method(Reservation, "find", (filter) => {
    assert.equal(filter.branch, branchA);
    return { async select() { return []; } };
  });

  const result = response();
  await updateReservationStatus({ user: staff, params: { id: "reservation-a" }, body: { status: "READY_FOR_PICKUP" } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(reservation.status, "READY_FOR_PICKUP");
});

test("product details reveal inventory only for the assigned branch", async () => {
  mock.method(Product, "findById", () => ({
    async populate() { return { _id: "product-a", name: "Product A" }; },
  }));
  mock.method(BranchInventory, "find", (filter) => {
    assert.deepEqual(filter, { product: "product-a", branch: branchA });
    return { async populate() { return []; } };
  });
  const result = response();
  await getProduct({ user: staff, params: { id: "product-a" } }, result);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.inventory, []);
});
