import { independentFrameIds, structuralSupportAt } from "./structuralDepth";
import { classifyWallPhotoDetails, wallPhotoTextureDetail } from "./scanWallPhotoDetails";
import { prepareScanCeiling } from "./scanCeilingPreparation";

// An editable surface is an approximation of the room envelope. It never
// replaces the measured mesh or supplies new measured area/depth to capture.
export const SCAN_DESIGN_SURFACE_VERSION = 2;
export const SCAN_DESIGN_ALGORITHM_VERSION = 59;
export const MAX_SCAN_DESIGN_BYTES = 8 * 1024 * 1024;
const MAX_CELLS = 24000;
const MAX_WALLS = 8;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a); return a.map(x => x / (l || 1)); };
const key = (x, y) => `${x},${y}`;
const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const median = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] || 0;
const srgbByte = x => Math.round(255 * (x / 255 <= .0031308 ? x / 255 * 12.92 : 1.055 * (x / 255) ** (1 / 2.4) - .055));
const fingerprints = new WeakMap();

export function scanDesignSourceKey(mesh) {
  if (!mesh?.positions?.length || !mesh.indices?.length) return "";
  const cached = fingerprints.get(mesh);
  if (cached?.positions === mesh.positions && cached.indices === mesh.indices) return cached.key;
  let hash = 2166136261;
  for (const array of [mesh.positions, mesh.indices]) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
  }
  const value = `${mesh.positions.length}:${mesh.indices.length}:${hash >>> 0}`;
  fingerprints.set(mesh, { positions: mesh.positions, indices: mesh.indices, key: value });
  return value;
}

export function getScanDesignSurfaces(mesh) {
  const design = mesh?.designSurfaces;
  return design?.version === SCAN_DESIGN_SURFACE_VERSION &&
    design.sourceAlgorithmVersion === SCAN_DESIGN_ALGORITHM_VERSION &&
    design.sourceKey === scanDesignSourceKey(mesh) && (design.walls?.length || design.ceilings?.length) &&
    design.removedSourceFaces?.length === mesh.indices.length / 3 ? design : null;
}

export function scanDesignByteLength(design) {
  if (!design) return 0;
  return [design.removedSourceFaces, ...Object.values(design.fragments || {}),
    ...[...(design.walls || []), ...(design.ceilings || [])].flatMap(wall => [wall.positions, wall.normals, wall.colors, wall.uvs,
      wall.indices, wall.estimatedTriangleMask, wall.texture?.data, wall.detailMask, wall.footprint, wall.openingMask])]
    .filter(ArrayBuffer.isView).reduce((sum, value) => sum + value.byteLength, 0);
}

// Optional portable preparation must be bounded and tied to this measured
// mesh. A stale/invalid model falls back locally; it cannot invalidate capture.
export function validScanDesignSurfaces(design, mesh) {
  if (design?.version !== SCAN_DESIGN_SURFACE_VERSION || design.sourceAlgorithmVersion !== SCAN_DESIGN_ALGORITHM_VERSION ||
      design.sourceKey !== scanDesignSourceKey(mesh) ||
      !Array.isArray(design.walls) || design.walls.length > MAX_WALLS ||
      (design.ceilings !== undefined && (!Array.isArray(design.ceilings) || design.ceilings.length > 1)) ||
      !(design.walls.length || design.ceilings?.length) ||
      !(design.removedSourceFaces instanceof Uint8Array) ||
      design.removedSourceFaces.length !== mesh.indices.length / 3 || design.removedSourceFaces.some(x => x > 1) ||
      scanDesignByteLength(design) > MAX_SCAN_DESIGN_BYTES) return false;
  function geometry(value) {
    return value?.positions instanceof Float32Array && value.positions.length > 0 && value.positions.length % 3 === 0 &&
      value.normals instanceof Float32Array && value.normals.length === value.positions.length &&
      value.uvs instanceof Float32Array && value.uvs.length === value.positions.length / 3 * 2 &&
      value.indices instanceof Uint32Array && value.indices.length % 3 === 0 &&
      !value.indices.some(x => x >= value.positions.length / 3) &&
      [value.positions, value.normals, value.uvs].every(a => !a.some(x => !Number.isFinite(x)));
  }
  const fragments = design.fragments;
  if (!fragments || (fragments.indices?.length && (!geometry(fragments) ||
      !(fragments.colors instanceof Uint8Array) || fragments.colors.length !== fragments.positions.length ||
      !(fragments.sourceFaces instanceof Uint32Array) || fragments.sourceFaces.length !== fragments.indices.length / 3 ||
      fragments.sourceFaces.some(x => x >= mesh.indices.length / 3)))) return false;
  if (!(fragments.estimatedTriangleMask instanceof Uint8Array) ||
      fragments.estimatedTriangleMask.length !== fragments.indices.length / 3 ||
      fragments.estimatedTriangleMask.some(x => x > 1)) return false;
  const ids = new Set();
  if ((design.ceilings || []).some(surface => surface.normal?.[1] > -.999 ||
    Math.abs(surface.normal?.[0]) > .001 || Math.abs(surface.normal?.[2]) > .001)) return false;
  for (const wall of [...design.walls, ...(design.ceilings || [])]) {
    if (!geometry(wall) || !wall.indices.length || typeof wall.id !== "string" || wall.id.length > 100 || ids.has(wall.id) ||
        !Array.isArray(wall.normal) || wall.normal.length !== 3 || !wall.normal.every(Number.isFinite) ||
        Math.abs(Math.hypot(...wall.normal) - 1) > .001 || !Number.isFinite(wall.offset) ||
        !Array.isArray(wall.axes) || wall.axes.length !== 2 ||
        !wall.axes.every(a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)) ||
        !Number.isFinite(wall.cellSize) || wall.cellSize < .02 || wall.cellSize > .06 ||
        !Array.isArray(wall.extent) || wall.extent.length !== 2 ||
        !wall.extent.every(a => Array.isArray(a) && a.length === 2 && a.every(Number.isInteger))) return false;
    ids.add(wall.id);
    const width = wall.extent[1][0] - wall.extent[0][0], height = wall.extent[1][1] - wall.extent[0][1];
    if (width <= 0 || height <= 0 || width * height > MAX_CELLS ||
        !(wall.footprint instanceof Uint8Array) || wall.footprint.length !== width * height || wall.footprint.some(x => x > 2) ||
        !(wall.openingMask instanceof Uint8Array) || wall.openingMask.length !== width * height || wall.openingMask.some(x => x > 1) ||
        !(wall.estimatedTriangleMask instanceof Uint8Array) || wall.estimatedTriangleMask.length !== wall.indices.length / 3 ||
        wall.estimatedTriangleMask.some(x => x > 1) || !Number.isFinite(wall.area) || wall.area <= 0 ||
        !Number.isFinite(wall.estimatedArea) || wall.estimatedArea < 0 || wall.estimatedArea > wall.area) return false;
    const texture = wall.texture;
    if (!texture || !Number.isInteger(texture.width) || !Number.isInteger(texture.height) ||
        texture.width < 1 || texture.height < 1 || texture.width > 768 || texture.height > 768 ||
        !(texture.data instanceof Uint8Array) || texture.data.length !== texture.width * texture.height * 4 ||
        !(wall.detailMask instanceof Uint8Array) || wall.detailMask.length !== texture.width * texture.height) return false;
    for (let i = 0; i < wall.positions.length; i += 3)
      if (Math.abs(dot(wall.normal, wall.positions.subarray(i, i + 3)) - wall.offset) > .003) return false;
  }
  return true;
}

function vertex(mesh, id, axes) {
  const p = Array.from(mesh.positions.subarray(id * 3, id * 3 + 3));
  return { p, q: axes.map(axis => dot(axis, p)),
    n: mesh.normals ? Array.from(mesh.normals.subarray(id * 3, id * 3 + 3)) : [0, 0, 0],
    rgb: mesh.colors ? Array.from(mesh.colors.subarray(id * 3, id * 3 + 3)) : [255, 255, 255],
    uv: mesh.uvs ? Array.from(mesh.uvs.subarray(id * 2, id * 2 + 2)) : [0, 0] };
}

