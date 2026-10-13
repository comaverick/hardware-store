const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const mongoose = require("mongoose");

const BranchInventory = require("../models/BranchInventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const Product = require("../models/Product");
const Branch = require("../models/Branch");
const StockOperation = require("../models/StockOperation");
const { importInventory } = require("../controllers/branchInventoryController");

const branchA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const branchB = "bbbbbbbbbbbbbbbbbbbbbbbb";
const productA = "cccccccccccccccccccccccc";
const productB = "dddddddddddddddddddddddd";
const user = { _id: "eeeeeeeeeeeeeeeeeeeeeeee", role: "SUPER_ADMIN" };
const row = { sku: "NAIL-002", branchCode: "BR-001", quantity: 10, reorderLevel: 20, shelfLocation: "B-02" };
const inventoryKey = (branch, product) => `${branch}:${product}`;

afterEach(() => mock.restoreAll());

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const request = (rows, preview = false, actor = user, key = "inventory-import-123") => ({
  user: actor,
  body: preview ? { rows, preview: true } : { rows },
  headers: preview ? {} : { "idempotency-key": key },
});

const query = (data) => ({
  select() { return this; },
  session() { return this; },
  async lean() { return data; },
});

const setup = () => {
  const products = [
    { _id: productA, name: "Common Nail 2 inch", sku: "NAIL-002", barcode: "123456789", reorderLevel: 5 },
    { _id: productB, name: "Hammer", sku: "HAMMER-001", reorderLevel: 3 },
  ];
  const branches = [
    { _id: branchA, name: "Main Store", code: "BR-001" },
    { _id: branchB, name: "Second Store", code: "BR-002" },
  ];
  const inventory = new Map([[inventoryKey(branchA, productA), {
    branch: branchA, product: productA, quantity: 20, reservedQuantity: 8,
    reorderLevel: 5, shelfLocation: "A-01",
  }]]);
  const history = [];
  const ledger = new Map();
  const state = { commits: 0, aborts: 0, ended: 0 };
  const session = {
    async withTransaction(work) {
      const before = structuredClone(inventory);
      const historyLength = history.length;
      try {
        const result = await work();
        state.commits += 1;
        return result;
      } catch (error) {
        inventory.clear();
        before.forEach((record, key) => inventory.set(key, record));
        history.length = historyLength;
        state.aborts += 1;
        throw error;
      }
    },
    async endSession() { state.ended += 1; },
  };
  mock.method(mongoose, "startSession", async () => session);
  mock.method(Product, "find", () => query(products));
  mock.method(Branch, "find", (filter) => query(branches.filter((branch) => !filter._id || branch._id === filter._id)));
  mock.method(BranchInventory, "find", (filter) => {
    assert.ok(filter.$or.length, "Do not query MongoDB with an empty $or");
    return query(filter.$or.flatMap(({ branch, product }) => {
      const record = inventory.get(inventoryKey(branch, product));
      return record ? [structuredClone(record)] : [];
    }));
  });
  mock.method(BranchInventory, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(options.session, session);
    assert.equal(options.upsert, true);
    assert.equal(options.setDefaultsOnInsert, false);
    const key = inventoryKey(filter.branch, filter.product);
    const record = inventory.get(key) || { ...filter, quantity: 0, ...update.$setOnInsert };
    record.quantity += update.$inc.quantity;
    inventory.set(key, record);
    return structuredClone(record);
  });
  mock.method(InventoryTransaction, "insertMany", async (records, options) => {
    assert.equal(options.session, session);
    history.push(...records);
    return records;
  });
  mock.method(StockOperation, "init", async () => {});
  mock.method(StockOperation, "findOne", (filter) => query(ledger.get(filter.key) || null));
  mock.method(StockOperation, "create", async ([record], options) => {
    assert.equal(options.session, session);
    ledger.set(record.key, record);
    return [record];
  });
  return { inventory, history, ledger, session, state };
};

test("reviewing an existing record previews an addition without changing stock", async () => {
  const { inventory, state } = setup();
  const res = response();
  await importInventory(request([row], true), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.imported, 1);
  assert.equal(res.body.updated, 1);
  assert.equal(res.body.created, 0);
  assert.deepEqual(res.body.errors, []);
  assert.deepEqual(res.body.previewRows[0], {
    line: 2, productName: "Common Nail 2 inch", sku: "NAIL-002",
    branchName: "Main Store", branchCode: "BR-001", action: "Add stock",
    quantity: 10, previousQuantity: 20, newQuantity: 30, reorderLevel: 5, shelfLocation: "A-01",
  });
  assert.equal(inventory.get(inventoryKey(branchA, productA)).quantity, 20);
  assert.equal(BranchInventory.findOneAndUpdate.mock.callCount(), 0);
  assert.equal(InventoryTransaction.insertMany.mock.callCount(), 0);
  assert.equal(state.commits, 0);
});

