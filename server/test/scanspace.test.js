const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const D = require("../lib/scanspaceDomain");

test("browser and server run identical domain rules", () => {
  assert.equal(
    fs.readFileSync(
      path.resolve(__dirname, "../lib/scanspaceDomain.js"),
      "utf8",
    ),
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../customer/src/features/scanspace/core/domain.js",
      ),
      "utf8",
    ),
  );
});
test("room roundtrip and opening subtraction", () => {
  const room = D.rectangle(4, 5, 2.7);
  room.walls[0].openings = [
    {
      id: "door",
      type: "door",
      offset: 0.3,
      bottom: 0,
      width: 0.9,
      height: 2.1,
    },
  ];
  const valid = D.normalizeRoom(room);
  assert.deepEqual(D.normalizeRoom(JSON.parse(JSON.stringify(valid))), valid);
  const a = D.surfaceAreas(valid);
  assert.equal(a.floor, 20);
  assert.ok(Math.abs(a.wallNet - (18 * 2.7 - 1.89)) < 1e-8);
});
test("rejects unsafe geometry and overlapping openings", () => {
  for (const bad of [NaN, Infinity, -1, 20]) {
    const r = D.rectangle();
    r.ceilingHeight = bad;
    assert.throws(() => D.normalizeRoom(r));
  }
  const r = D.rectangle();
  r.floorPolygon = [
    { x: 0, z: 0 },
    { x: 4, z: 5 },
    { x: 4, z: 0 },
    { x: 0, z: 5 },
  ];
  assert.throws(() => D.normalizeRoom(r), /cross/);
  const b = D.rectangle();
  b.walls[0].openings = [
    { offset: 0, bottom: 0, width: 2, height: 2 },
    { offset: 1, bottom: 0, width: 2, height: 2 },
  ];
  assert.throws(() => D.normalizeRoom(b), /overlap/);
});
test("concave room furniture cannot bridge outside edges", () => {
  const polygon = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 1 },
    { x: 1, z: 1 },
    { x: 1, z: 4 },
    { x: 0, z: 4 },
  ];
  assert.equal(
    D.placementValid(
      {
        dimensions: { width: 2, depth: 2 },
        position: { x: 1, z: 1 },
        rotation: 0,
      },
      polygon,
    ),
    false,
  );
});
test("camera collision and reset position avoid objects", () => {
  const r = D.rectangle();
  r.placedProducts = [
    {
      position: { x: 2, y: 0, z: 2.5 },
      dimensions: { width: 1, depth: 1, height: 1 },
      rotation: 0,
    },
  ];
  assert.equal(D.walkable({ x: 2, z: 2.5 }, r), false);
  assert.equal(D.walkable({ x: 0.05, z: 1 }, r), false);
  assert.equal(D.walkable(D.roomCenter(r), r), true);
});
test("paint packages honor stock and minimize price", () => {
  const result = D.optimizePackages(9.9, [
    { id: "one", volume: 1, price: 300, stock: 50 },
    { id: "five", volume: 5, price: 1000, stock: 2 },
  ]);
  assert.deepEqual(result, [{ productId: "five", quantity: 2, volume: 5 }]);
  assert.throws(
    () =>
      D.optimizePackages(11, [
        { id: "five", volume: 5, price: 1000, stock: 2 },
      ]),
    /Not enough/,
  );
});
test("package optimizer agrees with brute-force optimum for bounded combinations", () => {
  for (let target = 0.5; target < 15; target += 0.5) {
    const variants = [
      { id: "a", volume: 1, price: 3, stock: 3 },
      { id: "b", volume: 2.5, price: 6, stock: 4 },
      { id: "c", volume: 5, price: 11, stock: 2 },
    ];
    let best = Infinity;
    for (let a = 0; a <= 3; a++)
      for (let b = 0; b <= 4; b++)
        for (let c = 0; c <= 2; c++)
          if (a + b * 2.5 + c * 5 >= target)
            best = Math.min(best, a * 3 + b * 6 + c * 11);
    const counts = D.optimizePackages(target, variants);
    const cost = counts.reduce(
      (s, q) =>
        s + q.quantity * variants.find((v) => v.id === q.productId).price,
      0,
    );
    assert.equal(cost, best);
    counts.forEach((q) =>
      assert.ok(q.quantity <= variants.find((v) => v.id === q.productId).stock),
    );
  }
});
function catalog() {
  return [
    {
      _id: "paint",
      isActive: true,
      name: "Paint",
      sellingPrice: 1000,
      unit: "piece",
      scanSpace: {
        enabled: true,
        materialType: "paint",
        coveragePerLiter: 10,
        packageVolume: 5,
      },
    },
    {
      _id: "floor",
      name: "Flooring",
      sellingPrice: 1500,
      unit: "box",
      scanSpace: { enabled: true, materialType: "wood", coveragePerPack: 2.2 },
    },
  ];
}
test("estimator ignores client prices and uses actual stock and whole flooring packs", () => {
  const r = D.rectangle(4, 5, 2.7);
  r.walls.forEach((w) => (w.material.productId = "paint"));
  r.floorMaterial.productId = "floor";
  r.sellingPrice = 0;
  r.floorMaterial.price = 1;
  const result = D.estimateRoom(r, catalog(), [
    { product: "paint", quantity: 10, reservedQuantity: 0 },
    { product: "floor", quantity: 10, reservedQuantity: 1 },
  ]);
  assert.equal(result.items.find((i) => i.productId === "floor").quantity, 10);
  assert.equal(result.items.find((i) => i.productId === "paint").quantity, 3);
  assert.equal(result.total, 18000);
  assert.equal(result.canAdd, false);
});
test("inactive and unknown products fail closed", () => {
  const r = D.rectangle();
  r.walls[0].material.productId = "missing";
  assert.throws(() => D.estimateRoom(r, catalog(), []), /unavailable/);
  r.walls[0].material.productId = "paint";
  const p = catalog();
  p[0].isActive = false;
  assert.throws(() => D.estimateRoom(r, p, []), /unavailable/);
});
test("invalid object assets and dimensions are rejected", () => {
  const r = D.rectangle();
  r.placedProducts = [
    {
      id: "o",
      position: { x: 2, y: 0, z: 2 },
      dimensions: { width: 1, height: 1, depth: 1 },
      modelUrl: "javascript:alert(1)",
    },
  ];
  assert.throws(() => D.normalizeRoom(r), /HTTPS/);
});
