import { normalizeRoom, area, distance } from "./domain";

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
function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}
function wallSupport(points, start, end, floor, height) {
  const len = distance(start, end);
  const support = points.filter(
    (point) =>
      Math.abs(
        ((end.z - start.z) * (point.x - start.x) -
          (end.x - start.x) * (point.z - start.z)) /
          len,
      ) < 0.14 &&
      point.y > floor + 0.25 &&
      point.y < floor + height - 0.15,
  );
  const projections = support
    .map(
      (point) =>
        ((point.x - start.x) * (end.x - start.x) +
          (point.z - start.z) * (end.z - start.z)) /
        len,
    )
    .filter((value) => value >= 0 && value <= len);
  return {
    samples: support.length,
    coverage: Math.min(
      1,
      (new Set(projections.map((value) => Math.floor(value / 0.3))).size *
        0.3) /
        len,
    ),
  };
}
function bestWallPair(planes) {
  let best = null;
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++) {
      const alignment = Math.abs(
        planes[i].nx * planes[j].nx + planes[i].nz * planes[j].nz,
      );
      if (alignment > 0.45) continue;
      const score = (planes[i].score + planes[j].score) * (1 - alignment * 0.5);
      if (!best || score > best.score)
        best = { first: planes[i], second: planes[j], score };
    }
  return best;
}

// Automatic rectangular fitting. Two strong non-parallel walls define the axes;
// observed surface extents supply the opposite boundaries without user-entered dimensions.
export function reconstructRoom(points, options = {}) {
  if (points.length < 300)
    throw new Error(
      "Too little stable depth. Scan every wall slowly, or mark the floor corners.",
    );
  const measuredFloor = heightPeak(points, -2, 0.7);
  const floor = measuredFloor ?? options.floorY;
  if (floor === null)
    throw new Error(
      "The floor was not observed. Point the camera toward the floor while moving slowly.",
    );
  const ceiling = heightPeak(points, floor + 1.8, floor + 5);
  const height = ceiling === null ? options.height : ceiling - floor;
  if (!height || height < 1.8 || height > 8)
    throw new Error(
      "The room height could not be determined. Include some floor or ceiling in the scan.",
    );
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
  const pair = bestWallPair(planes);
  if (!pair)
    throw new Error(
      "Two connected wall directions were not clear yet. Scan across one corner so both adjoining walls receive stable depth.",
    );

  const u = { x: pair.first.nx, z: pair.first.nz };
  let v = { x: -u.z, z: u.x };
  if (v.x * pair.second.nx + v.z * pair.second.nz < 0) v = { x: -v.x, z: -v.z };
  const project = (point, axis) => point.x * axis.x + point.z * axis.z;
  const uHigh = percentile(
    pair.first.inliers.map((point) => project(point, u)),
    0.5,
  );
  const vHigh = percentile(
    pair.second.inliers.map((point) => project(point, v)),
    0.5,
  );
  const structural = points.filter(
    (point) => point.y > floor - 0.18 && point.y < floor + height + 0.18,
  );
  const opposingCoordinate = (axis, selected) => {
    const opposite = planes
      .filter(
        (plane) =>
          plane !== selected && plane.nx * axis.x + plane.nz * axis.z < -0.85,
      )
      .sort((a, b) => b.score - a.score)[0];
    return opposite
      ? percentile(
          opposite.inliers.map((point) => project(point, axis)),
          0.5,
        )
      : null;
  };
  const edgeAllowance = 0.12;
  const measuredULow = opposingCoordinate(u, pair.first);
  const measuredVLow = opposingCoordinate(v, pair.second);
  const uLow =
    measuredULow ??
    percentile(
      structural.map((point) => project(point, u)),
      0.02,
    ) - edgeAllowance;
  const vLow =
    measuredVLow ??
    percentile(
      structural.map((point) => project(point, v)),
      0.02,
    ) - edgeAllowance;
  const width = uHigh - uLow,
    depth = vHigh - vLow;
  if (
    ![uHigh, vHigh, uLow, vLow, width, depth].every(Number.isFinite) ||
    width < 0.8 ||
    depth < 0.8 ||
    width > 20 ||
    depth > 20
  )
    throw new Error(
      "The two wall extents are not stable yet. Sweep across the full length of both walls and include their shared corner.",
    );
  const observerU = project(origin, u),
    observerV = project(origin, v);
  if (
    observerU < uLow - 0.5 ||
    observerU > uHigh + 0.5 ||
    observerV < vLow - 0.5 ||
    observerV > vHigh + 0.5
  )
    throw new Error(
      "The measured walls do not surround the camera position. Move inside the room and rescan the corner.",
    );
  const fromAxes = (alongU, alongV) => ({
    x: u.x * alongU + v.x * alongV,
    z: u.z * alongU + v.z * alongV,
  });
  const polygon = [
    fromAxes(uLow, vLow),
    fromAxes(uHigh, vLow),
    fromAxes(uHigh, vHigh),
    fromAxes(uLow, vHigh),
  ];
  if (area(polygon) < 1)
    throw new Error(
      "The observed room area is too small to reconstruct reliably.",
    );
  const supports = polygon.map((start, index) =>
    wallSupport(
      points,
      start,
      polygon[(index + 1) % polygon.length],
      floor,
      height,
    ),
  );
  const measuredWalls = supports.filter(
    (support) => support.samples >= 35 && support.coverage >= 0.4,
  ).length;
  if (measuredWalls < 2)
    throw new Error(
      "Two walls need clearer depth. Scan both sides of one corner from top to bottom before finishing.",
    );
  const boundary = supports.map((support) => ({
    material: { color: "#e6e1d8" },
    openings: [],
    inferred: support.samples < 35 || support.coverage < 0.4,
  }));
  const inferredWallCount = 4 - measuredWalls;
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
      confidence: Math.min(
        0.92,
        0.42 + measuredWalls * 0.1 + (ceiling !== null ? 0.08 : 0),
      ),
      partial: inferredWallCount > 0 || ceiling === null,
      coverage: Math.round((measuredWalls / 4) * 100),
      inferredWallCount,
    },
  });
  return {
    room,
    floorY: floor,
    planes: planes.length,
    inferredWallCount,
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