function interpolate(a, b, t) {
  return Object.fromEntries(["p", "q", "n", "rgb", "uv"].map(name =>
    [name, a[name].map((value, axis) => value + (b[name][axis] - value) * t)]));
}

function clipCell(polygon, x, y, cell) {
  let result = polygon;
  for (const [axis, sign, boundary] of [[0, 1, x * cell], [0, -1, -(x + 1) * cell],
    [1, 1, y * cell], [1, -1, -(y + 1) * cell]]) {
    const next = [];
    for (let i = 0; i < result.length; i++) {
      const a = result[i], b = result[(i + 1) % result.length];
      const da = a.q[axis] * sign - boundary, db = b.q[axis] * sign - boundary;
      if (da >= -1e-10) next.push(a);
      if ((da > 1e-10 && db < -1e-10) || (da < -1e-10 && db > 1e-10))
        next.push(interpolate(a, b, da / (da - db)));
    }
    result = next;
    if (result.length < 3) return [];
  }
  return result;
}

function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i].q, b = polygon[(i + 1) % polygon.length].q;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

function eachTriangleCell(points, cell, visit) {
  const min = [0, 1].map(axis => Math.floor(Math.min(...points.map(p => p.q[axis])) / cell));
  const max = [0, 1].map(axis => Math.floor(Math.max(...points.map(p => p.q[axis])) / cell));
  if ((max[0] - min[0] + 1) * (max[1] - min[1] + 1) > MAX_CELLS) return;
  for (let x = min[0]; x <= max[0]; x++) for (let y = min[1]; y <= max[1]; y++) {
    const polygon = clipCell(points, x, y, cell), area = polygonArea(polygon);
    if (area > Math.max(1e-10, cell * cell * .00001)) visit(x, y, polygon, area);
  }
}

function sourceColor(mesh, points) {
  const color = [0, 1, 2].map(axis => points.reduce((sum, p) => sum + p.rgb[axis], 0) / points.length);
  if (mesh.texture?.data && mesh.uvs) {
    const uv = [0, 1].map(axis => points.reduce((sum, p) => sum + p.uv[axis], 0) / points.length);
    const x = Math.max(0, Math.min(mesh.texture.width - 1, Math.floor(uv[0] * mesh.texture.width)));
    const y = Math.max(0, Math.min(mesh.texture.height - 1, Math.floor(uv[1] * mesh.texture.height)));
    const offset = (y * mesh.texture.width + x) * 4;
    // The atlas's white tile is a multiplier for captured vertex colors on
    // faces without a photograph. Sampling that tile alone turns those faces
    // into solid white blocks in the prepared wall and its background palette.
    return Array.from(mesh.texture.data.subarray(offset, offset + 3), (value, axis) => {
      const srgb = value / 255;
      const linear = srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4;
      return srgbByte(linear * color[axis]);
    });
  }
  return color.map(srgbByte);
}

function gridComponents(cells) {
  const remaining = new Set(cells.keys()), regions = [];
  while (remaining.size) {
    const pending = [remaining.values().next().value], region = [];
    remaining.delete(pending[0]);
    for (let i = 0; i < pending.length; i++) {
      const k = pending[i]; region.push(k);
      const [x, y] = k.split(",").map(Number);
      for (const [dx, dy] of neighbors) {
        const next = key(x + dx, y + dy);
        if (remaining.delete(next)) pending.push(next);
      }
    }
    regions.push(region);
  }
  return regions.sort((a, b) => b.length - a.length);
}

function makeEvidence(frames, helpers, plane) {
  if (!helpers.project || !frames.length) return () => null;
  const framesById = new Map(frames.map(frame => [frame.frameId, frame]));
  const counts = new Map();
  function count(ids) {
    if (ids.length < 2) return ids.length;
    const k = ids.join(",");
    if (!counts.has(k)) counts.set(k, independentFrameIds(ids, framesById, .06).size);
    return counts.get(k);
  }
  return p => {
    const agreeing = [], through = [], foreground = [], offsets = [];
    for (const frame of frames) {
      const uv = helpers.project(frame, ...p);
      if (!uv || uv.u < 0 || uv.v < 0 || uv.u >= 1 || uv.v >= 1) continue;
      const index = Math.floor(uv.v * frame.rows) * frame.columns + Math.floor(uv.u * frame.columns);
      if (!frame.measuredMask?.[index]) continue;
      const depth = (frame.originalFilteredDepth || frame.filteredDepth)?.[index];
      if (!depth) continue;
      const difference = depth - uv.depth;
      const hit = helpers.unproject?.(frame, index, depth);
      const residual = hit ? dot(plane.normal, hit) - plane.offset : -difference;
      if (Math.abs(residual) <= .18) { agreeing.push(frame.frameId); offsets.push(residual); }
      if (difference > .22 && frame.freeSpaceMask?.[index] &&
          (!frame.depthConfidence || frame.depthConfidence[index] >= 140)) through.push(frame.frameId);
      if (residual > .018 && residual < .18) foreground.push({ id: frame.frameId, residual });
    }
    const ids = independentFrameIds(foreground.map(f => f.id), framesById, .06);
    const relief = foreground.filter(f => ids.has(f.id)).map(f => f.residual);
    const middle = median(relief), scatter = median(relief.map(value => Math.abs(value - middle)));
    return { support: count(agreeing), opening: count(through) >= 2 && count(agreeing) < 2,
      surfaceOffset: offsets.length >= 2 ? median(offsets) : null,
      foreground: relief.length >= 3 && middle > .018 && scatter < .008,
      foregroundOffset: middle };
  };
}

// A curled source triangle may cross the ordinary foreground limit while its
// projected cell still shows an independently observed plain wall. Confirm the
// wall's native local orientation there before replacing that extra fragment.
function makeWallNormalEvidence(frames, helpers, plane) {
  const frameMap = new Map(frames.map(f => [f.frameId, f])), cache = new Map();
  return p => {
    const k = p.map(v => Math.round(v * 100000)).join(",");
    if (cache.has(k)) return cache.get(k);
    const observers = [];
    for (const f of frames) {
      if (f.textureOnly) continue;
      const uv = helpers.project?.(f, ...p);
      if (!uv || Math.min(uv.u, uv.v) < 0 || Math.max(uv.u, uv.v) >= 1) continue;
      const x = Math.floor(uv.u * f.columns), y = Math.floor(uv.v * f.rows);
      if (x < 1 || y < 1 || x >= f.columns - 1 || y >= f.rows - 1) continue;
      const i = y * f.columns + x, ids = [i, i - 1, i + 1, i - f.columns, i + f.columns];
      const depth = f.originalFilteredDepth || f.filteredDepth;
      if (ids.some(id => !f.measuredMask?.[id] || !depth?.[id])) continue;
      const points = ids.map(id => f.originalPositions?.length
        ? Array.from(f.originalPositions.subarray(id * 3, id * 3 + 3))
        : helpers.unproject?.(f, id, depth[id]));
      if (points.some(q => !q || !q.every(Number.isFinite))) continue;
      const horizontal = points[2].map((v, a) => v - points[1][a]);
      const vertical = points[4].map((v, a) => v - points[3][a]);
      const normal = cross(horizontal, vertical), length = Math.hypot(...normal);
      if (length < 1e-8 || Math.abs(dot(normal, plane.normal)) / length < .8 ||
          Math.abs(dot(plane.normal, points[0]) - plane.offset) > .18) continue;
      observers.push(f.frameId);
    }
    const count = independentFrameIds(observers, frameMap, .06).size;
    cache.set(k, count); return count;
  };
}

function fillEnclosedGaps(cells, evidence, world, cell, meshOnly) {
  const xs = [...cells.values()].map(p => p.x), ys = [...cells.values()].map(p => p.y);
  if (!xs.length) return;
  const low = [Math.min(...xs) - 1, Math.min(...ys) - 1], high = [Math.max(...xs) + 1, Math.max(...ys) + 1];
  if ((high[0] - low[0]) * (high[1] - low[1]) > MAX_CELLS) return;
  const empty = new Map();
  for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++)
    if (!cells.has(key(x, y))) empty.set(key(x, y), { x, y });
  for (const region of gridComponents(empty)) {
    const points = region.map(k => empty.get(k));
    if (points.some(p => p.x === low[0] || p.x === high[0] || p.y === low[1] || p.y === high[1])) continue;
    const width = (Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)) + 1) * cell;
    const height = (Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) + 1) * cell;
    if (Math.hypot(width, height) > (meshOnly ? .12 : .3) || region.length * cell * cell > .04) continue;
    if (points.some(p => evidence(world(p.x + .5, p.y + .5))?.opening)) continue;
    for (const p of points) cells.set(key(p.x, p.y), { ...p, estimated: true, coverage: 0, rgb: null });
  }
}

