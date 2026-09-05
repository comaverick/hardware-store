/* Shared, dependency-free ScanSpace geometry and purchasing rules.
 * customer/scripts/sync-scanspace.cjs copies this into the browser build. */
const EPS = 1e-6;
const clone = (value) => JSON.parse(JSON.stringify(value));
function number(value, min, max, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}
function text(value, max = 100) {
  return Array.from(String(value || ""))
    .filter((c) => c.charCodeAt(0) >= 32 && c !== "<" && c !== ">")
    .join("")
    .trim()
    .slice(0, max);
}
function assetUrl(value) {
  if (!value) return "";
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !/^(https:\/\/[^\s]+|\/(?!\/)[^\s\\]*)$/.test(value)
  )
    throw new Error("Assets must use HTTPS or a local absolute URL.");
  return value;
}
function material(value = {}) {
  const color = value.color || "#e6e1d8";
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Invalid surface color.");
  return {
    color,
    kind: ["paint", "tile", "wood", "vinyl"].includes(value.kind)
      ? value.kind
      : "paint",
    productId: text(value.productId, 80),
    textureUrl: assetUrl(value.textureUrl),
    tileSize: number(value.tileSize ?? 0.6, 0.05, 5, "Texture size"),
    rotation: number(value.rotation ?? 0, -360, 360, "Texture rotation"),
    coats: number(value.coats ?? 2, 1, 6, "Coats"),
    waste: number(value.waste ?? 0.1, 0, 0.5, "Allowance"),
  };
}
function signedArea(p) {
  return (
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a.x * b.z - b.x * a.z;
    }, 0) / 2
  );
}
function area(p) {
  return Math.abs(signedArea(p));
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function cross(a, b, c) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}
function onSegment(p, a, b) {
  return (
    Math.abs(cross(a, b, p)) < EPS &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.z >= Math.min(a.z, b.z) - EPS &&
    p.z <= Math.max(a.z, b.z) + EPS
  );
}
function intersects(a, b, c, d) {
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 &&
      cross(c, d, a) * cross(c, d, b) < 0) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d)
  );
}
function inside(p, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (onSegment(p, a, b)) return true;
    const aIsPastPoint = a.z > p.z;
    const bIsPastPoint = b.z > p.z;
    const crossesScanline = aIsPastPoint !== bIsPastPoint;
    if (
      crossesScanline &&
      p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x
    )
      result = !result;
  }
  return result;
}
function segmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)),
    );
  return distance(p, { x: a.x + t * dx, z: a.z + t * dz });
}
function footprint(item) {
  const { width, depth } = item.dimensions,
    c = Math.cos(item.rotation),
    s = Math.sin(item.rotation);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => ({
    x: item.position.x + ((x * width) / 2) * c + ((z * depth) / 2) * s,
    z: item.position.z - ((x * width) / 2) * s + ((z * depth) / 2) * c,
  }));
}
function placementValid(item, polygon) {
  const f = footprint(item);
  return (
    f.every((p) => inside(p, polygon)) &&
    f.every((p, i) => {
      const b = f[(i + 1) % 4];
      return polygon.every((a, j) => {
        const d = polygon[(j + 1) % polygon.length];
        return !(
          cross(p, b, a) * cross(p, b, d) < -EPS &&
          cross(a, d, p) * cross(a, d, b) < -EPS
        );
      });
    })
  );
}
function walkable(p, room, radius = 0.18) {
  if (
    !inside(p, room.floorPolygon) ||
    room.walls.some((w) => segmentDistance(p, w.start, w.end) < radius)
  )
    return false;
  return !room.placedProducts.some((item) => {
    const f = footprint(item);
    return (
      item.position.y < 1.7 &&
      item.position.y + item.dimensions.height > 0.15 &&
      (inside(p, f) ||
        f.some((a, i) => segmentDistance(p, a, f[(i + 1) % 4]) < radius))
    );
  });
}
function roomCenter(room) {
  const p = room.floorPolygon,
    center = {
      x: p.reduce((s, v) => s + v.x, 0) / p.length,
      z: p.reduce((s, v) => s + v.z, 0) / p.length,
    };
  if (walkable(center, room)) return center;
  const xs = p.map((v) => v.x),
    zs = p.map((v) => v.z);
  let best = center,
    bestDistance = Infinity;
  const step = Math.max(
    0.2,
    Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs),
    ) / 100,
  );
  for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += step)
    for (let z = Math.min(...zs) + 0.25; z < Math.max(...zs); z += step) {
      const d = distance({ x, z }, center);
      if (d < bestDistance && walkable({ x, z }, room, 0.25)) {
        best = { x, z };
        bestDistance = d;
      }
    }
  return best;
}
function normalizeRoom(input) {
  if (!input || typeof input !== "object")
    throw new Error("A room is required.");
  if (
    !Array.isArray(input.floorPolygon) ||
    input.floorPolygon.length < 3 ||
    input.floorPolygon.length > 32
  )
    throw new Error("A room needs 3 to 32 corners.");
  const polygon = input.floorPolygon.map((p) => ({
    x: number(p.x, -50, 50, "Corner X"),
    z: number(p.z, -50, 50, "Corner Z"),
  }));
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (distance(a, b) < 0.2)
      throw new Error("Walls must be at least 20 cm long.");
    for (let j = i + 1; j < polygon.length; j++)
      if (
        j !== i + 1 &&
        !(i === 0 && j === polygon.length - 1) &&
        intersects(a, b, polygon[j], polygon[(j + 1) % polygon.length])
      )
        throw new Error("Room edges overlap or cross.");
  }
  number(area(polygon), 1, 2500, "Floor area");
  const height = number(input.ceilingHeight, 1.8, 8, "Ceiling height");
  const walls = polygon.map((start, i) => {
    const end = polygon[(i + 1) % polygon.length],
      length = distance(start, end),
      src = input.walls?.[i] || {};
    if (
      src.openings &&
      (!Array.isArray(src.openings) || src.openings.length > 16)
    )
      throw new Error("Too many wall openings.");
    const openings = (src.openings || []).map((o, k) => ({
      id: text(o.id || `opening-${k}`, 80),
      type: o.type === "door" ? "door" : "window",
      offset: number(o.offset, 0, length, "Opening offset"),
      bottom: number(o.bottom, 0, height, "Opening bottom"),
      width: number(o.width, 0.1, length, "Opening width"),
      height: number(o.height, 0.1, height, "Opening height"),
    }));
    openings.forEach((o, k) => {
      if (
        o.offset + o.width > length + EPS ||
        o.bottom + o.height > height + EPS
      )
        throw new Error("Opening extends beyond its wall.");
      if (
        openings
          .slice(k + 1)
          .some(
            (b) =>
              o.offset < b.offset + b.width - EPS &&
              o.offset + o.width > b.offset + EPS &&
              o.bottom < b.bottom + b.height - EPS &&
              o.bottom + o.height > b.bottom + EPS,
          )
      )
        throw new Error("Wall openings overlap.");
    });
    return {
      id: `wall-${i}`,
      start,
      end,
      height,
      openings,
      material: material(src.material),
    };
  });
  if (
    input.placedProducts &&
    (!Array.isArray(input.placedProducts) || input.placedProducts.length > 80)
  )
    throw new Error("A room supports at most 80 objects.");
  const placedProducts = (input.placedProducts || []).map((o, i) => {
    const d = o.dimensions || {},
      p = o.position || {};
    const item = {
      id: text(o.id || `object-${i}`, 80),
      productId: text(o.productId, 80),
      name: text(o.name || "Object"),
      modelUrl: assetUrl(o.modelUrl),
      color: material({ color: o.color || "#ad8563" }).color,
      position: {
        x: number(p.x, -50, 50, "Object X"),
        y: number(p.y ?? 0, 0, height, "Object Y"),
        z: number(p.z, -50, 50, "Object Z"),
      },
      rotation: number(
        o.rotation ?? 0,
        -Math.PI * 20,
        Math.PI * 20,
        "Object rotation",
      ),
      dimensions: {
        width: number(d.width, 0.05, 20, "Object width"),
        height: number(d.height, 0.05, 8, "Object height"),
        depth: number(d.depth, 0.05, 20, "Object depth"),
      },
    };
    if (
      !placementValid(item, polygon) ||
      item.position.y + item.dimensions.height > height + EPS
    )
      throw new Error("An object is outside the room.");
    return item;
  });
  if (new Set(placedProducts.map((o) => o.id)).size !== placedProducts.length)
    throw new Error("Object IDs must be unique.");
  const sm = input.scanMetadata || {};
  return {
    version: 1,
    name: text(input.name) || "My room",
    unit: "meters",
    floorPolygon: polygon,
    ceilingHeight: height,
    walls,
    floorMaterial: material(input.floorMaterial),
    ceilingMaterial: material(input.ceilingMaterial),
    placedProducts,
    scanMetadata: {
      mode: ["depth", "assisted", "manual", "sample"].includes(sm.mode)
        ? sm.mode
        : "manual",
      depthSupported: sm.depthSupported === true,
      capturedColorSupported: sm.capturedColorSupported === true,
      depthFrames: number(sm.depthFrames ?? 0, 0, 1e7, "Frame count"),
      pointCount: number(sm.pointCount ?? 0, 0, 1e6, "Point count"),
      confidence: number(sm.confidence ?? 0, 0, 1, "Scan quality"),
      deviceInfo: text(sm.deviceInfo, 250),
    },
  };
}
function rectangle(width = 4, length = 5, height = 2.7) {
  return normalizeRoom({
    name: "My room",
    floorPolygon: [
      { x: 0, z: 0 },
      { x: width, z: 0 },
      { x: width, z: length },
      { x: 0, z: length },
    ],
    ceilingHeight: height,
    floorMaterial: { kind: "wood", color: "#b99d7a", tileSize: 0.2 },
    walls: [],
    scanMetadata: { mode: "manual" },
  });
}
function surfaceAreas(room) {
  const walls = room.walls.map((w) => {
    const gross = distance(w.start, w.end) * w.height,
      openings = w.openings.reduce((s, o) => s + o.width * o.height, 0);
    return { id: w.id, gross, openings, net: gross - openings };
  });
  return {
    floor: area(room.floorPolygon),
    walls,
    wallNet: walls.reduce((s, w) => s + w.net, 0),
  };
}
// Bounded knapsack in centilitres. Minimize cost, then excess volume. Stock is respected.
function optimizePackages(liters, variants) {
  const target = Math.ceil(liters * 100 - 1e-7);
  if (target <= 0) return [];
  if (target > 200000 || variants.length > 12 || !variants.length)
    throw new Error("Paint requirement or package group is too large.");
  const options = variants.map((v) => ({
    ...v,
    units: Math.round(number(v.volume, 0.01, 100, "Package volume") * 100),
    stock: Math.floor(number(v.stock, 0, 1e7, "Available stock")),
    cents: Math.round(number(v.price, 0, 1e7, "Price") * 100),
  }));
  const cap = target + Math.max(...options.map((o) => o.units)),
    costs = new Float64Array(cap + 1).fill(Infinity),
    paths = new Array(cap + 1);
  costs[0] = 0;
  paths[0] = null;
  options.forEach((v, index) => {
    let left = Math.min(v.stock, Math.ceil(cap / v.units)),
      chunk = 1;
    while (left > 0) {
      const qty = Math.min(left, chunk),
        vol = qty * v.units,
        cost = qty * v.cents;
      for (let n = cap; n >= vol; n--)
        if (costs[n - vol] + cost < costs[n]) {
          costs[n] = costs[n - vol] + cost;
          paths[n] = { index, qty, previous: paths[n - vol] };
        }
      left -= qty;
      chunk *= 2;
    }
  });
  let best = -1;
  for (let n = target; n <= cap; n++)
    if (Number.isFinite(costs[n]) && (best < 0 || costs[n] < costs[best]))
      best = n;
  if (best < 0) throw new Error("Not enough available paint in this branch.");
  const counts = new Map();
  for (let p = paths[best]; p; p = p.previous)
    counts.set(p.index, (counts.get(p.index) || 0) + p.qty);
  return [...counts].map(([i, quantity]) => ({
    productId: String(options[i].id),
    quantity,
    volume: options[i].volume,
  }));
}
function estimateRoom(raw, products, inventory) {
  const room = normalizeRoom(raw),
    areas = surfaceAreas(room),
    map = new Map(
      products
        .filter((p) => p.isActive !== false && p.scanSpace?.enabled)
        .map((p) => [String(p._id), p]),
    );
  const available = (id) =>
    Math.max(
      0,
      (inventory.find((i) => String(i.product) === String(id))?.quantity || 0) -
        (inventory.find((i) => String(i.product) === String(id))
          ?.reservedQuantity || 0),
    );
  const calculations = [],
    lines = new Map();
  const get = (id) => {
    const p = map.get(id);
    if (!p)
      throw new Error(
        "A selected product is unavailable or not configured for ScanSpace.",
      );
    return p;
  };
  const add = (id, qty) => {
    const p = get(id);
    number(p.sellingPrice, 0, 1e7, "Product price");
    lines.set(id, {
      productId: id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      unitPrice: p.sellingPrice,
      quantity: (lines.get(id)?.quantity || 0) + qty,
      available: available(id),
    });
  };
  const groups = new Map();
  room.walls.forEach((w, i) => {
    if (!w.material.productId) return;
    const key = `${w.material.productId}:${w.material.coats}:${w.material.waste}`;
    const g = groups.get(key) || {
      material: w.material,
      net: 0,
      gross: 0,
      openings: 0,
    };
    g.net += areas.walls[i].net;
    g.gross += areas.walls[i].gross;
    g.openings += areas.walls[i].openings;
    groups.set(key, g);
  });
  for (const g of groups.values()) {
    const p = get(g.material.productId),
      m = p.scanSpace;
    if (m.materialType !== "paint")
      throw new Error("Wall products must be paint.");
    const coverage = number(m.coveragePerLiter, 0.1, 50, "Paint coverage"),
      coats = g.material.coats,
      waste = g.material.waste,
      rawLiters = (g.net * coats) / coverage,
      required = rawLiters * (1 + waste);
    const variants = [...map.values()].filter(
      (v) =>
        String(v._id) === String(p._id) ||
        (m.variantGroup &&
          v.scanSpace.variantGroup === m.variantGroup &&
          v.scanSpace.materialType === "paint" &&
          v.scanSpace.color === m.color &&
          v.scanSpace.coveragePerLiter === coverage),
    );
    const packages = optimizePackages(
      required,
      variants.map((v) => ({
        id: String(v._id),
        volume: v.scanSpace.packageVolume,
        price: v.sellingPrice,
        stock: Math.max(
          0,
          available(v._id) - (lines.get(String(v._id))?.quantity || 0),
        ),
      })),
    );
    packages.forEach((q) => add(q.productId, q.quantity));
    calculations.push({
      kind: "paint",
      name: p.name,
      area: g.net,
      grossArea: g.gross,
      openingArea: g.openings,
      coats,
      coverage,
      waste,
      rawRequirement: rawLiters,
      required,
      unit: "L",
      packages,
    });
  }
  if (room.floorMaterial.productId) {
    const p = get(room.floorMaterial.productId),
      m = p.scanSpace;
    if (!["tile", "wood", "vinyl"].includes(m.materialType))
      throw new Error("Select a flooring product for the floor.");
    const coverage = number(m.coveragePerPack, 0.01, 100, "Floor coverage"),
      waste = room.floorMaterial.waste,
      required = areas.floor * (1 + waste),
      quantity = Math.ceil(required / coverage - 1e-8);
    add(String(p._id), quantity);
    calculations.push({
      kind: "floor",
      name: p.name,
      area: areas.floor,
      coverage,
      waste,
      rawRequirement: areas.floor,
      required,
      quantity,
      unit: "m²",
    });
  }
  room.placedProducts.forEach((o) => {
    if (o.productId) {
      const p = get(o.productId);
      if (p.scanSpace.materialType !== "object")
        throw new Error("Placed products must be furniture or fixtures.");
      add(o.productId, 1);
    }
  });
  const items = [...lines.values()].map((l) => ({
    ...l,
    total: Math.round(l.quantity * l.unitPrice * 100) / 100,
    inStock: l.quantity <= l.available,
  }));
  return {
    areas,
    calculations,
    items,
    total: Math.round(items.reduce((s, l) => s + l.total, 0) * 100) / 100,
    canAdd: items.length > 0 && items.every((l) => l.inStock),
    currency: "PHP",
    estimatedAt: new Date().toISOString(),
  };
}
module.exports = {
  clone,
  number,
  text,
  assetUrl,
  material,
  area,
  signedArea,
  distance,
  inside,
  segmentDistance,
  footprint,
  placementValid,
  walkable,
  roomCenter,
  normalizeRoom,
  rectangle,
  surfaceAreas,
  optimizePackages,
  estimateRoom,
};
