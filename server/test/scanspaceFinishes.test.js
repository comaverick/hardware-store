const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Branch = require("../models/Branch");
const Inventory = require("../models/BranchInventory");
const { finishProducts, seed } = require("../seedScanSpaceFinishes");
const { paintColors, paintFinishes, floorFinishes } = require("../../customer/src/features/scanspace/finishCatalog.json");

test("every room finish has a distinct valid purchasable product at the presentation price", async () => {
  const products = finishProducts();
  assert.equal(products.length, 28);
  assert.equal(new Set(products.map(product => product.sku)).size, products.length);
  for (const product of products) {
    await new Product({ ...product, category: new mongoose.Types.ObjectId() }).validate();
  }
  for (const color of paintColors) for (const finish of paintFinishes) {
    const matches = products.filter(product => product.scanSpace.color === color.color && product.scanSpace.paintFinish === finish);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sellingPrice, 980);
    assert.equal(matches[0].unit, "piece");
    assert.equal(matches[0].scanSpace.packageVolume, 4);
    assert.equal(matches[0].image, `/assets/scanspace/paint-${color.id}.png`);
  }
  for (const finish of floorFinishes) {
    const matches = products.filter(product => product.scanSpace.floorFinishId === finish.id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].scanSpace.materialType, finish.kind.toLowerCase());
    assert.equal(matches[0].unit, "box");
    assert.ok(matches[0].sellingPrice >= 720 && matches[0].sellingPrice <= 1600);
    assert.ok(matches[0].scanSpace.coveragePerPack > 0);
    assert.equal(matches[0].image, `/assets/scanspace/floor-${finish.id}.png`);
  }
});

test("seeding inserts missing stock atomically and reruns preserve existing prices and reserved quantities", async t => {
  const definition = finishProducts()[0];
  const products = new Map([[definition.sku, { ...definition, _id: "existing", image: "", sellingPrice: 123 }]]);
  const inventory = new Map([["existing:branch-one", { quantity: 7, reservedQuantity: 2 }]]);
  const query = value => ({ select() { return this; }, lean: async () => value });
  t.mock.method(Branch, "find", () => query([{ _id: "branch-one" }, { _id: "branch-two" }]));
  t.mock.method(Product, "find", () => query([...products.values()]));
  t.mock.method(Category, "findOneAndUpdate", async ({ name }) => ({ _id: name }));
  t.mock.method(mongoose.connection, "transaction", async callback => callback({ transaction: true }));
  t.mock.method(Product, "findOneAndUpdate", async ({ sku }, update, options) => {
    assert.equal(options.session.transaction, true);
    if (!products.has(sku)) products.set(sku, { ...update.$setOnInsert, _id: sku });
    return products.get(sku);
  });
  t.mock.method(Product, "updateOne", async (filter, update, options) => {
    assert.equal(options.session.transaction, true);
    assert.deepEqual(filter.$or, [{ image: { $exists: false } }, { image: "" }, { image: null }]);
    const product = [...products.values()].find(item => item._id === filter._id);
    if (product.image) return { modifiedCount: 0 };
    product.image = update.$set.image;
    return { modifiedCount: 1 };
  });
  t.mock.method(Inventory, "updateOne", async ({ product, branch }, update, options) => {
    assert.equal(options.session.transaction, true);
    const key = `${product}:${branch}`;
    if (inventory.has(key)) return { upsertedCount: 0 };
    inventory.set(key, update.$setOnInsert);
    return { upsertedCount: 1 };
  });
  const preview = await seed();
  assert.equal(preview.productsToAdd, 27);
  assert.equal(preview.productsNeedingImages, 1);
  assert.equal(products.size, 1);
  const first = await seed({ apply: true });
  assert.equal(first.productsAdded, 27);
  assert.equal(first.inventoryAdded, 55);
  assert.equal(first.imagesAdded, 1);
  assert.equal(products.get(definition.sku).image, definition.image);
  assert.equal(products.get(definition.sku).sellingPrice, 123);
  assert.deepEqual(inventory.get("existing:branch-one"), { quantity: 7, reservedQuantity: 2 });
  assert.equal(inventory.get("existing:branch-two").quantity, 20);
  products.get(definition.sku).image = "https://example.com/store-photo.png";
  const second = await seed({ apply: true });
  assert.equal(second.productsAdded, 0);
  assert.equal(second.inventoryAdded, 0);
  assert.equal(second.imagesAdded, 0);
  assert.equal(products.get(definition.sku).image, "https://example.com/store-photo.png");
  assert.deepEqual(inventory.get("existing:branch-one"), { quantity: 7, reservedQuantity: 2 });
});