function photoDetails(cells, cell) {
  return classifyWallPhotoDetails(cells, cell);
}

// A fitted capture plane can sit between shallow competing depth sheets.
// Seat the editable envelope on a modest, repeatedly observed rear wall band,
// rather than projecting it forward into the room. Each translated view votes
// once, and foreground, sparse views and mesh-only imports cannot move it.
function capturedWallSetback(sourcePlane, normal, offset, frames) {
  if (!(sourcePlane.cells instanceof Map) || !sourcePlane.axes || frames.length < 3) return 0;
  const heights = [...sourcePlane.cells.keys()].flatMap(k => {
    const [x, y] = k.split(",").map(Number), size = sourcePlane.cellSize || .12;
    return [0,1].map(dy => sourcePlane.normal[1] * sourcePlane.offset +
      sourcePlane.axes[0][1] * (x + .5) * size + sourcePlane.axes[1][1] * (y + dy) * size);
  });
  if (!heights.length) return 0;
  const bottom = Math.min(...heights), height = Math.max(...heights) - bottom;
  if (height < .7) return 0;
  const rearViews = new Map(), framesById = new Map(frames.map(f => [f.frameId, f]));
  for (const frame of frames) {
    if (!frame.positions?.length || !frame.measuredMask || !frame.filteredDepth) continue;
    const stride = Math.max(1, Math.ceil(Math.sqrt(frame.columns * frame.rows / 1800))), offsets = [];
    for (let y = 1; y < frame.rows - 1; y += stride) for (let x = 1; x < frame.columns - 1; x += stride) {
      const i = y * frame.columns + x, ids = [i, i-1, i+1, i-frame.columns, i+frame.columns];
      if (ids.some(k => !frame.measuredMask[k] || !frame.filteredDepth[k])) continue;
      const point = Array.from(frame.positions.subarray(i * 3, i * 3 + 3));
      if (point[1] < bottom + height * .2 || point[1] > bottom + height * .85 ||
          !structuralSupportAt(sourcePlane, point, 3)) continue;
      const horizontal = [0,1,2].map(axis => frame.positions[(i+1)*3+axis] - frame.positions[(i-1)*3+axis]);
      const vertical = [0,1,2].map(axis => frame.positions[(i+frame.columns)*3+axis] - frame.positions[(i-frame.columns)*3+axis]);
      if (Math.abs(dot(unit(cross(horizontal, vertical)), normal)) < .94) continue;
      const residual = dot(normal, point) - offset;
      if (Number.isFinite(residual) && Math.abs(residual) <= .12) offsets.push(residual);
    }
    if (offsets.length < 24) continue;
    const center = median(offsets), scatter = median(offsets.map(value => Math.abs(value - center)));
    if (center <= -.015 && scatter < .035) rearViews.set(frame.frameId, center);
  }
  const ids = independentFrameIds(rearViews.keys(), framesById, .06);
  if (ids.size < 3) return 0;
  const values = [...ids].map(id => rearViews.get(id)), center = median(values);
  if (median(values.map(value => Math.abs(value - center))) > .02) return 0;
  return Math.max(-.06, center);
}

function supportedFloorAt(point, planes) {
  return planes.find(p => p.kind === "floor" && Math.abs(p.normal[1]) > .9 &&
    p.axes?.length === 2 && p.cells instanceof Map && p.supportingFrameIds?.length >= 3 &&
    Math.abs(dot(p.normal, point) - p.offset) < 1e-4 && structuralSupportAt(p, point, 2));
}

function onFloor(point, floor) {
  const result = point.slice();
  // Wall fits use gravity-aligned horizontal normals. Adjusting height keeps
  // the shared wall target while seating the edge on the actual sloped floor.
  result[1] = (floor.offset - floor.normal[0] * point[0] - floor.normal[2] * point[2]) / floor.normal[1];
  return result;
}

