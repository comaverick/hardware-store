// Geometry-only reconstruction, before camera projection. Never create a room
// rectangle or fill the convex hull: the output is the union of measured faces.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const canonical = (n) => {
  const axis = n.reduce((best, v, i) => Math.abs(v) > Math.abs(n[best]) ? i : best, 0);
  return n[axis] < 0 ? n.map((v) => -v) : n;
};
const basis = (n) => {
  const u = unit(cross(n, Math.abs(n[1]) < 0.8 ? [0, 1, 0] : [1, 0, 0]));
  return [u, cross(n, u)];
};
const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

function recordsFor(mesh) {
  const records = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = Array.from(mesh.indices.subarray(i, i + 3));
    const p = ids.map((id) => Array.from(mesh.positions.subarray(id * 3, id * 3 + 3)));
    const normal = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const area = Math.hypot(...normal) / 2;
    if (area < 1e-10) continue;
    records.push({ ids, p, normal: unit(normal), area,
      center: [0, 1, 2].map((axis) => (p[0][axis] + p[1][axis] + p[2][axis]) / 3), plane: -1 });
  }
  return records;
}

// Area-weighted orthogonal fit (smallest covariance eigenvector). Unlike the
// old 9-degree orientation bins, this retains the actual measured wall angle.
function fitPlane(records, previous) {
  const center = [0, 0, 0];
  let weight = 0;
  for (const r of records) {
    const residual = Math.abs(dot(previous.n, r.center) - previous.d);
    const w = r.area * Math.min(1, 0.025 / Math.max(0.001, residual));
    weight += w;
    for (let i = 0; i < 3; i++) center[i] += r.center[i] * w;
  }
  if (!weight) return previous;
  for (let i = 0; i < 3; i++) center[i] /= weight;
  const a = Array.from({ length: 3 }, () => [0, 0, 0]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const r of records) {
    const residual = Math.abs(dot(previous.n, r.center) - previous.d);
    const w = r.area * Math.min(1, 0.025 / Math.max(0.001, residual));
    // Include triangle corners so sparse, large faces are not rank deficient.
    for (const point of r.p) {
      const q = sub(point, center);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += q[i] * q[j] * w / 3;
    }
  }
  for (let iteration = 0; iteration < 18; iteration++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const pp = a[p][p], qq = a[q][q], pq = a[p][q];
    a[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    a[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const kp = a[k][p], kq = a[k][q];
        a[k][p] = a[p][k] = c * kp - s * kq;
        a[k][q] = a[q][k] = s * kp + c * kq;
      }
      const vp = v[k][p], vq = v[k][q];
      v[k][p] = c * vp - s * vq;
      v[k][q] = s * vp + c * vq;
    }
  }
  const axis = [0, 1, 2].reduce((best, i) => a[i][i] < a[best][best] ? i : best, 0);
  const n = canonical(unit(v.map((row) => row[axis])));
  return { n, d: dot(n, center) };
}

function connectedPatches(records, plane, cell = 0.2) {
  const [u, v] = basis(plane.n);
  const cells = new Map();
  for (const r of records) {
    const x = Math.floor(dot(u, r.center) / cell), y = Math.floor(dot(v, r.center) / cell);
    const key = `${x},${y}`;
    if (!cells.has(key)) cells.set(key, { x, y, records: [] });
    cells.get(key).records.push(r);
  }
  const result = [];
  while (cells.size) {
    const first = cells.values().next().value;
    cells.delete(`${first.x},${first.y}`);
    const queue = [first], group = [];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      group.push(...current.records);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const key = `${current.x + dx},${current.y + dy}`;
        if (cells.has(key)) { queue.push(cells.get(key)); cells.delete(key); }
      }
    }
    result.push(group);
  }
  return result;
}

