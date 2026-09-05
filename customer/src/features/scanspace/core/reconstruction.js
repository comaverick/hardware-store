import { normalizeRoom, area, distance } from "./domain";

function clip(poly, nx, nz, d) {
  const result = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = nx * a.x + nz * a.z - d,
      db = nx * b.x + nz * b.z - d;
    if (da <= 1e-7) result.push(a);
    const aIsInside = da < 0;
    const bIsInside = db < 0;
    if (aIsInside !== bIsInside) {
      const t = da / (da - db);
      result.push({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
    }
  }
  return result;
}
function heightPeak(points, min, max) {
  const bins = new Map();
  points.forEach((p) => {
    if (p.y >= min && p.y <= max) {
      const k = Math.round(p.y / 0.04);
      const b = bins.get(k) || [];
      b.push(p.y);
      bins.set(k, b);
    }
  });
  const b = [...bins.values()].sort((a, b) => b.length - a.length)[0];
  return b && b.length >= 30 ? b.reduce((s, v) => s + v, 0) / b.length : null;
}

// Conservative convex enclosure fitting. Unbounded/partial observations never become a room.
// Re-entrant (L-shaped) rooms use the assisted polygon workflow instead.
export function reconstructRoom(points, options = {}) {
  if (points.length < 300)
    throw new Error(
      "Too little stable depth. Scan every wall slowly, or mark the floor corners.",
    );
  const floor = options.floorY ?? heightPeak(points, -2, 0.6);
  if (floor === null)
    throw new Error(
      "The floor was not observed. Point down and calibrate the floor.",
    );
  const ceiling = heightPeak(points, floor + 1.8, floor + 5);
  const height = ceiling === null ? options.height : ceiling - floor;
  if (!height || height < 1.8 || height > 8)
    throw new Error("Enter the measured ceiling height, or scan the ceiling.");
  let remaining = points.filter(
    (p) => p.y > floor + 0.3 && p.y < floor + height - 0.25,
  );
  const origin = options.observer || {
    x: remaining.reduce((s, p) => s + p.x, 0) / remaining.length,
    z: remaining.reduce((s, p) => s + p.z, 0) / remaining.length,
  };
  const planes = [];
  let seed = 84729;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let plane = 0; plane < 10 && remaining.length > 60; plane++) {
    let best = null;
    for (let trial = 0; trial < 160; trial++) {
      const a = remaining[Math.floor(random() * remaining.length)],
        b = remaining[Math.floor(random() * remaining.length)];
      const len = distance(a, b);
      if (len < 0.8) continue;
      let nx = (b.z - a.z) / len,
        nz = -(b.x - a.x) / len,
        d = nx * a.x + nz * a.z;
      if (nx * origin.x + nz * origin.z > d) {
        nx = -nx;
        nz = -nz;
        d = -d;
      }
      const inliers = remaining.filter(
        (p) => Math.abs(nx * p.x + nz * p.z - d) < 0.065,
      );
      if (inliers.length < 50) continue;
      const ys = inliers.map((p) => p.y),
        ysMin = Math.min(...ys),
        ysMax = Math.max(...ys);
      if (ysMax - ysMin < Math.min(1, height * 0.45)) continue;
      const score = inliers.length;
      if (!best || score > best.score) best = { nx, nz, d, inliers, score };
    }
    if (!best) break;
    // Robust mean offset reduces single-sample plane bias.
    const ds = best.inliers
      .map((p) => best.nx * p.x + best.nz * p.z)
      .sort((a, b) => a - b);
    best.d = ds[Math.floor(ds.length / 2)];
    const duplicate = planes.some(
      (p) =>
        p.nx * best.nx + p.nz * best.nz > 0.98 && Math.abs(p.d - best.d) < 0.2,
    );
    if (!duplicate) planes.push(best);
    remaining = remaining.filter(
      (p) => Math.abs(best.nx * p.x + best.nz * p.z - best.d) > 0.09,
    );
  }
  if (planes.length < 3)
    throw new Error(
      "Not enough full-height walls were observed. Scan all sides or mark the corners.",
    );
  let polygon = [
    { x: -50, z: -50 },
    { x: 50, z: -50 },
    { x: 50, z: 50 },
    { x: -50, z: 50 },
  ];
  planes
    .sort((a, b) => b.score - a.score)
    .forEach((p) => {
      polygon = clip(polygon, p.nx, p.nz, p.d);
    });
  polygon = polygon.filter(
    (p, i) => distance(p, polygon[(i + 1) % polygon.length]) > 0.2,
  );
  if (
    polygon.length < 3 ||
    polygon.some((p) => Math.abs(p.x) > 49 || Math.abs(p.z) > 49) ||
    area(polygon) < 1
  )
    throw new Error(
      "The scan does not enclose a room yet. Capture missing walls, or use assisted corners.",
    );
  const boundary = polygon.map((p, i) => {
    const b = polygon[(i + 1) % polygon.length],
      len = distance(p, b);
    const support = points.filter(
      (v) =>
        Math.abs((b.z - p.z) * (v.x - p.x) - (b.x - p.x) * (v.z - p.z)) / len <
          0.12 &&
        v.y > floor + 0.3 &&
        v.y < floor + height - 0.2,
    );
    const projections = support
      .map((v) => ((v.x - p.x) * (b.x - p.x) + (v.z - p.z) * (b.z - p.z)) / len)
      .filter((t) => t >= 0 && t <= len);
    const covered =
      (new Set(projections.map((t) => Math.floor(t / 0.25))).size * 0.25) / len;
    if (support.length < 40 || covered < 0.5)
      throw new Error(
        "A proposed wall has insufficient coverage. Continue scanning it or correct the outline manually.",
      );
    return { material: { color: "#e6e1d8" }, openings: [] };
  });
  const room = normalizeRoom({
    name: "Scanned room",
    floorPolygon: polygon,
    ceilingHeight: height,
    walls: boundary,
    scanMetadata: {
      mode: "depth",
      depthSupported: true,
      capturedColorSupported: points.some((p) => p.color),
      pointCount: points.length,
      depthFrames: options.depthFrames || 0,
      confidence: Math.min(0.95, points.length / 16000),
    },
  });
  return {
    room,
    floorY: floor,
    planes: planes.length,
    ceilingMeasured: ceiling !== null,
  };
}