function buildWall(mesh, sourcePlane, frames, helpers, cell, junctionPlanes = []) {
  const length = Math.hypot(...sourcePlane.normal);
  let normal = sourcePlane.normal.map(x => x / length), offset = sourcePlane.offset / length;
  const cameras = frames.map(f => Array.from(f.camera || f.transformMatrix?.slice(12, 15) || [])).filter(p => p.length === 3);
  if (cameras.length && median(cameras.map(p => dot(normal, p) - offset)) < 0) {
    normal = normal.map(x => -x); offset = -offset;
  }
  const captureOffset = offset, setback = capturedWallSetback(sourcePlane, normal, offset, frames);
  offset += setback;
  const axes = [unit(cross([0, 1, 0], normal))]; axes.push(cross(normal, axes[0]));
  const world = (x, y) => normal.map((n, i) => n * offset + axes[0][i] * x * cell + axes[1][i] * y * cell);
  const plane = { normal, offset, axes }, cells = new Map(), candidates = [], openings = new Set();
  const meshOnly = !frames.length || !helpers.project;
  const supportedHeights = !meshOnly && sourcePlane.cells instanceof Map && sourcePlane.axes
    ? [...sourcePlane.cells].filter(([,ids]) => ids.size >= 2).map(([k]) => {
      const [x,y] = k.split(",").map(Number), size = sourcePlane.cellSize || .12;
      return sourcePlane.normal[1] * sourcePlane.offset +
        sourcePlane.axes[0][1] * (x + (sourcePlane.axes[0][1] > 0 ? 1 : 0)) * size +
        sourcePlane.axes[1][1] * (y + (sourcePlane.axes[1][1] > 0 ? 1 : 0)) * size;
    }) : [];
  const wallTop = supportedHeights.length ? Math.max(...supportedHeights) + cell : Infinity;
  for (let face = 0; face < mesh.indices.length / 3; face++) {
    const points = [0, 1, 2].map(corner => vertex(mesh, mesh.indices[face * 3 + corner], axes));
    const faceNormal = unit(cross(points[1].p.map((x, i) => x - points[0].p[i]), points[2].p.map((x, i) => x - points[0].p[i])));
    if (!mesh.normals) points.forEach(p => { p.n = faceNormal; });
    const center = [0,1,2].map(axis => points.reduce((sum, p) => sum + p.p[axis] / 3, 0));
    const floor = supportedFloorAt(center, junctionPlanes);
    // A sloped reconstructed floor projects to a narrow polygon on the wall.
    // It still belongs to the floor; wall cleanup must not replace it with a
    // vertical photo cell and leave a hole beside that wall.
    if (floor && Math.abs(dot(faceNormal, floor.normal)) > .995 &&
        points.every(p => Math.abs(dot(floor.normal, p.p) - floor.offset) < 1e-4)) continue;
    // Depth-supported walls also own displaced background sheets behind them.
    // Keep the foreground limit narrow: curtains/furniture in front of a wall
    // must not be swallowed by the cleanup. Opening evidence still vetoes cells.
    if (points.some(p => {
      const residual = dot(normal, p.p) - offset;
      return meshOnly ? Math.abs(residual) > .035 : residual < -.38 || residual > .35;
    })) continue;
    const extended = !meshOnly && points.some(p => dot(normal, p.p) - offset > .18);
    candidates.push({ face, points, extended });
    // Extra curls can be removed inside a confirmed wall, but cannot enlarge
    // its footprint or turn a foreground object into another wall cell.
    if (extended) continue;
    // Folded background edges still need replacement inside an established
    // footprint. They must not extend the footprint by themselves.
    if (Math.abs(dot(faceNormal, normal)) < .35) continue;
    const color = sourceColor(mesh, points);
    eachTriangleCell(points, cell, (x, y, polygon, area) => {
      const k = key(x, y);
      if (!cells.has(k)) cells.set(k, { x, y, coverage: 0, sum: [0, 0, 0], estimated: false });
      const p = cells.get(k); p.coverage += area;
      color.forEach((value, axis) => { p.sum[axis] += value * area; });
    });
    if (cells.size > MAX_CELLS) return null;
  }
  const evidence = makeEvidence(frames, helpers, plane);
  for (const [k, p] of cells) {
    // Upper folds near a wall cannot extend that wall beyond its independently
    // observed vertical footprint and turn photographed ceiling into paint.
    if (world(p.x+.5,p.y+.5)[1] > wallTop) { cells.delete(k); continue; }
    p.rgb = p.sum.map(x => x / p.coverage); delete p.sum;
    const observed = evidence(world(p.x + .5, p.y + .5));
    if (observed?.opening) { openings.add(k); cells.delete(k); continue; }
    if (p.coverage < cell * cell * .08) { cells.delete(k); continue; }
    p.foreground = !!observed?.foreground;
    p.foregroundOffset = observed?.foregroundOffset || 0;
    p.support = observed?.support || 0;
    p.depthOffset = observed?.surfaceOffset ?? null;
  }
  // Coarse plane cells carry independently observed background coverage. Use
  // their exact footprint, including sparse meshing cracks, not the room bbox.
  if (!meshOnly && sourcePlane.cells instanceof Map && sourcePlane.axes) {
    const sourceCell = sourcePlane.cellSize || .12;
    for (const [k, ids] of sourcePlane.cells) {
      if (ids.size < 2) continue;
      const [sx, sy] = k.split(",").map(Number);
      const corners = [[sx, sy], [sx + 1, sy], [sx + 1, sy + 1], [sx, sy + 1]].map(q => {
        const p = sourcePlane.normal.map((n, i) => n * sourcePlane.offset +
          sourcePlane.axes[0][i] * q[0] * sourceCell + sourcePlane.axes[1][i] * q[1] * sourceCell);
        return { p, q: axes.map(axis => dot(axis, p)), n: normal, rgb: [0, 0, 0], uv: [0, 0] };
      });
      eachTriangleCell([corners[0], corners[1], corners[2]], cell, (x, y) => {
        const k2 = key(x, y);
        if (cells.has(k2)) return;
        const observed = evidence(world(x + .5, y + .5));
        if (world(x+.5,y+.5)[1] > wallTop) return;
        if (observed?.opening) { openings.add(k2); return; }
        if (observed?.support < 2) return;
        cells.set(k2, { x, y, coverage: 0, rgb: null, estimated: true, support: observed.support,
          foreground: observed.foreground, foregroundOffset: observed.foregroundOffset,
          depthOffset: observed.surfaceOffset });
      });
      eachTriangleCell([corners[0], corners[2], corners[3]], cell, (x, y) => {
        const k2 = key(x, y);
        if (cells.has(k2)) return;
        const observed = evidence(world(x + .5, y + .5));
        if (world(x+.5,y+.5)[1] > wallTop) return;
        if (observed?.opening) { openings.add(k2); return; }
        if (observed?.support < 2) return;
        cells.set(k2, { x, y, coverage: 0, rgb: null, estimated: true, support: observed.support,
          foreground: observed.foreground, foregroundOffset: observed.foregroundOffset,
          depthOffset: observed.surfaceOffset });
      });
      if (cells.size > MAX_CELLS) return null;
    }
  }
  fillEnclosedGaps(cells, evidence, world, cell, meshOnly);
  for (const region of gridComponents(cells)) if (region.length * cell * cell < .012)
    region.forEach(k => cells.delete(k));
  if (cells.size * cell * cell < .2) return null;
  photoDetails(cells, cell);
  const coordinates = [...cells.values()], min = [Math.min(...coordinates.map(p => p.x)), Math.min(...coordinates.map(p => p.y))],
    max = [Math.max(...coordinates.map(p => p.x)) + 1, Math.max(...coordinates.map(p => p.y)) + 1];
  const gridWidth = max[0] - min[0], gridHeight = max[1] - min[1];
  if (gridWidth * gridHeight > MAX_CELLS) return null;
  // RGB-only snapshots have synchronized color poses, but are not additional
  // depth observers. Use them for appearance without lending them geometry votes.
  const photoFrames = helpers.project ? (helpers.textureFrames || frames)
    .filter(f => f.colorImage?.length && f.colorWidth && f.colorHeight) : [];
  const frameScores = new Map();
  for (const p of cells.values()) {
    const point = world(p.x + .5, p.y + .5), choices = [];
    for (const frame of photoFrames) {
      const uv = helpers.project(frame, ...point), colorUV = (helpers.projectColor || helpers.project)(frame, ...point);
      if (!uv || !colorUV || Math.min(uv.u, uv.v, colorUV.u, colorUV.v) < .01 ||
          Math.max(uv.u, uv.v, colorUV.u, colorUV.v) > .99) continue;
      const index = Math.floor(uv.v * frame.rows) * frame.columns + Math.floor(uv.u * frame.columns);
      const depth = (frame.originalFilteredDepth || frame.filteredDepth)?.[index];
      if (!frame.measuredMask?.[index] || !depth || Math.abs(depth - uv.depth) > .2) continue;
      const camera = frame.viewTransformMatrix || frame.transformMatrix;
      const ray = unit(point.map((x, i) => camera[i + 12] - x));
      const angle = dot(ray, normal);
      if (angle < .25) continue;
      const rgb = helpers.sampleColor?.(frame, colorUV);
      const clipped = rgb ? rgb.filter(value => value >= 250).length / 3 : 0;
      // A blown-out photograph must not win a wall patch when a visible,
      // properly exposed alternative exists. Keep it when it is the only view.
      const score = (angle / (1 + Math.abs(depth - uv.depth) * 4) + (Number(frame.colorSharpness) || 0) * .001) * (1 - clipped * .75);
      choices.push({ frame, score });
      frameScores.set(frame, (frameScores.get(frame) || 0) + score * (p.detail ? 3 : 1));
    }
    choices.sort((a, b) => b.score - a.score);
    p.photoChoices = choices;
  }
  const preferredFrames = [...frameScores.keys()].sort((a, b) => frameScores.get(b) - frameScores.get(a));
  // A coherent detail such as a picture should use one photograph wherever
  // it has coverage. Per-cell choices otherwise leave exposure/pose seams.
  const details = new Map([...cells].filter(([, p]) => p.detail));
  function chooseDetailPhotographs(regions) {
    for (const region of gridComponents(regions)) {
      const scores = new Map();
      for (const k of region) for (const choice of cells.get(k).photoChoices) {
        if (!scores.has(choice.frame)) scores.set(choice.frame, { count: 0, score: 0 });
        const value = scores.get(choice.frame); value.count++; value.score += choice.score;
      }
      const chosen = [...scores].filter(([, value]) => value.count >= region.length * .9)
        .sort((a, b) => b[1].score - a[1].score)[0]?.[0];
      if (chosen) for (const k of region) {
        const p = cells.get(k);
        if (p.photoChoices.some(choice => choice.frame === chosen)) p.detailPhotoFrame = chosen;
      }
    }
  }
  chooseDetailPhotographs(details);
  function sampleCellPhoto(p) {
    const projected = p.photoFrame && (helpers.projectColor || helpers.project)(p.photoFrame, ...world(p.x + .5, p.y + .5));
    if (projected) p.rgb = helpers.sampleColor?.(p.photoFrame, projected) || p.rgb;
    if (p.photoFrame && helpers.sampleColor) {
      const samples = [];
      for (const y of [.15, .5, .85]) for (const x of [.15, .5, .85]) {
        const uv = (helpers.projectColor || helpers.project)(p.photoFrame, ...world(p.x + x, p.y + y));
        samples.push(uv && helpers.sampleColor(p.photoFrame, uv));
      }
      p.textureDetail = wallPhotoTextureDetail(samples);
    }
  }
  for (const p of cells.values()) {
    const minimumScore = (p.photoChoices[0]?.score || 0) * .65;
    p.photoFrame = p.detailPhotoFrame || preferredFrames.find(frame =>
      p.photoChoices.some(choice => choice.frame === frame && choice.score >= minimumScore)) || null;
    sampleCellPhoto(p);
    delete p.detailPhotoFrame; delete p.detail;
  }
  let background = photoDetails(cells, cell);
  chooseDetailPhotographs(new Map([...cells].filter(([,p]) => p.detail && !p.foldedPanel)));
  for (const p of cells.values()) {
    if (p.detailPhotoFrame && p.detailPhotoFrame !== p.photoFrame) {
      p.photoFrame = p.detailPhotoFrame; sampleCellPhoto(p);
    }
    delete p.photoChoices; delete p.detailPhotoFrame;
  }
  background = photoDetails(cells, cell);
  const stableRaised = new Set();
  for (const region of gridComponents(new Map([...cells].filter(([,p]) => p.foreground && p.foregroundOffset >= .1)))) {
    const points=region.map(k=>cells.get(k)), width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+1,
      height=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))+1;
    if (region.length * cell * cell < .04 || region.length/(width*height)<.8) continue;
    const offsets = region.map(k => cells.get(k).foregroundOffset), center = median(offsets);
    if (offsets.filter(v => Math.abs(v-center)<.015).length < region.length*.9) continue;
    region.forEach(k => stableRaised.add(k));
  }
  // Consistent centimetre-scale depth bias on an ordinary photographed wall
  // is not an object. Keep substantial relief, or localized visible detail
  // with relief; shallow pictures stay visible in the planar photo overlay.
  // When photographs are unavailable, retain the conservative depth fallback.
  for (const [k,p] of cells) {
    p.foreground = p.foreground && (!p.photoFrame || stableRaised.has(k) ||
      (p.detail && !p.framedPicture && p.foregroundOffset >= .055));
    if (p.foreground) p.estimated = true; // inferred background behind an object
  }
  // Cloth is a photographed foreground surface, not a flat editable wall.
  // Keep its captured geometry/UVs and exclude it from the planar replacement.
  const preserved = new Map([...cells].filter(([,p]) => p.foldedPanel));
  for (const k of preserved.keys()) cells.delete(k);
  if (cells.size * cell * cell < .2) return null;
  const width = Math.max(2, Math.min(768, Math.ceil((max[0] - min[0]) * cell * 192))),
    height = Math.max(2, Math.min(768, Math.ceil((max[1] - min[1]) * cell * 192)));
  const texture = { width, height, data: new Uint8Array(width * height * 4) }, detailMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = min[0] + (x + .5) / width * (max[0] - min[0]), gy = min[1] + (y + .5) / height * (max[1] - min[1]);
    const p = cells.get(key(Math.floor(gx), Math.floor(gy))), point = world(gx, gy);
    const projected = p?.photoFrame && (helpers.projectColor || helpers.project)(p.photoFrame, ...point);
    const rgb = (projected && helpers.sampleColor?.(p.photoFrame, projected)) || p?.rgb || background;
    texture.data.set(rgb.map(value => Math.max(0, Math.min(255, Math.round(value)))), (y * width + x) * 4);
    texture.data[(y * width + x) * 4 + 3] = 255;
    detailMask[y * width + x] = p?.detail ? 255 : 0;
  }
  const positions = [], normals = [], uvs = [], indices = [], estimated = [], lattice = new Map();
  let junctionVertexCount = 0;
  function supportNear(plane, point) {
    return structuralSupportAt(plane, point, 2) || plane.axes.some(axis => [-.01, .01].some(delta =>
      structuralSupportAt(plane, point.map((value, i) => value + axis[i] * delta), 2)));
  }
  const junctions = meshOnly || !(sourcePlane.cells instanceof Map) || !sourcePlane.axes || !sourcePlane.cellSize
    ? [] : junctionPlanes.filter(p =>
    (p.kind === "floor" || p.kind === "ceiling") && p.cells instanceof Map && p.axes && p.cellSize &&
    p.normal?.length === 3 && p.normal.every(Number.isFinite) && Number.isFinite(p.offset) && Math.abs(p.normal[1]) > .9);
  function at(x, y) {
    const k = key(x, y);
    if (!lattice.has(k)) {
      let point = world(x, y);
      const around = [[-1,-1], [0,-1], [-1,0], [0,0]].filter(([dx, dy]) => cells.has(key(x + dx, y + dy))).length;
      if (junctions.length && around < 4 && supportNear(sourcePlane, point)) for (const junction of junctions) {
        const residual = dot(junction.normal, point) - junction.offset;
        const tangent = junction.normal.map((value, i) => value - normal[i] * dot(junction.normal, normal));
        const denominator = dot(tangent, tangent);
        if (denominator < .5 || Math.abs(residual) / Math.sqrt(denominator) > cell * .45 || !supportNear(junction, point)) continue;
        // Snap a nearby supported boundary along the wall plane to the exact
        // junction. Missing ceiling/floor coverage cannot authorize a global cut.
        point = point.map((value, i) => value - tangent[i] * residual / denominator);
        junctionVertexCount++; break;
      }
      lattice.set(k, positions.length / 3); positions.push(...point); normals.push(...normal);
      uvs.push((x - min[0]) / (max[0] - min[0]), (y - min[1]) / (max[1] - min[1]));
    }
    return lattice.get(k);
  }
  for (const p of cells.values()) {
    const a = at(p.x, p.y), b = at(p.x + 1, p.y), c = at(p.x + 1, p.y + 1), d = at(p.x, p.y + 1);
    indices.push(a, b, c, a, c, d); estimated.push(p.estimated ? 1 : 0, p.estimated ? 1 : 0);
  }
  const footprint = new Uint8Array(gridWidth * gridHeight), openingMask = new Uint8Array(footprint.length);
  for (const p of cells.values()) footprint[(p.y - min[1]) * gridWidth + p.x - min[0]] = p.estimated ? 2 : 1;
  for (const k of openings) {
    const [x, y] = k.split(",").map(Number);
    if (x >= min[0] && x < max[0] && y >= min[1] && y < max[1])
      openingMask[(y - min[1]) * gridWidth + x - min[0]] = 1;
  }
  const id = `wall-${normal.map(x => Math.round(x * 1000)).join("-")}-${Math.round(offset * 1000)}`;
  return { wall: { id, normal, offset, captureOffset, setbackMeters: Math.max(0, -setback), axes, cellSize: cell, extent: [min, max],
    positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs),
    colors: new Uint8Array(positions.length).fill(255), indices: new Uint32Array(indices),
    estimatedTriangleMask: new Uint8Array(estimated), texture, detailMask,
    area: cells.size * cell * cell, estimatedArea: [...cells.values()].filter(p => p.estimated).length * cell * cell,
    footprint, openingMask, supportingFrameIds: sourcePlane.supportingFrameIds || [],
    componentCount: gridComponents(cells).length, junctionVertexCount,
    source: meshOnly ? "mesh-footprint" : "independent-depth-footprint" }, cells, candidates, openings, preserved, background,
    nativeWallSupport: makeWallNormalEvidence(frames, helpers, plane) };
}