function supportedPatch(records, plane, report) {
  const area = records.reduce((sum, r) => sum + r.area, 0);
  if (area < 0.35) return false;
  const [u, v] = basis(plane.n);
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let aligned = 0;
  for (const r of records) {
    if (Math.abs(dot(r.normal, plane.n)) >= 0.94) aligned += r.area;
    for (const p of r.p) {
      const x = dot(p, u), y = dot(p, v);
      bounds[0] = Math.min(bounds[0], x); bounds[2] = Math.max(bounds[2], x);
      bounds[1] = Math.min(bounds[1], y); bounds[3] = Math.max(bounds[3], y);
    }
  }
  // Narrow strips of a cylinder/curtain are not evidence for a flat wall.
  report?.({ area, alignment: aligned / area, width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] });
  return aligned / area >= 0.5 && bounds[2] - bounds[0] >= 0.65 && bounds[3] - bounds[1] >= 0.65;
}

function hasMeasuredThickness(group, available, plane) {
  // Two crisp parallel faces joined by measured side faces describe a real
  // slab/trim/box, not two observations of the same wall. Do not collapse it.
  const bins = new Map();
  let total = 0;
  for (const r of group) {
    if (Math.abs(dot(r.normal, plane.n)) < 0.98) continue;
    const bin = Math.round((dot(plane.n, r.center) - plane.d) / 0.005);
    bins.set(bin, (bins.get(bin) || 0) + r.area);
    total += r.area;
  }
  const peaks = [...bins].sort((a, b) => b[1] - a[1]).filter(([, area]) => area > Math.max(0.025, total * 0.025));
  if (peaks.length < 2) return false;
  const first = peaks[0][0] * 0.005;
  const second = peaks.find(([bin]) => Math.abs(bin * 0.005 - first) >= 0.025)?.[0];
  if (second === undefined) return false;
  const last = second * 0.005;
  let crispArea = 0;
  for (const [bin, area] of bins)
    if (Math.min(Math.abs(bin * 0.005 - first), Math.abs(bin * 0.005 - last)) <= 0.0075) crispArea += area;
  if (crispArea < total * 0.9) return false;
  const [u, v] = basis(plane.n);
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of group) for (const p of r.p) {
    const x = dot(u, p), y = dot(v, p);
    bounds[0] = Math.min(bounds[0], x); bounds[2] = Math.max(bounds[2], x);
    bounds[1] = Math.min(bounds[1], y); bounds[3] = Math.max(bounds[3], y);
  }
  return available.some((r) => {
    if (Math.abs(dot(r.normal, plane.n)) > 0.3) return false;
    const x = dot(u, r.center), y = dot(v, r.center);
    if (x < bounds[0] - 0.005 || x > bounds[2] + 0.005 || y < bounds[1] - 0.005 || y > bounds[3] + 0.005) return false;
    const offsets = r.p.map((p) => dot(plane.n, p) - plane.d);
    return Math.abs(Math.min(...offsets) - Math.min(first, last)) < 0.009 &&
      Math.abs(Math.max(...offsets) - Math.max(first, last)) < 0.009;
  });
}