test("confirmation restocks existing records and creates new ones with stock-in history", async () => {
  const { inventory, history, state } = setup();
  const res = response();
  await importInventory(request([row, { ...row, sku: "HAMMER-001", quantity: 7 }]), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.imported, 2);
  assert.equal(res.body.updated, 1);
  assert.equal(res.body.created, 1);
  assert.deepEqual(res.body.errors, []);
  assert.deepEqual(inventory.get(inventoryKey(branchA, productA)), {
    branch: branchA, product: productA, quantity: 30, reservedQuantity: 8,
    reorderLevel: 5, shelfLocation: "A-01",
  });
  assert.deepEqual(inventory.get(inventoryKey(branchA, productB)), {
    branch: branchA, product: productB, quantity: 7, reservedQuantity: 0,
    reorderLevel: 20, shelfLocation: "B-02",
  });
  assert.deepEqual(history.map(({ quantity, previousQuantity, newQuantity, type, performedBy }) =>
    ({ quantity, previousQuantity, newQuantity, type, performedBy })), [
    { quantity: 10, previousQuantity: 20, newQuantity: 30, type: "STOCK_IN", performedBy: user._id },
    { quantity: 7, previousQuantity: 0, newQuantity: 7, type: "STOCK_IN", performedBy: user._id },
  ]);
  assert.equal(state.commits, 1);
  assert.equal(state.ended, 1);
});

test("confirmation recalculates totals after stock changes since the preview", async () => {
  const { inventory, history } = setup();
  const rows = [{ ...row, quantity: 0.5 }];
  const preview = response();
  await importInventory(request(rows, true), preview);
  assert.equal(preview.body.previewRows[0].newQuantity, 20.5);
  inventory.get(inventoryKey(branchA, productA)).quantity = 23;
  const confirmed = response();
  await importInventory(request(rows), confirmed);
  assert.equal(inventory.get(inventoryKey(branchA, productA)).quantity, 23.5);
  assert.equal(confirmed.body.previewRows[0].newQuantity, 23.5);
  assert.equal(history[0].previousQuantity, 23);
});

test("invalid and duplicate file rows are skipped while a valid row is restocked once", async () => {
  const { inventory, history } = setup();
  const res = response();
  await importInventory(request([
    row,
    { ...row, productName: "Common Nail 2 inch", sku: "" },
    { ...row, quantity: -1 },
    { ...row, quantity: "" },
    { ...row, quantity: "not a number" },
    { ...row, sku: "UNKNOWN" },
    { ...row, branchCode: "UNKNOWN" },
    { ...row, reorderLevel: -1 },
  ]), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.imported, 1);
  assert.equal(res.body.skipped, 7);
  assert.deepEqual(res.body.errors.map((error) => error.line), [3, 4, 5, 6, 7, 8, 9]);
  assert.match(res.body.errors[0].message, /more than once/);
  assert.equal(inventory.get(inventoryKey(branchA, productA)).quantity, 30);
  assert.equal(history.length, 1);
});

test("staff cannot import another branch and an entirely invalid file needs no inventory query", async () => {
  setup();
  const res = response();
  const staff = { ...user, role: "INVENTORY_STAFF", branch: { _id: branchA } };
  await importInventory(request([{ ...row, branchCode: "BR-002" }], true, staff), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.imported, 0);
  assert.equal(res.body.skipped, 1);
  assert.match(res.body.errors[0].message, /not permitted/);
  assert.deepEqual(res.body.previewRows, []);
  assert.equal(BranchInventory.find.mock.callCount(), 0);
  assert.equal(BranchInventory.findOneAndUpdate.mock.callCount(), 0);
});

test("a retry replays the import result without adding stock or history again", async () => {
  const { inventory, history, state } = setup();
  const req = request([row]);
  const first = response();
  const retry = response();
  await importInventory(req, first);
  await importInventory(req, retry);
  assert.deepEqual(retry.body, first.body);
  assert.equal(inventory.get(inventoryKey(branchA, productA)).quantity, 30);
  assert.equal(history.length, 1);
  assert.equal(state.commits, 1);
  const changed = response();
  await importInventory(request([{ ...row, quantity: 11 }]), changed);
  assert.equal(changed.statusCode, 409);
  assert.equal(inventory.get(inventoryKey(branchA, productA)).quantity, 30);
});

test("a replay is rejected after the importing staff member changes branches", async () => {
  setup();
  const staff = { ...user, role: "INVENTORY_STAFF", branch: { _id: branchA } };
  const first = response();
  await importInventory(request([row], false, staff), first);
  assert.equal(first.statusCode, 201);
  const replay = response();
  await importInventory(request([row], false, { ...staff, branch: { _id: branchB } }), replay);
  assert.equal(replay.statusCode, 409);
  assert.match(replay.body.message, /different request/);
});

test("a history failure aborts all inventory changes and does not save the import key", async () => {
  const { inventory, ledger, state } = setup();
  mock.method(InventoryTransaction, "insertMany", async () => { throw new Error("History write failed"); });
  mock.method(console, "error", () => {});
  const res = response();
  await importInventory(request([row, { ...row, sku: "HAMMER-001" }]), res);
  assert.equal(res.statusCode, 500);
  assert.equal(state.commits, 0);
  assert.equal(state.aborts, 1);
  assert.equal(state.ended, 1);
  assert.equal(inventory.get(inventoryKey(branchA, productA)).quantity, 20);
  assert.equal(inventory.has(inventoryKey(branchA, productB)), false);
  assert.equal(ledger.size, 0);
});

test("confirming without an idempotency key is rejected before changing inventory", async () => {
  const { state } = setup();
  const res = response();
  await importInventory({ user, body: { rows: [row] } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Idempotency-Key/);
  assert.equal(BranchInventory.findOneAndUpdate.mock.callCount(), 0);
  assert.equal(state.commits, 0);
});