function appendFragment(fragments, triangle, sourceFace, estimated = false) {
  for (const p of triangle) {
    const id = fragments.positions.length / 3;
    fragments.positions.push(...p.p); fragments.normals.push(...unit(p.n));
    fragments.colors.push(...p.rgb.map(Math.round)); fragments.uvs.push(...p.uv); fragments.indices.push(id);
  }
  fragments.sourceFaces.push(sourceFace);
  fragments.estimatedTriangleMask.push(estimated ? 1 : 0);
}

// A hard move on one ring of tiny triangles produces spikes. Spread the seam
// displacement through the existing connected surface instead, with the wall
// edge fixed and the distant capture fixed. Photographs remain on that surface;
// no unphotographed transition polygons are created.
function relaxCapturedSeams(mesh, removed, fragments, targets, splits, built, pointKey, planes, radius = .35) {
  const nodes = new Map();
  function node(point) {
    const k = pointKey(point);
    if (!nodes.has(k)) nodes.set(k, { k, point, neighbors: new Map(), distance: Infinity, fixed: false });
    return nodes.get(k);
  }
  function connect(a, b) {
    const distance = Math.hypot(...a.point.map((value, i) => value - b.point[i]));
    if (distance < 1e-7 || a.neighbors.has(b)) return;
    a.neighbors.set(b, distance); b.neighbors.set(a, distance);
  }
  function triangle(source, a, b, c) {
    const points = [a,b,c].map(id => node(Array.from(source.positions.subarray(id * 3, id * 3 + 3))));
    points.forEach((p, i) => connect(p, points[(i + 1) % 3]));
  }
  for (let face = 0; face < removed.length; face++) if (!removed[face])
    triangle(mesh, ...mesh.indices.subarray(face * 3, face * 3 + 3));
  for (let face = 0; face < fragments.indices.length / 3; face++)
    triangle(fragments, ...fragments.indices.slice(face * 3, face * 3 + 3));
  // Atlas triangles share positions but not vertex IDs. Include subdivision
  // constraints on these geometric edges in the same deformation graph.
  for (const [edge, points] of splits) {
    const [a, b] = edge.split("/").map(k => nodes.get(k));
    if (!a || !b) continue;
    const delta = b.point.map((value, i) => value - a.point[i]), denominator = dot(delta, delta);
    const ordered = [...points.values()].map(point => ({ point,
      t: dot(point.map((value, i) => value - a.point[i]), delta) / denominator })).sort((x, y) => x.t - y.t);
    let previous = a;
    for (const p of ordered) { const next = node(p.point); connect(previous, next); previous = next; }
    connect(previous, b);
  }
  const heap = [];
  function push(value) {
    let i = heap.length; heap.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].distance <= value.distance) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = value;
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child+1].distance < heap[child].distance) child++;
        if (heap[child].distance >= last.distance) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  }
  for (const [k, target] of targets) {
    const p = nodes.get(k);
    if (!target || !p) continue;
    p.fixed = true; p.distance = 0; p.seed = target.map((value, i) => value - p.point[i]);
    push({ node: p, distance: 0 });
  }
  const protectedForeground = p => built.some(({ wall, cells, preserved }) => {
    const q = wall.axes.map(axis => dot(axis, p.point)), cell = cells.get(key(Math.floor(q[0] / wall.cellSize), Math.floor(q[1] / wall.cellSize)));
    const residual = dot(wall.normal, p.point) - wall.offset;
    return preserved.has(key(Math.floor(q[0] / wall.cellSize), Math.floor(q[1] / wall.cellSize))) ||
      (cell?.foreground && residual > .012 && residual >= cell.foregroundOffset - .025);
  });
  while (heap.length) {
    const entry = pop(), p = entry.node;
    if (entry.distance !== p.distance) continue;
    for (const [next, length] of p.neighbors) {
      const distance = p.distance + length;
      if (next.fixed || distance >= radius || distance >= next.distance) continue;
      if (next.protected === undefined) next.protected = protectedForeground(next);
      if (next.protected) continue;
      next.distance = distance; next.seed = p.seed;
      push({ node: next, distance });
    }
  }
  const affected = [...nodes.values()].filter(p => p.distance < radius);
  affected.forEach((p, i) => { p.index = i; });
  let values = new Float64Array(affected.length * 3), nextValues = values.slice();
  for (const p of affected) {
    const t = p.distance / radius, fade = 1 - t * t * (3 - 2 * t);
    for (let axis = 0; axis < 3; axis++) values[p.index * 3 + axis] = p.seed[axis] * fade;
  }
  for (let iteration = 0; iteration < 64; iteration++) {
    let change = 0;
    for (const p of affected) {
      const i = p.index * 3;
      if (p.fixed) { nextValues.set(p.seed, i); continue; }
      const sum = [0,0,0]; let weight = 0;
      for (const [neighbor, length] of p.neighbors) {
        const w = 1 / Math.max(.002, length); weight += w;
        if (neighbor.index === undefined) continue;
        for (let axis = 0; axis < 3; axis++) sum[axis] += values[neighbor.index * 3 + axis] * w;
      }
      for (let axis = 0; axis < 3; axis++) {
        nextValues[i+axis] = sum[axis] / (weight * 1.005 || 1);
        change = Math.max(change, Math.abs(nextValues[i+axis] - values[i+axis]));
      }
    }
    [values, nextValues] = [nextValues, values];
    if (change < 1e-5) break;
  }
  const positions = new Map();
  for (const p of affected) {
    const delta = Array.from(values.subarray(p.index * 3, p.index * 3 + 3));
    if (Math.hypot(...delta) > 1e-7) {
      const target = p.point.map((value, i) => value + delta[i]), floor = supportedFloorAt(p.point, planes);
      positions.set(p.k, floor ? onFloor(target, floor) : target);
    }
  }
  return positions;
}