// Look for spatially coherent relief BEFORE projection. A broad normal vote
// alone cannot distinguish a shallow curtain or a picture from wall noise.
// Cell means cancel overlapping noisy sheets; local steps/ridges survive.
function protectMeasuredRelief(group, plane, sourcePositions, frames, protectedVertices) {
  const [u, v] = basis(plane.n), size = 0.075, cells = new Map(), seen = new Set();
  const keyAt = (p) => `${Math.floor(dot(u, p) / size)},${Math.floor(dot(v, p) / size)}`;
  for (const r of group) for (let corner = 0; corner < 3; corner++) {
    const id = r.ids[corner];
    if (seen.has(id)) continue;
    seen.add(id);
    const p = sourcePositions ? Array.from(sourcePositions.subarray(id * 3, id * 3 + 3)) : r.p[corner];
    const key = keyAt(p), residual = dot(plane.n, p) - plane.d;
    if (!cells.has(key)) cells.set(key, { key, xy: key.split(',').map(Number), sum: 0, count: 0, ids: [], views: new Map() });
    const cell = cells.get(key);
    cell.sum += residual; cell.count++; cell.ids.push(id);
  }
  for (const cell of cells.values()) cell.depth = cell.sum / cell.count;
  // Independent per-view contrasts corroborate the shape without letting RGB
  // edges (a flat striped wall, for example) invent geometric depth.
  for (let frameId = 0; frameId < (frames?.length || 0); frameId++) {
    const frame = frames[frameId];
    const stride = Math.max(1, Math.ceil((frame.filteredCount || 0) / 1800));
    for (let i = 0; i < frame.measuredMask.length; i += stride) {
      if (!frame.measuredMask[i]) continue;
      const p = Array.from(frame.positions.subarray(i * 3, i * 3 + 3));
      const residual = dot(plane.n, p) - plane.d;
      if (!Number.isFinite(residual) || Math.abs(residual) > 0.12) continue;
      const cell = cells.get(keyAt(p));
      if (!cell) continue;
      const value = cell.views.get(frameId) || { sum: 0, count: 0 };
      value.sum += residual; value.count++; cell.views.set(frameId, value);
    }
  }
  const contrasts = new Map();
  const agrees = (a, b) => {
    if (!frames?.length) return true; // conservative geometry-only inspection
    const key = `${a.key}/${b.key}`;
    if (contrasts.has(key)) return contrasts.get(key);
    const expected = a.depth - b.depth;
    const observations = [];
    for (const [id, first] of a.views) {
      const second = b.views.get(id);
      if (!second) continue;
      const difference = first.sum / first.count - second.sum / second.count;
      observations.push({ id, difference });
    }
    // Unobserved detail remains protected locally, but must not flood-fill a
    // whole wall. Require at least two independent views and reject any edge
    // with contradictory depth evidence; a single view cannot distinguish a
    // real raised object from a registration seam.
    if (observations.length < 2) {
      contrasts.set(key, null);
      return null;
    }
    const center = median(observations.map((o) => o.difference));
    const scatter = 1.4826 * median(observations.map((o) => Math.abs(o.difference - center)));
    const supporting = observations.filter((o) => o.difference * expected > 0 &&
      Math.abs(o.difference) >= 0.006 &&
      Math.abs(o.difference - center) <= Math.max(0.008, scatter * 2));
    const stable = center * expected > 0 && Math.abs(center) >= Math.max(0.009, scatter * 1.5) &&
      Math.abs(center - expected) <= Math.max(0.01, Math.abs(expected) * 0.45) &&
      supporting.length >= Math.ceil(observations.length * 0.7) &&
      supporting.some(({ id }) => supporting.some(({ id: other }) => {
        const p = frames[id].camera, q = frames[other].camera;
        return p && q && Math.hypot(...sub(p, q)) >= 0.04;
      }));
    contrasts.set(key, stable);
    return stable;
  };
  const seeds = new Set();
  const raised = [];
  const depths = [...cells.values()].map((c) => c.depth);
  const baseline = median(depths);
  const hasEvidence = !!frames?.length;
  const stepAt = (a, b) => a?.count >= 3 && b?.count >= 3 &&
    Math.abs(a.depth - b.depth) > 0.014 &&
    // With captured views, a depth step is protected only when the same
    // edge is reproduced by separated cameras. Synthetic/legacy callers that
    // have no view evidence retain the geometry-only behavior.
    (!hasEvidence || agrees(a, b) === true);
  for (const cell of cells.values()) {
    // A sparsely sampled cell can contain only one of two overlapping sheets.
    // Alternating sheet occupancy is not a measured step or curtain ridge.
    if (cell.count < 3) continue;
    const [x, y] = cell.xy;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const before = cells.get(`${x - dx},${y - dy}`), after = cells.get(`${x + dx},${y + dy}`);
      if (before?.count >= 3 && after?.count >= 3) {
        const left = cell.depth - before.depth, right = cell.depth - after.depth;
        if (left * right > 0 && Math.min(Math.abs(left), Math.abs(right)) > 0.006 &&
            Math.abs(left + right) > 0.018 &&
            (!hasEvidence || (agrees(cell, before) === true && agrees(cell, after) === true))) {
          seeds.add(cell.key); seeds.add(before.key); seeds.add(after.key);
        }
      }
      // A real edge continues spatially. Do not seed protection from a lone
      // inconsistent cell, which otherwise expands into a large frozen patch.
      const continuous = [-1, 1].some((side) => {
        const a = cells.get(`${x + dy * side},${y + dx * side}`);
        const b = cells.get(`${x + dx + dy * side},${y + dy + dx * side}`);
        return stepAt(a, b) && (a.depth - b.depth) * (cell.depth - after?.depth) > 0;
      });
      if (stepAt(cell, after) && continuous) {
        seeds.add(cell.key); seeds.add(after.key);
        const front = Math.abs(cell.depth - baseline) > Math.abs(after.depth - baseline) ? cell : after;
        const back = front === cell ? after : cell;
        if (agrees(front, back) === true) raised.push({ cell: front, front, back });
      }
    }
  }
  // Grow along a raised front, not just its edge. A picture need not have a
  // visible back or side face to retain its measured offset from the wall.
  const grown = new Set();
  for (let i = 0; i < raised.length; i++) {
    const { cell, front, back } = raised[i], [x, y] = cell.xy;
    if (Math.abs(cell.depth - baseline) < 0.012) continue;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const next = cells.get(`${x + dx},${y + dy}`);
      if (!next || grown.has(next.key)) continue;
      // Compare to the ORIGINAL raised surface and its background, not just
      // the previous cell. A random walk through wall noise cannot grow a mask.
      if (Math.abs(next.depth - front.depth) <= Math.max(0.008, Math.abs(front.depth - back.depth) * 0.35) &&
          Math.abs(next.depth - baseline) >= 0.012 && agrees(next, back) === true) {
        seeds.add(next.key); grown.add(next.key); raised.push({ cell: next, front, back });
      }
    }
  }
  // Include boundaries: otherwise an eligible neighboring wall triangle can
  // still pull a protected fold/frame vertex onto its plane.
  // Faces incident on a protected vertex are already excluded below. Expanding
  // by a full 3x3 grid added a 7.5 cm halo and swallowed otherwise flat walls.
  for (const key of seeds) cells.get(key)?.ids.forEach((id) => protectedVertices.add(id));
}

