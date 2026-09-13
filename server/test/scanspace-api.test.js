const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createScanSpaceRouter } = require("../routes/scanSpaceRoutes");
const { rectangle } = require("../lib/scanspaceDomain");
const branch = "a".repeat(24),
  product = "b".repeat(24),
  project = "c".repeat(24),
  key = "d".repeat(64),
  otherKey = "e".repeat(64);
function query(value) {
  return {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => value,
    then: (resolve) => Promise.resolve(value).then(resolve),
  };
}
test("project ownership, revisions, save/load and cart contract (in-memory database doubles)", async (t) => {
  let saved = null;
  const matches = (q) =>
    saved &&
    q.ownerHash === saved.ownerHash &&
    (!q._id || q._id === saved._id) &&
    (!q.revision || q.revision === saved.revision);
  const models = {
    Project: {
      find: (q) => query(matches(q) ? [saved] : []),
      countDocuments: async () => 0,
      create: async (p) => (saved = { ...p, _id: project, revision: 1 }),
      findOne: (q) => query(matches(q) ? saved : null),
      findOneAndUpdate: async (q, u) => {
        if (!matches(q)) return null;
        saved = { ...saved, ...u.$set, revision: saved.revision + 1 };
        return saved;
      },
      findOneAndDelete: async (q) => {
        if (!matches(q)) return null;
        const result = saved;
        saved = null;
        return result;
      },
    },
    Product: {
      find: () =>
        query([
          {
            _id: product,
            name: "Test floor",
            sellingPrice: 100,
            unit: "box",
            scanSpace: {
              enabled: true,
              materialType: "wood",
              coveragePerPack: 2,
            },
          },
        ]),
    },
    Branch: {
      find: () => query([{ _id: branch, name: "Test branch" }]),
      exists: async () => true,
    },
    Inventory: {
      find: () => query([{ product, quantity: 100, reservedQuantity: 0 }]),
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/scanspace", createScanSpaceRouter(models));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/scanspace`;
  const call = (route, method = "GET", body, token = key) =>
    fetch(base + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-ScanSpace-Key": token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  assert.equal((await call("/projects", "GET", null, null)).status, 401);
  const room = rectangle();
  room.floorMaterial.productId = product;
  const created = await call("/projects", "POST", { room });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).room.name, room.name);
  assert.equal(
    (await call(`/projects/${project}`, "GET", null, otherKey)).status,
    404,
  );
  const loaded = await call(`/projects/${project}`);
  const data = await loaded.json();
  assert.deepEqual(data.room, room);
  assert.equal(data.ownerHash, undefined);
  const changed = await call(`/projects/${project}`, "PATCH", {
    room: { ...room, name: "Renamed" },
    revision: 1,
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (await call(`/projects/${project}`, "PATCH", { room, revision: 1 })).status,
    409,
  );
  const priced = await call("/cart-lines", "POST", {
    room,
    branch,
    total: 0,
    items: [{ productId: product, quantity: 1, unitPrice: 0 }],
  });
  const cart = await priced.json();
  assert.equal(priced.status, 200);
  assert.equal(cart.total, 1100);
  assert.equal(cart.items[0].quantity, 11);
  assert.equal(cart.stockReserved, false);
  assert.equal(
    (await call(`/projects/${project}`, "DELETE", null, otherKey)).status,
    404,
  );
  assert.equal((await call(`/projects/${project}`, "DELETE")).status, 204);
});

test("a one-time transfer code copies a saved room to another browser owner", async (t) => {
  const projects = [];
  let sequence = 0;
  const matches = (item, criteria) =>
    (!criteria._id || criteria._id === item._id) &&
    (!criteria.ownerHash || criteria.ownerHash === item.ownerHash) &&
    (!criteria.transferHash || criteria.transferHash === item.transferHash);
  const Project = {
    find: (criteria) => query(projects.filter((item) => matches(item, criteria))),
    countDocuments: async (criteria) =>
      projects.filter((item) => matches(item, criteria)).length,
    create: async (values) => {
      const item = {
        ...values,
        _id: String(++sequence).padStart(24, "0"),
        revision: 1,
        updatedAt: new Date(),
      };
      projects.push(item);
      return item;
    },
    findOneAndUpdate: async (criteria, update, options = {}) => {
      const item = projects.find((candidate) => matches(candidate, criteria));
      if (!item) return null;
      const previous = { ...item };
      Object.assign(item, update.$set || {});
      Object.keys(update.$unset || {}).forEach((field) => delete item[field]);
      if (update.$inc?.revision) item.revision += update.$inc.revision;
      return options.new === false ? previous : item;
    },
  };
  const models = {
    Project,
    Product: { find: () => query([]) },
    Branch: { find: () => query([]), exists: async () => false },
    Inventory: { find: () => query([]) },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/scanspace", createScanSpaceRouter(models));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/scanspace`;
  const call = (route, method = "GET", body, token = key) =>
    fetch(base + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-ScanSpace-Key": token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  const room = { ...rectangle(), name: "Phone scan" };
  const created = await call("/projects", "POST", { room });
  const phoneProject = await created.json();
  const transfer = await call(
    `/projects/${phoneProject._id}/transfer`,
    "POST",
  );
  assert.equal(transfer.status, 200);
  const { code } = await transfer.json();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const claimed = await call(
    "/transfers/claim",
    "POST",
    { code },
    otherKey,
  );
  assert.equal(claimed.status, 201);
  const pcProject = await claimed.json();
  assert.notEqual(pcProject._id, phoneProject._id);
  assert.equal(pcProject.room.name, "Phone scan");
  assert.equal((await call("/projects", "GET", null, otherKey)).status, 200);
  assert.equal(
    (await call("/transfers/claim", "POST", { code }, otherKey)).status,
    404,
  );
});