// Move only the display copy of adjoining captured edges onto the prepared
// wall. Adding a ribbon between the old and new edges makes hundreds of fins
// with no photographed interior. Edge deformation keeps the original UVs and
// joins the actual surface, including across camera-atlas vertex duplicates.
function reconnectWallBoundaries(mesh, built, removed, owners, fragments, clippedEdges, planes, excluded) {
  const wallLattices = new Map();
  for (const { wall } of built) {
    const lattice = new Map(), [min, max] = wall.extent;
    for (let i = 0; i < wall.positions.length / 3; i++) {
      const x = Math.round(min[0] + wall.uvs[i * 2] * (max[0] - min[0]));
      const y = Math.round(min[1] + wall.uvs[i * 2 + 1] * (max[1] - min[1]));
      lattice.set(key(x, y), Array.from(wall.positions.subarray(i * 3, i * 3 + 3)));
    }
    wallLattices.set(wall, lattice);
  }
  const welds = new Map(), ids = new Uint32Array(mesh.positions.length / 3);
  const pointKey = p => p.map(value => Math.round(value / 1e-6)).join(",");
  for (let i = 0; i < ids.length; i++) {
    const k = pointKey(Array.from(mesh.positions.subarray(i * 3, i * 3 + 3)));
    if (!welds.has(k)) welds.set(k, welds.size);
    ids[i] = welds.get(k);
  }
  const edgeKey = (a, b) => ids[a] < ids[b] ? `${ids[a]},${ids[b]}` : `${ids[b]},${ids[a]}`;
  const edges = new Map();
  for (let face = 0; face < removed.length; face++) if (removed[face]) {
    for (let c = 0; c < 3; c++) {
      const a = mesh.indices[face * 3 + c], b = mesh.indices[face * 3 + (c + 1) % 3], k = edgeKey(a, b);
      if (ids[a] === ids[b]) continue;
      if (!edges.has(k)) edges.set(k, { a, b, face, owner: owners[face], count: 0 });
      edges.get(k).count++;
    }
  }
  const joins = clippedEdges.slice();
  for (let face = 0; face < removed.length; face++) if (!removed[face] && !excluded?.[face]) {
    for (let c = 0; c < 3; c++) {
      const e = edges.get(edgeKey(mesh.indices[face * 3 + c], mesh.indices[face * 3 + (c + 1) % 3]));
      if (!e || e.count !== 1 || e.matched) continue;
      e.matched = true;
      const surface = built[e.owner];
      joins.push({ a: vertex(mesh, e.a, surface.wall.axes), b: vertex(mesh, e.b, surface.wall.axes),
        face, surface });
    }
  }
  const targets = new Map(), splits = new Map();
  const geometricEdgeKey = (a, b) => [pointKey(a.p), pointKey(b.p)].sort().join("/");
  for (const { a, b, surface } of joins) {
    const { wall, cells, openings, preserved } = surface, cell = wall.cellSize, cuts = [0, 1];
    for (let axis = 0; axis < 2; axis++) {
      const delta = b.q[axis] - a.q[axis];
      if (Math.abs(delta) < 1e-9) continue;
      const low = Math.floor(Math.min(a.q[axis], b.q[axis]) / cell) + 1;
      const high = Math.floor(Math.max(a.q[axis], b.q[axis]) / cell);
      for (let k = low; k <= high; k++) cuts.push((k * cell - a.q[axis]) / delta);
    }
    cuts.sort((x, y) => x - y);
    const blocked = p => [[0,0],[-1e-5,0],[1e-5,0],[0,-1e-5],[0,1e-5]].some(([dx,dy]) => {
      const k = key(Math.floor(p.q[0] / cell + dx), Math.floor(p.q[1] / cell + dy));
      return openings.has(k) || preserved.has(k) || cells.get(k)?.foreground;
    });
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] < 1e-8) continue;
      const left = interpolate(a, b, cuts[i - 1]), right = interpolate(a, b, cuts[i]);
      const mid = interpolate(left, right, .5), nearby = [];
      for (const [dx, dy] of [[0,0],[-1e-5,0],[1e-5,0],[0,-1e-5],[0,1e-5]])
        nearby.push(key(Math.floor(mid.q[0] / cell + dx), Math.floor(mid.q[1] / cell + dy)));
      const target = cells.get(nearby.find(k => cells.has(k)));
      if (!target || blocked(mid)) continue;
      const lattice = wallLattices.get(wall), { x, y } = target;
      const corners = [[x,y], [x+1,y], [x+1,y+1], [x,y+1]].map(([gx,gy]) => lattice.get(key(gx,gy)));
      const project = p => {
        const s = Math.max(0, Math.min(1, p.q[0] / cell - x)), t = Math.max(0, Math.min(1, p.q[1] / cell - y));
        const weights = t <= s ? [1-s, s-t, t, 0] : [1-t, 0, s, t-s];
        // Match the actual planar triangles, including their small supported
        // junction snaps, rather than leaving another crack at the grid edge.
        return [0,1,2].map(axis => corners.reduce((sum, corner, i) => sum + corner[axis] * weights[i], 0));
      };
      for (const p of [left, right]) {
        if (blocked(p)) continue;
        let targetPoint = project(p);
        const floor = supportedFloorAt(p.p, planes);
        if (floor && Math.abs(wall.normal[1]) < 1e-6) targetPoint = onFloor(targetPoint, floor);
        if (Math.hypot(...targetPoint.map((value, axis) => value - p.p[axis])) < 1e-7) continue;
        const k = pointKey(p.p), previous = targets.get(k);
        // A corner shared by two prepared walls must have a single target.
        // Incompatible guesses are left captured rather than tearing the join.
        if (previous && Math.hypot(...previous.map((value, axis) => value - targetPoint[axis])) > .003) {
          targets.set(k, null); continue;
        }
        if (!targets.has(k) || previous) targets.set(k, targetPoint);
        const edge = geometricEdgeKey(a, b);
        if (!splits.has(edge)) splits.set(edge, new Map());
        splits.get(edge).set(k, p.p);
      }
    }
  }
  const adjusted = { positions: [], normals: [], colors: [], uvs: [], indices: [], sourceFaces: [], estimatedTriangleMask: [] };
  const stored = { ...fragments, positions: new Float32Array(fragments.positions),
    normals: new Float32Array(fragments.normals), colors: new Uint8Array(fragments.colors),
    uvs: new Float32Array(fragments.uvs) };
  const omitted = excluded ? Uint8Array.from(removed, (value, face) => value || excluded[face]) : removed;
  const deformations = relaxCapturedSeams(mesh, omitted, stored, targets, splits, built, pointKey, planes);
  let changedFaces = 0;
  function remap(triangle, face) {
    const polygon = [];
    for (let c = 0; c < 3; c++) {
      const a = triangle[c], b = triangle[(c + 1) % 3];
      polygon.push(a);
      const points = splits.get(geometricEdgeKey(a, b));
      if (!points) continue;
      const delta = b.p.map((value, axis) => value - a.p[axis]), denominator = dot(delta, delta);
      const interior = [...points.values()].map(p => dot(p.map((value, axis) => value - a.p[axis]), delta) / denominator)
        .filter(t => t > 1e-6 && t < 1 - 1e-6).sort((x, y) => x - y);
      for (const t of interior) polygon.push(interpolate(a, b, t));
    }
    const changed = polygon.some(p => deformations.get(pointKey(p.p)));
    if (!changed) return false;
    changedFaces++;
    const deformed = polygon.map(p => ({ ...p, p: deformations.get(pointKey(p.p)) || p.p }));
    // A centroid fan preserves source photo interpolation when a boundary
    // crosses several wall cells; it also works for perpendicular floor faces.
    const center = interpolate(interpolate(triangle[0], triangle[1], .5), triangle[2], 1 / 3);
    center.p = [0,1,2].map(axis => triangle.reduce((sum, p) => sum + (deformations.get(pointKey(p.p)) || p.p)[axis], 0) / 3);
    const triangles = deformed.length === 3 ? [deformed] : deformed.map((p, i) => [center, p, deformed[(i + 1) % deformed.length]]);
    for (const points of triangles) {
      const n = cross(points[1].p.map((value, axis) => value - points[0].p[axis]),
        points[2].p.map((value, axis) => value - points[0].p[axis]));
      if (Math.hypot(...n) < 1e-10) continue;
      appendFragment(adjusted, points.map(p => ({ ...p, n })), face, true);
    }
    return true;
  }
  for (let face = 0; face < fragments.indices.length / 3; face++) {
    const triangle = [0,1,2].map(c => vertex(stored, fragments.indices[face * 3 + c], [[1,0,0],[0,1,0]]));
    if (!remap(triangle, fragments.sourceFaces[face])) appendFragment(adjusted, triangle, fragments.sourceFaces[face]);
  }
  const movedWelds = new Set([...deformations.keys()].map(k => welds.get(k)));
  const splitWelds = new Set([...splits.keys()].map(k => {
    const [a, b] = k.split("/").map(p => welds.get(p));
    return a < b ? `${a},${b}` : `${b},${a}`;
  }));
  for (let face = 0; face < removed.length; face++) if (!removed[face] && !excluded?.[face]) {
    if (![0,1,2].some(c => movedWelds.has(ids[mesh.indices[face*3+c]]) ||
      splitWelds.has(edgeKey(mesh.indices[face*3+c], mesh.indices[face*3+(c+1)%3])))) continue;
    const triangle = [0,1,2].map(c => vertex(mesh, mesh.indices[face * 3 + c], [[1,0,0],[0,1,0]]));
    if (remap(triangle, face)) removed[face] = 1;
  }
  Object.assign(fragments, adjusted);
  return { boundaryAdjustedSourceTriangles: changedFaces,
    boundaryAdjustedVertices: deformations.size, boundarySeamVertices: [...targets.values()].filter(Boolean).length };
}