function detectPlanes(records, distanceLimit, options, protectedVertices) {
  const planes = [], ignored = new Set();
  for (let pass = 0; pass < 12 && planes.length < 10; pass++) {
    const available = records.filter((r) => r.plane < 0 && !ignored.has(r));
    if (!available.length) break;
    // Deterministic, area-weighted normal/offset voting; no random RANSAC
    // outcomes, Manhattan-room assumption, or dependency on triangle density.
    const directions = new Map();
    const coarseNormals = new Map();
    for (const r of available) {
      const n = canonical(r.normal), key = n.map((x) => Math.round(x * 12)).join(',');
      if (!directions.has(key)) directions.set(key, { n: [0, 0, 0], area: 0 });
      const value = directions.get(key);
      value.area += r.area;
      for (let i = 0; i < 3; i++) value.n[i] += n[i] * r.area;
      const cell = r.center.map((x) => Math.floor(x / 0.3)).join(',');
      if (!coarseNormals.has(cell)) coarseNormals.set(cell, { n: [0, 0, 0], area: 0 });
      const coarse = coarseNormals.get(cell);
      coarse.area += r.area;
      for (let i = 0; i < 3; i++) coarse.n[i] += n[i] * r.area;
    }
    // Small noisy triangles may never vote for their underlying flat surface.
    // Add measured, locally averaged normals as hypotheses (not axis-aligned
    // walls). The same relief and support tests still decide eligibility.
    for (const coarse of coarseNormals.values()) {
      const n = unit(coarse.n), key = n.map((x) => Math.round(x * 12)).join(',');
      if (!directions.has(key)) directions.set(key, { n: [0, 0, 0], area: 0 });
      const value = directions.get(key);
      value.area += coarse.area;
      for (let i = 0; i < 3; i++) value.n[i] += n[i] * coarse.area;
    }
    const candidates = [...directions.values()].sort((a, b) => b.area - a.area).slice(0, 20);
    let best = null;
    for (const candidate of candidates) {
      const n = unit(candidate.n), bins = new Map();
      for (const r of available) {
        if (Math.abs(dot(n, r.normal)) < 0.94) continue;
        const bin = Math.round(dot(n, r.center) / 0.025);
        for (let offset = -1; offset <= 1; offset++) bins.set(bin + offset, (bins.get(bin + offset) || 0) + r.area);
      }
      for (const [bin, area] of bins) if (!best || area > best.area) best = { n, d: bin * 0.025, area };
    }
    if (!best || best.area < 0.35) break;
    let plane = best;
    for (let iteration = 0; iteration < 3; iteration++) {
      const current = plane;
      const inliers = available.filter((r) => Math.abs(dot(current.n, r.normal)) >= 0.9 && Math.abs(dot(current.n, r.center) - current.d) <= 0.055);
      plane = fitPlane(inliers, current);
    }
    const inliers = available.filter((r) => Math.abs(dot(plane.n, r.normal)) >= 0.82 && r.p.every((p) => Math.abs(dot(plane.n, p) - plane.d) <= distanceLimit));
    if (!inliers.length) break;
    const inlierSet = new Set(inliers);
    // Test the broad neighborhood too: selecting only the front-facing facets
    // of a folded or curved object must not manufacture a planar consensus.
    const neighborhood = available.filter((r) => Math.abs(dot(plane.n, r.normal)) >= 0.35 && Math.abs(dot(plane.n, r.center) - plane.d) <= distanceLimit);
    for (const group of connectedPatches(neighborhood, plane)) {
      protectMeasuredRelief(group, plane, options.sourcePositions, options.evidenceFrames, protectedVertices);
      const eligible = group.filter((r) => inlierSet.has(r) && !r.ids.some((id) => protectedVertices.has(id)));
      if (!supportedPatch(group, plane, options.report) || !supportedPatch(eligible, plane)) continue;
      if (hasMeasuredThickness(eligible, available, plane)) continue;
      const id = planes.length;
      // Protected foreground relief must not tilt the remaining wall fit.
      const fitted = fitPlane(eligible, plane);
      planes.push({ n: fitted.n, d: fitted.d });
      eligible.forEach((r) => { r.plane = id; });
    }
    inliers.forEach((r) => ignored.add(r));
  }
  return planes;
}