// Texture only observed surface pixels. Unobserved texels retain a neutral background.
// This is a measured-color atlas, not generative filling or fabricated room photography.
export function surfaceTextures(room, points, floorY) {
  const result = {};
  if (!points.some((p) => p.color)) return result;
  room.walls.forEach((w) => {
    const len = distance(w.start, w.end),
      resX = Math.min(512, Math.max(64, Math.round(len * 80))),
      resY = Math.min(384, Math.round(w.height * 80));
    const canvas = document.createElement("canvas");
    canvas.width = resX;
    canvas.height = resY;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e6e1d8";
    ctx.fillRect(0, 0, resX, resY);
    const cells = new Map(),
      dx = (w.end.x - w.start.x) / len,
      dz = (w.end.z - w.start.z) / len;
    points.forEach((p) => {
      if (!p.color) return;
      const u = (p.x - w.start.x) * dx + (p.z - w.start.z) * dz,
        y = p.y - floorY,
        n = Math.abs((p.x - w.start.x) * dz - (p.z - w.start.z) * dx);
      if (n > 0.08 || u < 0 || u > len || y < 0 || y > w.height) return;
      const x = Math.floor((u / len) * resX),
        v = Math.floor((1 - y / w.height) * resY),
        k = `${x},${v}`;
      const c = cells.get(k) || { x, v, sum: [0, 0, 0], n: 0 };
      p.color.forEach((ch, i) => {
        c.sum[i] += ch;
      });
      c.n++;
      cells.set(k, c);
    });
    if (cells.size < 20) return;
    for (const c of cells.values()) {
      ctx.fillStyle = `rgb(${c.sum.map((v) => Math.round(v / c.n)).join(",")})`;
      ctx.fillRect(c.x - 2, c.v - 2, 5, 5);
    }
    result[w.id] = canvas.toDataURL("image/webp", 0.85);
  });
  return result;
}