function clipFrontOfWall(polygon, wall) {
  const next = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = dot(wall.normal, a.p) - wall.offset, db = dot(wall.normal, b.p) - wall.offset;
    if (da >= -1e-8) next.push(a);
    if ((da > 1e-8 && db < -1e-8) || (da < -1e-8 && db > 1e-8)) next.push(interpolate(a, b, da / (da - db)));
  }
  return next;
}

// A measured object in front of the envelope keeps its photographed shape.
// Displaced triangles behind an independently supported wall cannot form the
// visible room interior. Clip them at the wall, inside its supported footprint
// only; no cap, color strip, or closure across a real opening is generated.
function trimWallBackground(mesh, built, removed, fragments, excluded) {
  const walls = built.filter(p => p.wall.source === "independent-depth-footprint");
  if (!walls.length) return { clippedBackgroundTriangles: 0 };
  const trimmed = { positions: [], normals: [], colors: [], uvs: [], indices: [], sourceFaces: [], estimatedTriangleMask: [] };
  let clipped = 0;
  function trim(triangle) {
    let polygons = [triangle], changed = false;
    for (const { wall, cells } of walls) {
      const result = [], cell = wall.cellSize;
      for (const polygon of polygons) {
        if (!polygon.some(p => dot(wall.normal, p.p) - wall.offset < -.002)) { result.push(polygon); continue; }
        const points = polygon.map(p => ({ ...p, q: wall.axes.map(axis => dot(axis, p.p)) }));
        const [min, max] = wall.extent;
        if ([0,1].some(axis => Math.max(...points.map(p => p.q[axis])) < min[axis] * cell ||
            Math.min(...points.map(p => p.q[axis])) > max[axis] * cell) || polygonArea(points) < 1e-10) {
          result.push(polygon); continue;
        }
        const parts = [], cut = { changed: false };
        for (let i = 1; i < points.length - 1; i++) eachTriangleCell([points[0], points[i], points[i+1]], cell,
          (x, y, piece, area) => {
            const p = cells.get(key(x, y));
            const front = p?.support >= 2 ? clipFrontOfWall(piece, wall) : piece;
            if (area - polygonArea(front) > 1e-10) cut.changed = true;
            if (front.length >= 3 && polygonArea(front) > 1e-10) parts.push(front);
          });
        if (cut.changed) { changed = true; result.push(...parts); } else result.push(polygon);
      }
      polygons = result;
    }
    return { polygons, changed };
  }
  function emit(polygons, face, estimated) {
    for (const polygon of polygons) for (let i = 1; i < polygon.length - 1; i++)
      appendFragment(trimmed, [polygon[0], polygon[i], polygon[i+1]], face, estimated);
  }
  const stored = { ...fragments, positions: new Float32Array(fragments.positions), normals: new Float32Array(fragments.normals),
    colors: new Uint8Array(fragments.colors), uvs: new Float32Array(fragments.uvs) };
  for (let face = 0; face < fragments.indices.length / 3; face++) {
    const triangle = [0,1,2].map(c => vertex(stored, fragments.indices[face * 3 + c], [[1,0,0],[0,1,0]]));
    const { polygons, changed } = trim(triangle);
    if (changed) clipped++;
    emit(polygons, fragments.sourceFaces[face], changed || !!fragments.estimatedTriangleMask[face]);
  }
  for (let face = 0; face < removed.length; face++) if (!removed[face] && !excluded?.[face]) {
    // Most retained room geometry lies in front of every wall. Avoid allocating
    // polygon/UV copies for it during preparation on the phone.
    if (!walls.some(({ wall }) => [0,1,2].some(c => {
      const offset = mesh.indices[face*3+c] * 3;
      return wall.normal.reduce((sum, n, axis) => sum + n * mesh.positions[offset+axis], 0) - wall.offset < -.002;
    }))) continue;
    const triangle = [0,1,2].map(c => vertex(mesh, mesh.indices[face * 3 + c], [[1,0,0],[0,1,0]]));
    const { polygons, changed } = trim(triangle);
    if (!changed) continue;
    removed[face] = 1; clipped++;
    emit(polygons, face, true);
  }
  Object.assign(fragments, trimmed);
  return { clippedBackgroundTriangles: clipped };
}