const area2 = (polygon) => polygon.reduce((sum, p, i) => {
  const next = polygon[(i + 1) % polygon.length]; return sum + p.x * next.y - p.y * next.x;
}, 0);

// Split rather than dropping triangles by centroid. Retain every unique part
// of a duplicate sheet, including its captured boundary and holes. Barycentric
// weights retain vertex colors (and UVs when inspecting a previously saved mesh).
function splitPolygon(polygon, a, b) {
  const inside = [], outside = [];
  const side = (p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const sp = side(p), sq = side(q);
    if (sp >= 0) inside.push(p);
    if (sp <= 0) outside.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      const intersection = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t,
        w: p.w.map((v, k) => v + (q.w[k] - v) * t) };
      inside.push(intersection); outside.push(intersection);
    }
  }
  return [inside, outside];
}

function subtractTriangle(polygon, triangle) {
  let intersection = polygon;
  for (let edge = 0; edge < 3 && intersection.length >= 3; edge++)
    [intersection] = splitPolygon(intersection, triangle[edge], triangle[(edge + 1) % 3]);
  // Disjoint/edge-touching faces must not be fragmented by extensions of the
  // other triangle's edges. This also bounds work on dense mobile meshes.
  if (intersection.length < 3 || Math.abs(area2(intersection)) < 2e-9) return [polygon];
  let remaining = polygon;
  const outside = [];
  for (let edge = 0; edge < 3 && remaining.length >= 3; edge++) {
    const [inside, part] = splitPolygon(remaining, triangle[edge], triangle[(edge + 1) % 3]);
    if (part.length >= 3 && Math.abs(area2(part)) > 1e-10) outside.push(part);
    remaining = inside;
  }
  return outside;
}

