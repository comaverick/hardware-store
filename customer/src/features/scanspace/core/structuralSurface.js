// Rebuild independently observed horizontal footprints on one shared grid.
// Moving old fragments onto a plane leaves their cracks and overlaps intact;
// a single triangulation removes that viewpoint-dependent layering instead.
import { structuralRepairMinimumArea } from './structuralCriteria';
import { independentFrameIds } from './structuralDepth';
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const key = (x, y) => `${x},${y}`;
function gridComponents(occupied) {
  const visited = new Set(), components = [];
  for (const k of occupied.keys()) {
    if (visited.has(k)) continue;
    const queue = [k];
    visited.add(k);
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i].split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = key(x + dx, y + dy);
        if (occupied.has(next) && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(queue.length);
  }
  components.sort((a, b) => b - a);
  return {
    count: components.length,
    largestCells: components[0] || 0,
    disconnectedCells: components.slice(1).reduce((sum, size) => sum + size, 0),
  };
}
function outsideCell(polygon, x, y, boundary) {
  let inside = polygon;
  const outside = [];
  for (const [axis, sign, offset] of [[0, 1, x], [0, -1, -x - 1], [1, 1, y], [1, -1, -y - 1]]) {
    const clipped = [],
      rejected = [];
    for (let i = 0; i < inside.length; i++) {
      const a = inside[i],
        b = inside[(i + 1) % inside.length],
        da = a.q[axis] * sign - offset,
        db = b.q[axis] * sign - offset;
      if (da >= -1e-8) clipped.push(a);else rejected.push(a);
      if ((da > 1e-8 && db < -1e-8) || (da < -1e-8 && db > 1e-8)) {
        const t = da / (da - db),
          p = {
            q: a.q.map((v, k) => v + (b.q[k] - v) * t),
            p: a.p.map((v, k) => v + (b.p[k] - v) * t),
            c: a.c.map((v, k) => v + (b.c[k] - v) * t)
          };
        boundary?.(p);
        clipped.push(p);
        rejected.push(p);
      }
    }
    if (rejected.length >= 3) outside.push(rejected);
    inside = clipped;
    if (inside.length < 3) break;
  }
  return outside;
}
export function rebuildStructuralSurfaces(mesh, planes, frames, helpers, options = {}) {
  const framesById = new Map(frames.map(frame => [frame.frameId, frame]));
  const minimumCellViews = Math.max(2, Number(options.minimumCellViews) || 3);
  const replacementBandMeters = Math.max(
    0.001,
    Math.min(0.1, Number(options.replacementBandMeters) || 0.05),
  );
  const diagnostics = {
    planes: [],
    removedTriangles: 0,
    reconstructedTriangles: 0,
    reconstructedArea: 0,
    bridgedCells: 0,
    bridgedArea: 0,
    bridgedRuns: 0,
    estimatedHoleCount: 0,
    estimatedArea: 0,
    estimatedTriangles: 0,
    removedCompetingTriangles: 0,
    correctedBoundaryVertices: 0,
    splitBoundaryEdges: 0,
    rejectedBoundaryCorrections: 0,
    preservedBoundaryCells: 0,
    preservedBoundaryArea: 0,
    preservedAttachmentEdges: 0,
    maxBoundaryDisplacementMeters: 0,
    boundaryCorrectionLimitMeters: Math.min(.05, replacementBandMeters),
    minimumCellViews,
    replacementBandMeters,
  };
  const patches = [];
  for (const plane of planes) {
    if (plane.kind === 'wall' || plane.supportingFrameIds.length < 3 || plane.area < structuralRepairMinimumArea(plane.kind)) continue;
    const cell = plane.cellSize,
      occupied = new Map();
    for (const [k, views] of plane.cells) if (views.size >= minimumCellViews) occupied.set(k, {
      estimated: false
    });
    const coordinates = [...occupied.keys()].map(k => k.split(',').map(Number));
    if (!coordinates.length) continue;
    const bounds = [Math.min(...coordinates.map(p => p[0])), Math.min(...coordinates.map(p => p[1])), Math.max(...coordinates.map(p => p[0])), Math.max(...coordinates.map(p => p[1]))];
    const world = (x, y) => plane.normal.map((n, i) => n * plane.offset + plane.axes[0][i] * x * cell + plane.axes[1][i] * y * cell);
    const evidence = p => {
      const agreeing = [],
        contradicting = [];
      for (const f of frames) {
        const uv = helpers.project(f, ...p);
        if (!uv) continue;
        const x = Math.floor(uv.u * f.columns),
          y = Math.floor(uv.v * f.rows);
        if (x < 0 || y < 0 || x >= f.columns || y >= f.rows) continue;
        const i = y * f.columns + x;
        if (!f.measuredMask[i]) continue;
        // A photographed ceiling repair keeps the original measurement for
        // audit, but that biased depth must not reject its verified new plane.
        // Other rays continue to use their original observations.
        const recovered = plane.ceilingRecoveryId && f.ceilingRepairMask?.[i] === plane.ceilingRecoveryId;
        const depth = (recovered ? f.filteredDepth : f.originalFilteredDepth || f.filteredDepth)[i];
        const difference = depth - uv.depth;
        if (Math.abs(difference) < .08) agreeing.push(f);
        // A foreground object is an occlusion, not evidence of empty space.
        // It does not supply support either. Seeing through a proposed plane
        // DOES veto a patch (doorway, opening, or an incorrect plane fit).
        else if (difference > .13 && (f.freeSpaceMask?.[i] ?? 1) && (f.depthConfidence?.[i] ?? 255) >= 140)
          contradicting.push(f);
      }
      const independent = independentFrameIds(agreeing.map(frame => frame.frameId), framesById, .06);
      return {
        agrees: independent.size,
        contradicts: independentFrameIds(contradicting.map(frame => frame.frameId), framesById, .06).size
      };
    };
    // Test the interior in addition to the center. A narrow opening or object
    // must not disappear simply because the cell's center misses its edge.
    for (const [k] of occupied) {
      const [x, y] = k.split(',').map(Number);
      if ([[.5, .5], [.15, .15], [.85, .15], [.15, .85], [.85, .85]].some(([dx, dy]) => {
        const e = evidence(world(x + dx, y + dy));
        return e.agrees < minimumCellViews || e.contradicts > Math.max(1, e.agrees * .25);
      })) occupied.delete(k);
    }
    const visited = new Set();
    if (options.repairPlanarGaps) for (let y = bounds[1]; y <= bounds[3]; y++) for (let x = bounds[0]; x <= bounds[2]; x++) {
      if (occupied.has(key(x, y)) || visited.has(key(x, y))) continue;
      const group = [[x, y]];
      visited.add(key(x, y));
      let boundary = false;
      for (let cursor = 0; cursor < group.length; cursor++) {
        const [a, b] = group[cursor];
        if (a === bounds[0] || a === bounds[2] || b === bounds[1] || b === bounds[3]) boundary = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = a + dx,
            d = b + dy,
            k = key(c, d);
          if (c < bounds[0] || c > bounds[2] || d < bounds[1] || d > bounds[3] || occupied.has(k) || visited.has(k)) continue;
          visited.add(k);
          group.push([c, d]);
        }
      }
      if (boundary || group.length * cell * cell > .4) continue;
      if (group.some(([a, b]) => {
        const e = evidence(world(a + .5, b + .5));
        return e.agrees < minimumCellViews || e.contradicts > 0;
      })) continue;
      diagnostics.estimatedHoleCount++;
      for (const [a, b] of group) occupied.set(key(a, b), {
        estimated: true
      });
    }
    // Reconnect two supported patches only when the missing run is short,
    // lies between measured cells, and every proposed cell has independent
    // depth agreement. This fixes a floating-slab seam without painting a
    // plane over an unscanned opening or an occluding object.
    if (options.repairPlanarGaps) {
      const maxBridgeCells = Math.max(1, Math.floor(.35 / (cell * cell))),
        bridgeCells = new Set();
      const addRun = run => {
        if (!run.length || run.length > 3 || bridgeCells.size + run.length > maxBridgeCells) return;
        for (const [x, y] of run) {
          const e = evidence(world(x + .5, y + .5));
          if (e.agrees < minimumCellViews || e.contradicts > 0) return;
        }
        run.forEach(([x, y]) => bridgeCells.add(key(x, y)));
      };
      for (let y = bounds[1]; y <= bounds[3]; y++) {
        let x = bounds[0];
        while (x <= bounds[2]) {
          if (occupied.has(key(x, y))) {
            x++;
            continue;
          }
          const start = x;
          while (x <= bounds[2] && !occupied.has(key(x, y))) x++;
          if (start > bounds[0] && x <= bounds[2] && occupied.has(key(start - 1, y)))
            addRun(Array.from({ length: x - start }, (_, i) => [start + i, y]));
        }
      }
      for (let x = bounds[0]; x <= bounds[2]; x++) {
        let y = bounds[1];
        while (y <= bounds[3]) {
          if (occupied.has(key(x, y))) {
            y++;
            continue;
          }
          const start = y;
          while (y <= bounds[3] && !occupied.has(key(x, y))) y++;
          if (start > bounds[1] && y <= bounds[3] && occupied.has(key(x, start - 1)))
            addRun(Array.from({ length: y - start }, (_, i) => [x, start + i]));
        }
      }
      if (bridgeCells.size) {
        const before = occupied.size;
        for (const k of bridgeCells) occupied.set(k, { estimated: true, bridged: true });
        const added = occupied.size - before;
        diagnostics.bridgedCells += added;
        diagnostics.bridgedArea += added * cell * cell;
        diagnostics.bridgedRuns++;
        diagnostics.estimatedHoleCount++;
      }
    }
    if (occupied.size * cell * cell < structuralRepairMinimumArea(plane.kind)) continue;
    // The grid and retained fragments must share EXACTLY the same plane.
    // Do not replace independently fitted, nearby sheets or perpendicular
    // furniture faces: lack of evidence is not permission to delete them.
    const matchingPatchId = (mesh.planarConsolidation?.planes || []).findIndex(p =>
      p.kind === plane.kind && dot(p.normal, plane.normal) > .999999 &&
      Math.abs(p.offset - plane.offset) < 1e-5);
    if (matchingPatchId >= 0) patches.push({
      plane,
      occupied,
      world,
      cell,
      grid: gridComponents(occupied),
      matchingPatchId,
    });
  }
  if (!patches.length) return {
    ...mesh,
    structuralRebuild: diagnostics
  };
  const positions = Array.from(mesh.positions),
    colors = Array.from(mesh.colors || []),
    indices = [],
    patchIds = [],
    estimatedTriangleMask = [];
  const point = id => Array.from(mesh.positions.subarray(id * 3, id * 3 + 3));
  const tolerance = 1e-5;
  const pointKey = p => p.map(v => Math.round(v / tolerance)).join(',');
  const distance = (a, b) => Math.hypot(...sub(a, b));
  // A replacement and its retained neighbors must use the same boundary.
  // Record the ORIGINAL boundary positions as well as their bounded proposals:
  // the original coordinates identify shared edges, including texture seams.
  const seams = new Map(), faces = [];
  const touchesFootprint = (patch, p) => {
    const q = patch.plane.axes.map(a => dot(a, p) / patch.cell);
    const epsilon = tolerance / patch.cell;
    const xs = [Math.floor(q[0] - epsilon), Math.floor(q[0] + epsilon)];
    const ys = [Math.floor(q[1] - epsilon), Math.floor(q[1] + epsilon)];
    return xs.some(x => ys.some(y => patch.occupied.has(key(x, y))));
  };
  const onSegment = (p, a, b) => {
    const ab = sub(b, a), length2 = dot(ab, ab);
    if (length2 < tolerance * tolerance) return null;
    const t = dot(sub(p, a), ab) / length2;
    return t >= -1e-6 && t <= 1 + 1e-6 &&
      distance(p, a.map((v, i) => v + ab[i] * t)) <= tolerance ? t : null;
  };
  const recordBoundary = (vertex, patch, source) => {
    const p = vertex.p;
    if (!touchesFootprint(patch, p)) return;
    const residual = dot(patch.plane.normal, p) - patch.plane.offset;
    const proposed = p.map((v, i) => v - patch.plane.normal[i] * residual);
    const movement = distance(p, proposed);
    if (movement > diagnostics.boundaryCorrectionLimitMeters + 1e-7) {
      diagnostics.rejectedBoundaryCorrections++;
      return;
    }
    const k = pointKey(p), existing = seams.get(k);
    if (existing && distance(existing.proposed, proposed) > tolerance) {
      existing.rejected = true;
      diagnostics.rejectedBoundaryCorrections++;
      return;
    }
    const seam = existing || { p, proposed, movement, patch, edges: [], rejected: false };
    for (let i = 0; i < 3; i++) {
      const a = source[i], b = source[(i + 1) % 3];
      if (onSegment(p, a, b) !== null) seam.edges.push([a, b]);
    }
    seams.set(k, seam);
  };
  const replacementAt = (p, n, l, center) => patches.find(({ plane, occupied, cell }) => {
    if (Math.abs(dot(n, plane.normal)) / l < .985) return false;
    if (Math.max(...p.map(q => Math.abs(dot(plane.normal, q) - plane.offset))) > replacementBandMeters) return false;
    const x = Math.floor(dot(plane.axes[0], center) / cell), y = Math.floor(dot(plane.axes[1], center) / cell);
    return occupied.has(key(x, y)) || p.some(q => occupied.has(key(Math.floor(dot(plane.axes[0], q) / cell), Math.floor(dot(plane.axes[1], q) / cell))));
  });
  const sourceRecords = [], attachmentHash = new Map(), attachmentDirect = new Map(), attachmentEdges = new Set(), attachmentCell = .12;
  const attachmentHashKey = p => p.map(v => Math.floor(v / attachmentCell)).join(',');
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ids = Array.from(mesh.indices.subarray(t, t + 3)), p = ids.map(point);
    const n = cross(sub(p[1], p[0]), sub(p[2], p[0])), l = Math.hypot(...n) || 1;
    const center = [0, 1, 2].map(i => p.reduce((s, q) => s + q[i] / 3, 0)), patch = replacementAt(p, n, l, center);
    sourceRecords.push({ t, ids, p, n, l, center, patch });
    if (!patch) continue;
    for (let i = 0; i < 3; i++) {
      const a = p[i], b = p[(i + 1) % 3], edgeKey = [pointKey(a), pointKey(b)].sort().join('/');
      if (attachmentEdges.has(edgeKey)) continue;
      attachmentEdges.add(edgeKey);
      const edge = { a, b, patch }, steps = Math.max(1, Math.ceil(distance(a, b) / (attachmentCell * .5))), buckets = new Set();
      attachmentDirect.set(edgeKey, edge);
      for (let step = 0; step <= steps; step++) buckets.add(attachmentHashKey(a.map((v, axis) => v + (b[axis] - v) * step / steps)));
      for (const bucket of buckets) {
        if (!attachmentHash.has(bucket)) attachmentHash.set(bucket, []);
        attachmentHash.get(bucket).push(edge);
      }
    }
  }
  const protectedCells = new Map(patches.map(patch => [patch, new Set()]));
  const overlapSegment = (a, b, p, q) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], length2 = dx * dx + dy * dy + dz * dz;
    if (length2 < tolerance * tolerance) return null;
    const px = p[0] - a[0], py = p[1] - a[1], pz = p[2] - a[2], qx = q[0] - a[0], qy = q[1] - a[1], qz = q[2] - a[2];
    const first = (px * dx + py * dy + pz * dz) / length2, last = (qx * dx + qy * dy + qz * dz) / length2;
    const start = Math.max(0, Math.min(first, last)), end = Math.min(1, Math.max(first, last));
    if (end <= start || (end - start) * (end - start) * length2 <= tolerance * tolerance ||
      (px - dx * first) ** 2 + (py - dy * first) ** 2 + (pz - dz * first) ** 2 > tolerance * tolerance ||
      (qx - dx * last) ** 2 + (qy - dy * last) ** 2 + (qz - dz * last) ** 2 > tolerance * tolerance) return null;
    return [[a[0] + dx * start, a[1] + dy * start, a[2] + dz * start], [a[0] + dx * end, a[1] + dy * end, a[2] + dz * end]];
  };
  const preserveCellsAlong = (patch, a, b) => {
    const first = patch.plane.axes.map(axis => dot(axis, a) / patch.cell), last = patch.plane.axes.map(axis => dot(axis, b) / patch.cell);
    const cuts = [0, 1], epsilon = tolerance / patch.cell;
    for (let axis = 0; axis < 2; axis++) {
      const delta = last[axis] - first[axis];
      if (Math.abs(delta) < 1e-8) continue;
      for (let boundary = Math.ceil(Math.min(first[axis], last[axis])); boundary <= Math.floor(Math.max(first[axis], last[axis])); boundary++) {
        const t = (boundary - first[axis]) / delta;
        if (t > 1e-8 && t < 1 - 1e-8) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    const samples = [...cuts, ...cuts.slice(1).map((t, i) => (t + cuts[i]) / 2)];
    for (const t of samples) {
      const q = first.map((v, axis) => v + (last[axis] - v) * t);
      for (const x of [Math.floor(q[0] - epsilon), Math.floor(q[0] + epsilon)])
        for (const y of [Math.floor(q[1] - epsilon), Math.floor(q[1] + epsilon)])
          if (patch.occupied.has(key(x, y))) protectedCells.get(patch).add(key(x, y));
    }
  };
  // A retained curl can attach along an edge INSIDE a replacement cell. The new
  // grid need not contain that edge, so numerical welding cannot reconnect it.
  // Keep a measured collar at such attachments instead of pulling the curl or
  // a real raised surface onto the plane. Perpendicular walls/baseboards use
  // the bounded shared-boundary correction below and do not need this collar.
  const attachmentBounds = new Map(patches.map(patch => {
    const coordinates = [...patch.occupied.keys()].map(k => k.split(',').map(Number));
    const xs = [Math.min(...coordinates.map(q => q[0])), Math.max(...coordinates.map(q => q[0])) + 1];
    const ys = [Math.min(...coordinates.map(q => q[1])), Math.max(...coordinates.map(q => q[1])) + 1];
    const corners = xs.flatMap(x => ys.map(y => patch.world(x, y)));
    return [patch, { min: [0, 1, 2].map(i => Math.min(...corners.map(p => p[i])) - .15 - patch.cell),
      max: [0, 1, 2].map(i => Math.max(...corners.map(p => p[i])) + .15 + patch.cell) }];
  }));
  for (const record of sourceRecords) {
    const nearby = patches.filter(patch => record.patch !== patch && Math.abs(dot(record.n, patch.plane.normal)) / record.l >= .35 &&
      Math.max(...record.p.map(p => Math.abs(dot(patch.plane.normal, p) - patch.plane.offset))) <= .15 &&
      [0, 1, 2].every(i => Math.max(...record.p.map(p => p[i])) >= attachmentBounds.get(patch).min[i] && Math.min(...record.p.map(p => p[i])) <= attachmentBounds.get(patch).max[i]));
    if (!nearby.length) continue;
    for (let i = 0; i < 3; i++) {
      const a = record.p[i], b = record.p[(i + 1) % 3], candidates = new Set(), steps = Math.max(1, Math.ceil(distance(a, b) / (attachmentCell * .5)));
      const direct = attachmentDirect.get([pointKey(a), pointKey(b)].sort().join('/'));
      if (direct && nearby.includes(direct.patch)) {
        preserveCellsAlong(direct.patch, a, b); diagnostics.preservedAttachmentEdges++;
        continue;
      }
      for (let step = 0; step <= steps; step++) {
        const at = a.map((v, axis) => Math.floor((v + (b[axis] - v) * step / steps) / attachmentCell));
        for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++)
          attachmentHash.get(`${at[0] + x},${at[1] + y},${at[2] + z}`)?.forEach(edge => candidates.add(edge));
      }
      let preserved = false;
      for (const edge of candidates) if (nearby.includes(edge.patch)) {
        const segment = overlapSegment(a, b, edge.a, edge.b);
        if (!segment) continue;
        preserveCellsAlong(edge.patch, ...segment); preserved = true;
      }
      if (preserved) diagnostics.preservedAttachmentEdges++;
    }
  }
  for (const patch of patches) {
    const cells = protectedCells.get(patch);
    diagnostics.preservedBoundaryCells += cells.size;
    diagnostics.preservedBoundaryArea += cells.size * patch.cell * patch.cell;
    cells.forEach(k => patch.occupied.delete(k));
    if (patch.occupied.size * patch.cell * patch.cell < structuralRepairMinimumArea(patch.plane.kind)) patch.occupied.clear();
  }
  diagnostics.proposedBridgedCells = diagnostics.bridgedCells;
  diagnostics.proposedBridgedArea = diagnostics.bridgedArea;
  diagnostics.proposedBridgedRuns = diagnostics.bridgedRuns;
  diagnostics.bridgedCells = 0; diagnostics.bridgedArea = 0; diagnostics.bridgedRuns = 0;
  for (const patch of patches) {
    const bridged = [...patch.occupied.values()].filter(info => info.bridged).length;
    diagnostics.bridgedCells += bridged; diagnostics.bridgedArea += bridged * patch.cell * patch.cell;
    if (bridged) diagnostics.bridgedRuns++;
  }
  if (!patches.some(patch => patch.occupied.size)) return { ...mesh,
    structuralRebuild: { ...diagnostics, estimatedHoleCount: 0 } };
  if (!patches.some(patch => [...patch.occupied.values()].some(info => info.estimated))) diagnostics.estimatedHoleCount = 0;
  for (const record of sourceRecords) {
    const { t, ids, p, n, l, center } = record;
    const replacement = replacementAt(p, n, l, center);
    if (!replacement) {
      faces.push({ sourceFace: t / 3, source: p, polygons: [p.map((q, k) => ({
        p: q, id: ids[k],
        c: mesh.colors?.length ? Array.from(mesh.colors.subarray(ids[k] * 3, ids[k] * 3 + 3)) : [],
      }))] });
      continue;
    }
    const {
      plane,
      occupied,
      cell
    } = replacement;
    let pieces = [p.map((q, k) => ({
      p: q,
      c: mesh.colors?.length ? Array.from(mesh.colors.subarray(ids[k] * 3, ids[k] * 3 + 3)) : [],
      q: plane.axes.map(a => dot(a, q) / cell)
    }))];
    pieces[0].forEach(vertex => recordBoundary(vertex, replacement, p));
    const xy = pieces[0].map(q => q.q),
      bounds = [Math.floor(Math.min(...xy.map(q => q[0]))), Math.floor(Math.min(...xy.map(q => q[1]))), Math.floor(Math.max(...xy.map(q => q[0]))), Math.floor(Math.max(...xy.map(q => q[1])))];
    for (let y = bounds[1]; y <= bounds[3]; y++) for (let x = bounds[0]; x <= bounds[2]; x++) if (occupied.has(key(x, y))) pieces = pieces.flatMap(polygon => outsideCell(polygon, x, y,
      vertex => recordBoundary(vertex, replacement, p)));
    diagnostics.removedTriangles++;
    if (p.some(q => Math.abs(dot(plane.normal, q) - plane.offset) > 1e-5))
      diagnostics.removedCompetingTriangles++;
    faces.push({ sourceFace: t / 3, source: p, polygons: pieces, replacement });
  }
  const hashCell = .12, seamHash = new Map();
  // Already coplanar boundaries only need the normal topology pass. Avoid
  // indexing and resplitting every retained edge when no seam actually moves.
  const displacedBoundary = [...seams.values()].some(seam => !seam.rejected && seam.movement > tolerance);
  const hashKey = p => p.map(v => Math.floor(v / hashCell)).join(',');
  const sharedEdge = (seam, a, b) => seam.edges.some(([p, q]) => {
    const ab = sub(b, a), length2 = dot(ab, ab);
    if (length2 < tolerance * tolerance) return false;
    const first = dot(sub(p, a), ab) / length2, last = dot(sub(q, a), ab) / length2;
    return Math.min(Math.max(first, last), 1) - Math.max(Math.min(first, last), 0) > tolerance / Math.sqrt(length2) &&
      distance(p, a.map((v, i) => v + ab[i] * first)) <= tolerance &&
      distance(q, a.map((v, i) => v + ab[i] * last)) <= tolerance;
  });
  const expandBounds = (map, patch, p) => {
    if (!map.has(patch)) map.set(patch, { min: [...p], max: [...p] });
    const bounds = map.get(patch);
    for (let i = 0; i < 3; i++) {
      bounds.min[i] = Math.min(bounds.min[i], p[i]); bounds.max[i] = Math.max(bounds.max[i], p[i]);
    }
  };
  const overlapsBounds = (a, b, bounds) => bounds.some(box => [0, 1, 2].every(i =>
    Math.max(a[i], b[i]) >= box.min[i] - hashCell && Math.min(a[i], b[i]) <= box.max[i] + hashCell));
  const edgeHash = new Map(), ownedEdges = new Set(), edgeBoundsByPatch = new Map();
  for (const face of faces) if (displacedBoundary && face.replacement) {
    const source = face.source;
    for (let i = 0; i < 3; i++) {
      const a = source[i], b = source[(i + 1) % 3], k = [pointKey(a), pointKey(b)].sort().join('/');
      if (ownedEdges.has(k)) continue;
      ownedEdges.add(k);
      const edge = { a, b, patch: face.replacement, source }, steps = Math.max(1, Math.ceil(distance(a, b) / (hashCell * .5))), buckets = new Set();
      expandBounds(edgeBoundsByPatch, face.replacement, a); expandBounds(edgeBoundsByPatch, face.replacement, b);
      for (let step = 0; step <= steps; step++) buckets.add(hashKey(a.map((v, axis) => v + (b[axis] - v) * step / steps)));
      for (const bucket of buckets) {
        if (!edgeHash.has(bucket)) edgeHash.set(bucket, []);
        edgeHash.get(bucket).push(edge);
      }
    }
  }
  // Retained faces may tessellate a shared edge more finely than the floor.
  // Carry those additional source vertices too; leaving them at the old height
  // makes a zigzag boundary that numerical T-junction conformance cannot join.
  const cornerCandidates = new Map(), edgeBounds = [...edgeBoundsByPatch.values()];
  for (const face of faces) if (displacedBoundary && !face.replacement) {
    const source = face.source;
    for (let i = 0; i < 3; i++) {
      const p = source[i], k = pointKey(p);
      if (!cornerCandidates.has(k)) {
        const at = p.map(v => Math.floor(v / hashCell)), candidates = new Set();
        if (overlapsBounds(p, p, edgeBounds))
          for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++)
            edgeHash.get(`${at[0] + x},${at[1] + y},${at[2] + z}`)?.forEach(edge => candidates.add(edge));
        cornerCandidates.set(k, [...candidates].filter(edge => onSegment(p, edge.a, edge.b) !== null));
      }
      for (const edge of cornerCandidates.get(k)) {
        const seam = { edges: [[edge.a, edge.b]] };
        if (sharedEdge(seam, p, source[(i + 1) % 3]) || sharedEdge(seam, source[(i + 2) % 3], p))
          recordBoundary({ p }, edge.patch, edge.source);
      }
    }
  }
  const seamBoundsByPatch = new Map();
  for (const seam of seams.values()) if (displacedBoundary && !seam.rejected) {
    const k = hashKey(seam.p);
    if (!seamHash.has(k)) seamHash.set(k, []);
    seamHash.get(k).push(seam);
    expandBounds(seamBoundsByPatch, seam.patch, seam.p);
  }
  const seamBounds = [...seamBoundsByPatch.values()];
  // A seam corner can also belong to the next triangle of a baseboard/object.
  // Propagate the correction through actual shared source edges around that
  // corner. A separate sheet touching at only one point does not join this fan.
  const incident = new Map(), cornerFaces = new Map();
  for (const face of faces) if (displacedBoundary) {
    const source = face.source, keys = source.map(pointKey);
    for (let i = 0; i < 3; i++) {
      const seam = seams.get(keys[i]);
      if (!seam || seam.rejected) continue;
      if (!incident.has(keys[i])) incident.set(keys[i], []);
      incident.get(keys[i]).push({ face: face.sourceFace,
        neighbors: [keys[(i + 1) % 3], keys[(i + 2) % 3]],
        eligible: !!face.replacement || sharedEdge(seam, source[i], source[(i + 1) % 3]) || sharedEdge(seam, source[(i + 2) % 3], source[i]),
      });
    }
  }
  for (const [k, entries] of incident) {
    const accepted = new Set(entries.filter(e => e.eligible).map(e => e.face));
    const queue = entries.filter(e => e.eligible);
    for (let i = 0; i < queue.length; i++) for (const next of entries) {
      if (accepted.has(next.face) || !queue[i].neighbors.some(n => next.neighbors.includes(n))) continue;
      accepted.add(next.face); queue.push(next);
    }
    cornerFaces.set(k, accepted);
  }
  const corrected = new Set();
  const applySeam = seam => {
    if (seam.movement > tolerance) {
      corrected.add(pointKey(seam.p));
      diagnostics.maxBoundaryDisplacementMeters = Math.max(diagnostics.maxBoundaryDisplacementMeters, seam.movement);
    }
    return seam.proposed;
  };
  const appendVertex = vertex => {
    if (vertex.id !== undefined && vertex.p.every((v, i) => v === mesh.positions[vertex.id * 3 + i])) return vertex.id;
    const id = positions.length / 3;
    positions.push(...vertex.p);
    if (mesh.colors?.length) colors.push(...vertex.c);
    return id;
  };
  const appendFace = (a, b, c, sourceFace) => {
    if (Math.hypot(...cross(sub(pointFromOutput(b), pointFromOutput(a)), sub(pointFromOutput(c), pointFromOutput(a)))) < 1e-10) return;
    indices.push(a, b, c);
    patchIds.push(mesh.surfacePatchIds?.[sourceFace] ?? -1);
    estimatedTriangleMask.push(mesh.estimatedTriangleMask?.[sourceFace] ? 1 : 0);
  };
  const pointFromOutput = id => positions.slice(id * 3, id * 3 + 3);
  for (const face of faces) for (const polygon of face.polygons) {
    const joined = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], previous = polygon[(i + polygon.length - 1) % polygon.length];
      const corner = displacedBoundary ? seams.get(pointKey(a.p)) : null;
      const allowCorner = corner && !corner.rejected && (face.replacement || cornerFaces.get(pointKey(a.p))?.has(face.sourceFace) || sharedEdge(corner, a.p, b.p) || sharedEdge(corner, previous.p, a.p));
      joined.push({ ...a, p: allowCorner ? applySeam(corner) : a.p });
      if (!displacedBoundary || !overlapsBounds(a.p, b.p, seamBounds)) continue;
      const candidates = new Set(), steps = Math.max(1, Math.ceil(distance(a.p, b.p) / (hashCell * .5)));
      for (let step = 0; step <= steps; step++) {
        const at = a.p.map((v, k) => Math.floor((v + (b.p[k] - v) * step / steps) / hashCell));
        for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++)
          seamHash.get(`${at[0] + x},${at[1] + y},${at[2] + z}`)?.forEach(seam => candidates.add(seam));
      }
      const inserted = [];
      for (const seam of candidates) {
        const t = onSegment(seam.p, a.p, b.p);
        if (t === null || t <= 1e-6 || t >= 1 - 1e-6 || (!face.replacement && !sharedEdge(seam, a.p, b.p))) continue;
        inserted.push({ t, p: applySeam(seam), c: a.c.map((v, k) => v + (b.c[k] - v) * t) });
      }
      inserted.sort((a, b) => a.t - b.t);
      if (inserted.length) diagnostics.splitBoundaryEdges++;
      joined.push(...inserted);
    }
    const ids = joined.map(appendVertex);
    if (ids.length === 3) appendFace(...ids, face.sourceFace);
    else {
      // A moved boundary may be a shallow concavity. A center fan avoids the
      // zero-area strips produced by fanning along a subdivided source edge.
      const center = appendVertex({ p: [0, 1, 2].map(axis => joined.reduce((s, v) => s + v.p[axis] / joined.length, 0)),
        c: joined[0].c.map((_, axis) => joined.reduce((s, v) => s + v.c[axis] / joined.length, 0)) });
      for (let i = 0; i < ids.length; i++) appendFace(center, ids[i], ids[(i + 1) % ids.length], face.sourceFace);
    }
  }
  diagnostics.correctedBoundaryVertices = corrected.size;
  const storedPlanes = [...(mesh.planarConsolidation?.planes || [])];
  for (const {
    plane,
    occupied,
    world,
    cell
  } of patches) {
    const patchId = storedPlanes.length,
      lookup = new Map();
    storedPlanes.push({
      normal: plane.normal,
      offset: plane.offset,
      kind: plane.kind,
      supportingFrameIds: plane.supportingFrameIds,
      inputArea: occupied.size * cell * cell,
      retainedArea: occupied.size * cell * cell,
      maxInputResidual: 0
    });
    const vertex = (x, y) => {
      const k = key(x, y);
      if (!lookup.has(k)) {
        const p = world(x, y),
          id = positions.length / 3;
        positions.push(...p);
        lookup.set(k, id);
        if (mesh.colors?.length) {
          const samples = [];
          for (const f of frames) {
            const uv = helpers.project(f, ...p);
            if (!uv) continue;
            const i = Math.floor(uv.v * f.rows) * f.columns + Math.floor(uv.u * f.columns);
            if (f.measuredMask[i] && Math.abs(f.filteredDepth[i] - uv.depth) < .1 && f.colors?.length) samples.push(Array.from(f.colors.subarray(i * 3, i * 3 + 3)));
          }
          colors.push(...[0, 1, 2].map(i => samples.length ? samples.reduce((s, c) => s + helpers.linearByte(c[i]), 0) / samples.length : 90));
        }
      }
      return lookup.get(k);
    };
    // Subdivide each supported cell so perspective texture projection cannot
    // stretch one large photograph triangle over an entire room surface.
    for (const [k, info] of occupied) {
      const [x, y] = k.split(',').map(Number);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const a = vertex(x + dx * .5, y + dy * .5),
          b = vertex(x + (dx + 1) * .5, y + dy * .5),
          c = vertex(x + dx * .5, y + (dy + 1) * .5),
          d = vertex(x + (dx + 1) * .5, y + (dy + 1) * .5);
        if (plane.kind === 'floor') indices.push(a, b, c, b, d, c);else indices.push(a, c, b, b, c, d);
        patchIds.push(patchId, patchId);
        estimatedTriangleMask.push(info.estimated ? 1 : 0, info.estimated ? 1 : 0);
        diagnostics.reconstructedTriangles += 2;
        if (info.estimated) diagnostics.estimatedTriangles += 2;
      }
      if (info.estimated) diagnostics.estimatedArea += cell * cell;
    }
    diagnostics.reconstructedArea += occupied.size * cell * cell;
    diagnostics.planes.push({
      kind: plane.kind,
      area: occupied.size * cell * cell,
      supportingFrameIds: plane.supportingFrameIds,
      grid: gridComponents(occupied),
    });
  }
  const result = {
    ...mesh,
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    colors: mesh.colors?.length ? new Uint8Array(colors) : mesh.colors,
    surfacePatchIds: new Int32Array(patchIds),
    estimatedTriangleMask: new Uint8Array(estimatedTriangleMask),
    structuralRebuild: diagnostics,
    planarConsolidation: {
      ...(mesh.planarConsolidation || {}),
      planes: storedPlanes
    }
  };
  delete result.normals;
  return result;
}