export function buildScanDesignSurfaces(mesh, planes, frames = [], helpers = {}, options = {}) {
  if (!mesh?.indices?.length || !mesh.positions?.length) return null;
  const cell = Math.max(.02, Math.min(.06, options.cellSize || .04));
  const selected = (Array.isArray(planes) ? planes : []).filter(p => p?.kind === "wall" &&
    p.normal?.length === 3 && p.normal.every(Number.isFinite) && Number.isFinite(p.offset) &&
    Math.hypot(...p.normal) > .5 && Math.abs(unit(p.normal)[1]) < .3).slice(0, MAX_WALLS);
  const built = selected.map(p => buildWall(mesh, p, frames, helpers, cell, planes)).filter(Boolean);
  const removed = new Uint8Array(mesh.indices.length / 3);
  // Ceiling ownership is established on the complete captured mesh, before
  // wall clipping turns its bent upper triangles into retained fragments.
  const ceilingRemoved = new Uint8Array(removed.length);
  const ceiling = prepareScanCeiling(mesh, frames, helpers, ceilingRemoved, built.map(p => p.wall));
  const owners = new Uint8Array(removed.length), clippedEdges = [];
  const fragments = { positions: [], normals: [], colors: [], uvs: [], indices: [], sourceFaces: [], estimatedTriangleMask: [] };
  for (const surface of built) for (const { face, points, extended } of surface.candidates) {
    const { wall, cells, openings, preserved } = surface;
    if (removed[face] || ceilingRemoved[face]) continue;
    const retained = []; let replacedArea = 0;
    eachTriangleCell(points, cell, (x, y, polygon, area) => {
      const p = cells.get(key(x, y));
      const center = [0, 1, 2].map(axis => polygon.reduce((sum, v) => sum + v.p[axis], 0) / polygon.length);
      const residual = dot(wall.normal, center) - wall.offset;
      const actualForeground = p?.foreground && residual > .012 && residual >= p.foregroundOffset - .025;
      const extraOwned = !extended || (p?.photoFrame && !p.detail && !p.foreground && p.support >= 3 &&
        surface.nativeWallSupport(wall.normal.map((n, axis) => n * wall.offset +
          wall.axes[0][axis] * (x + .5) * wall.cellSize + wall.axes[1][axis] * (y + .5) * wall.cellSize)) >= 2);
      if (((p && !actualForeground) || openings.has(key(x, y))) && extraOwned) replacedArea += area;
      else retained.push(polygon);
    });
    if (replacedArea < 1e-9) continue;
    removed[face] = 1;
    owners[face] = built.indexOf(surface);
    for (const polygon of retained) {
      // A clipped boundary inside a source triangle was also connected before
      // flattening. Retain its original side and join only background cells.
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], mid = interpolate(a, b, .5);
        for (let axis = 0; axis < 2; axis++) {
          if (Math.abs(a.q[axis] - b.q[axis]) > 1e-7 ||
              Math.abs(mid.q[axis] / cell - Math.round(mid.q[axis] / cell)) > 1e-6) continue;
          const ks = [-1e-5, 1e-5].map(delta => key(
            Math.floor(mid.q[0] / cell + (axis === 0 ? delta : 0)),
            Math.floor(mid.q[1] / cell + (axis === 1 ? delta : 0))));
          if (ks.filter(k => cells.has(k)).length === 1 && !ks.some(k => openings.has(k) || preserved.has(k) || cells.get(k)?.foreground))
            clippedEdges.push({ a, b, face, surface });
        }
      }
      for (let i = 1; i < polygon.length - 1; i++) {
        const triangle = [polygon[0], polygon[i], polygon[i + 1]];
        if (polygonArea(triangle) >= 1e-10) appendFragment(fragments, triangle, face);
      }
    }
  }
  const boundaryRepair = reconnectWallBoundaries(mesh, built, removed, owners, fragments, clippedEdges, planes, ceilingRemoved);
  for (const fragment of ceiling?.fragments || []) appendFragment(fragments, fragment.points, fragment.face, true);
  const backgroundCleanup = trimWallBackground(mesh, built, removed, fragments, ceilingRemoved);
  for (let face = 0; face < removed.length; face++) if (ceilingRemoved[face]) removed[face] = 1;
  if (!built.length && !ceiling) return null;
  const design = { version: SCAN_DESIGN_SURFACE_VERSION, mode: "estimated-planar-design-surface", sourceAlgorithmVersion: SCAN_DESIGN_ALGORITHM_VERSION,
    sourceKey: scanDesignSourceKey(mesh), removedSourceFaces: removed, walls: built.map(p => p.wall),
    ceilings: ceiling ? [ceiling.surface] : [],
    fragments: { positions: new Float32Array(fragments.positions), normals: new Float32Array(fragments.normals),
      colors: new Uint8Array(fragments.colors), uvs: new Float32Array(fragments.uvs),
      indices: new Uint32Array(fragments.indices), sourceFaces: new Uint32Array(fragments.sourceFaces),
      estimatedTriangleMask: new Uint8Array(fragments.estimatedTriangleMask) },
    diagnostics: { walls: built.length, area: built.reduce((sum, p) => sum + p.wall.area, 0),
      estimatedArea: built.reduce((sum, p) => sum + p.wall.estimatedArea, 0),
      preservedFoldedPhotoArea: built.reduce((sum, p) => sum + p.preserved.size * cell * cell, 0),
      removedTriangles: removed.reduce((sum, x) => sum + x, 0), fragmentTriangles: fragments.indices.length / 3,
      ...boundaryRepair, ...backgroundCleanup,
      ceiling: ceiling?.diagnostics || null,
      wallPlacement: built.map(({ wall }) => ({ id: wall.id, setbackMeters: wall.setbackMeters })),
      cellSize: cell, measuredGeometryChanged: false } };
  return scanDesignByteLength(design) <= MAX_SCAN_DESIGN_BYTES ? design : null;
}