function hashKeys(triangle, cell) {
  const xs = triangle.map((p) => p.x), ys = triangle.map((p) => p.y), keys = [];
  for (let y = Math.floor(Math.min(...ys) / cell); y <= Math.floor(Math.max(...ys) / cell); y++)
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x++) keys.push(`${x},${y}`);
  return keys;
}

export function consolidatePlanarSurfaces(mesh, options = {}) {
  const records = recordsFor(mesh);
  const distanceLimit = Math.min(0.08, Math.max(0.045, (options.voxelSize || 0.03) * 2.6));
  const protectedVertices = new Set();
  const planes = detectPlanes(records, distanceLimit, options, protectedVertices);
  // Protection discovered by another plane must also win at shared corners.
  for (const r of records) if (r.ids.some((id) => protectedVertices.has(id))) r.plane = -1;
  const diagnostics = { version: 3, planes: [], protectedVertices: protectedVertices.size, correctedVertices: 0, removedOverlapArea: 0, inputTriangles: mesh.indices.length / 3, outputTriangles: mesh.indices.length / 3 };
  const positions = new Float32Array(mesh.positions);
  if (options.sourcePositions && !options.preserveDenoisedRelief)
    for (const id of protectedVertices) positions.set(options.sourcePositions.subarray(id * 3, id * 3 + 3), id * 3);
  if (!planes.length) {
    const restored = options.sourcePositions && protectedVertices.size;
    return { ...mesh, positions: restored ? positions : mesh.positions,
      ...(restored ? { surfaceArea: recordsFor({ ...mesh, positions }).reduce((sum, r) => sum + r.area, 0) } : {}),
      planarConsolidation: diagnostics };
  }
  const constraints = new Map();
  for (const r of records) if (r.plane >= 0) for (const id of r.ids) {
    if (!constraints.has(id)) constraints.set(id, new Set());
    constraints.get(id).add(r.plane);
  }
  for (const [id, ids] of constraints) {
    const p = Array.from(positions.subarray(id * 3, id * 3 + 3));
    const values = [...ids].map((i) => planes[i]);
    let q = [...p];
    // Alternating orthogonal projections keep shared wall/floor corners joined.
    // Final per-face projection below is exact, including at atlas UV seams.
    for (let iteration = 0; iteration < 24; iteration++) for (const plane of values) {
      const residual = dot(plane.n, q) - plane.d;
      q = q.map((v, i) => v - plane.n[i] * residual);
    }
    if (Math.hypot(...sub(p, q)) > distanceLimit * 1.5) continue;
    positions.set(q, id * 3);
    diagnostics.correctedVertices++;
  }
  const outputPositions = [], outputIndices = [], outputPatches = [], attributes = {}, vertexLookup = new Map();
  let outputArea = 0;
  for (const [name, size] of [['colors', 3], ['portableColors', 3], ['uvs', 2]])
    if (mesh[name]?.length === mesh.positions.length / 3 * size) attributes[name] = { size, values: [] };
  const append = (r, polygon, plane = null, axes = null) => {
    if (polygon.length < 3) return;
    const ids = [];
    for (const point of polygon) {
      let p;
      if (plane) p = plane.n.map((n, axis) => n * plane.d + axes[0][axis] * point.x + axes[1][axis] * point.y);
      else p = [0, 1, 2].map((axis) => r.ids.reduce((sum, id, k) => sum + positions[id * 3 + axis] * point.w[k], 0));
      const values = {};
      for (const [name, attribute] of Object.entries(attributes))
        values[name] = Array.from({ length: attribute.size }, (_, axis) => r.ids.reduce((sum, id, k) => sum + mesh[name][id * attribute.size + axis] * point.w[k], 0));
      // Restore shared edges after clipping. Texture selection uses adjacency;
      // a triangle soup would silently disable its seam-consistency votes.
      const key = [...p, ...(values.uvs || [])].map((value) => Math.round(value * 1e6)).join(',');
      let vertex = vertexLookup.get(key);
      if (vertex === undefined) {
        vertex = outputPositions.length / 3;
        vertexLookup.set(key, vertex);
        outputPositions.push(...p);
        for (const [name, attribute] of Object.entries(attributes)) attribute.values.push(...values[name]);
      }
      ids.push(vertex);
    }
    for (let i = 1; i < polygon.length - 1; i++) {
      if (ids[0] === ids[i] || ids[0] === ids[i + 1] || ids[i] === ids[i + 1]) continue;
      const a = Array.from(outputPositions.slice(ids[0] * 3, ids[0] * 3 + 3));
      const b = Array.from(outputPositions.slice(ids[i] * 3, ids[i] * 3 + 3));
      const c = Array.from(outputPositions.slice(ids[i + 1] * 3, ids[i + 1] * 3 + 3));
      const twiceArea = Math.hypot(...cross(sub(b, a), sub(c, a)));
      if (twiceArea > 1e-10) {
        outputIndices.push(ids[0], ids[i], ids[i + 1]); outputArea += twiceArea / 2;
        let patch = r.plane;
        if (patch < 0) patch = planes.findIndex(plane => Math.abs(dot(plane.n, r.normal)) >= 0.35 && r.p.every(p => Math.abs(dot(plane.n, p) - plane.d) < 0.14));
        outputPatches.push(patch);
      }
    }
  };
  const weights = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const r of records) if (r.plane < 0) append(r, weights.map((w) => ({ w })));
  planes.forEach((plane, id) => {
    const axes = basis(plane.n), cells = new Map();
    const faces = records.filter((r) => r.plane === id).sort((a, b) =>
      Math.abs(dot(plane.n, a.center) - plane.d) - Math.abs(dot(plane.n, b.center) - plane.d));
    // Opposite sides of a spurious sheet can have opposite winding. Once they
    // represent one surface, use a coherent normal so shared vertex normals
    // cannot cancel and disable texture seam voting.
    const reverseOutput = faces.reduce((sum, r) => sum + r.area * dot(r.normal, plane.n), 0) < 0;
    let projectedArea = 0, retainedArea = 0, maxResidual = 0;
    for (const r of faces) {
      for (const point of r.p) maxResidual = Math.max(maxResidual, Math.abs(dot(plane.n, point) - plane.d));
      let triangle = r.ids.map((vertex, k) => {
        const p = Array.from(positions.subarray(vertex * 3, vertex * 3 + 3));
        return { x: dot(p, axes[0]), y: dot(p, axes[1]), w: weights[k] };
      });
      const reverse = area2(triangle) < 0;
      if (reverse) triangle = [...triangle].reverse();
      const originalArea = Math.abs(area2(triangle)) / 2;
      if (originalArea < 1e-10) continue;
      projectedArea += originalArea;
      const keys = hashKeys(triangle, 0.1), nearby = new Set();
      keys.forEach((key) => cells.get(key)?.forEach((other) => nearby.add(other)));
      let pieces = [triangle];
      for (const other of nearby) {
        pieces = pieces.flatMap((piece) => subtractTriangle(piece, other));
        if (!pieces.length) break;
      }
      for (let piece of pieces) {
        retainedArea += Math.abs(area2(piece)) / 2;
        if (reverseOutput) piece = [...piece].reverse();
        append(r, piece, plane, axes);
      }
      if (pieces.length) keys.forEach((key) => {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(triangle);
      });
    }
    diagnostics.removedOverlapArea += Math.max(0, projectedArea - retainedArea);
    diagnostics.planes.push({ normal: plane.n, offset: plane.d, inputArea: projectedArea, retainedArea, maxInputResidual: maxResidual });
  });
  const result = { ...mesh, positions: new Float32Array(outputPositions), indices: new Uint32Array(outputIndices), surfacePatchIds: new Int32Array(outputPatches), planarConsolidation: diagnostics };
  for (const [name, attribute] of Object.entries(attributes)) result[name] = new mesh[name].constructor(attribute.values);
  // Normals belong to the final topology, never to the discarded duplicate sheet.
  delete result.normals;
  result.surfaceArea = outputArea;
  diagnostics.outputTriangles = result.indices.length / 3;
  return result;
}
