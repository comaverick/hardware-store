const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createStorefrontRouter } = require("../routes/storefrontRoutes");

const branchId = "a".repeat(24);
const productId = "b".repeat(24);
const otherProductId = "c".repeat(24);

function query(value) {
  return {
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    lean: async () => value,
  };
}

test("public storefront catalog exposes active products and branch availability without private fields", async (t) => {
  const calls = [];
  const models = {
    ProductModel: {
      find: (filter) => {
        calls.push({ collection: "products", filter });
        return query([
          {
            _id: productId,
            name: "Claw hammer",
            sku: "HAM-1",
            brand: "Acme",
            category: { name: "Hand Tools", isActive: true },
            description: "Steel handle",
            sellingPrice: 245,
            unit: "piece",
            image: "",
            costPrice: 100,
            barcode: "private-barcode",
          },
          {
            _id: otherProductId,
            name: "Paint brush",
            sku: "PNT-2",
            category: { name: "Paint", isActive: true },
            sellingPrice: 90,
            unit: "piece",
          },
        ]);
      },
    },
    BranchModel: {
      find: (filter) => {
        calls.push({ collection: "branches", filter });
        return query([{ _id: branchId, name: "Main branch", code: "MAIN", address: "Private address" }]);
      },
    },
    InventoryModel: {
      find: (filter) => {
        calls.push({ collection: "inventory", filter });
        return query([{ product: productId, quantity: 8, reservedQuantity: 3, shelfLocation: "A1" }]);
      },
    },
  };

  const app = express();
  app.use("/api/storefront", createStorefrontRouter(models));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/storefront/catalog`;

  const response = await fetch(base);
  const catalog = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls.slice(0, 2).map((call) => call.filter), [{ isActive: true }, { isActive: true }]);
  assert.deepEqual(catalog.branches, [{ _id: branchId, name: "Main branch", code: "MAIN" }]);
  assert.equal(catalog.products[0].category, "Hand Tools");
  assert.equal(catalog.products[0].availableQuantity, null);
  assert.equal(catalog.products[0].costPrice, undefined);
  assert.equal(catalog.products[0].barcode, undefined);
  assert.equal(calls.some((call) => call.collection === "inventory"), false);

  const branchResponse = await fetch(`${base}?branch=${branchId}`);
  const branchCatalog = await branchResponse.json();
  assert.equal(branchResponse.status, 200);
  assert.equal(branchCatalog.products[0].availableQuantity, 5);
  assert.equal(branchCatalog.products[1].availableQuantity, 0);
  assert.equal(calls.at(-1).filter.branch, branchId);

  assert.equal((await fetch(`${base}?branch=invalid`)).status, 400);
  assert.equal((await fetch(`${base}?branch=${"d".repeat(24)}`)).status, 404);
});
