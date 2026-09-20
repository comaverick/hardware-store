import { fitPlane } from './planarSurface';
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(...a);
const unit = a => a.map(v => v / (length(a) || 1));
const canonical = n => n[n.reduce((k, v, i) => Math.abs(v) > Math.abs(n[k]) ? i : k, 0)] < 0 ? n.map(v => -v) : n;
const at = (f, i) => Array.from(f.positions.subarray(i * 3, i * 3 + 3));
const basis = n => {
  const u = unit(cross(n, Math.abs(n[1]) < .8 ? [0, 1, 0] : [1, 0, 0]));
  return [u, cross(n, u)];
};
const cameraDistance = (a, b) => length(sub(Array.from(a.camera), Array.from(b.camera)));
function samplesFor(frame) {
  const samples = [],
    w = frame.columns,
    h = frame.rows;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x,
      ids = [i, i - 1, i + 1, i - w, i + w];
    if (ids.some(k => !frame.measuredMask[k] || !frame.filteredDepth[k])) continue;
    const depths = ids.map(k => frame.filteredDepth[k]);
    if (Math.max(...depths) - Math.min(...depths) > Math.max(.16, depths[0] * .07)) continue;
    const n = unit(cross(sub(at(frame, i + 1), at(frame, i - 1)), sub(at(frame, i + w), at(frame, i - w))));
    if (length(n) > .9) samples.push({
      p: at(frame, i),
      n,
      i
    });
  }
  return samples;
}

// Per-view fits must explain a broad patch, not just a ribbon on a curtain or
// the top of a desk. Consensus is then required from translated camera poses.
function planeCandidate(samples, kind, floorY, seed) {
  const source = samples.filter(s => kind === 'floor' ? Math.abs(s.p[1] - floorY) < .3 && Math.abs(s.n[1]) > .9 : kind === 'ceiling' ? s.p[1] > floorY + 1.9 && Math.abs(s.n[1]) > .9 : Math.abs(s.n[1]) < .23 && s.p[1] > floorY + .2);
  if (source.length < 90) return null;
  let best = null;
  const random = () => {
    seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
    return seed % source.length;
  };
  for (let attempt = 0; attempt < 120; attempt++) {
    const p = source[random()].p,
      q = source[random()].p,
      r = source[random()].p;
    const normal = cross(sub(q, p), sub(r, p));
    if (length(normal) < .08) continue;
    const n = canonical(unit(normal));
    if (kind === 'wall' ? Math.abs(n[1]) > .12 : Math.abs(n[1]) < .985) continue;
    const d = dot(n, p),
      inliers = source.filter(s => Math.abs(dot(n, s.p) - d) < .03 && Math.abs(dot(n, s.n)) > .94);
    if (!best || inliers.length > best.inliers.length) best = {
      n,
      d,
      inliers
    };
  }
  if (!best || best.inliers.length < 80 || best.inliers.length / source.length < .38) return null;
  for (let pass = 0; pass < 2; pass++) {
    const records = best.inliers.map(s => ({
      center: s.p,
      p: [s.p],
      area: 1
    }));
    const fitted = fitPlane(records, best);
    best = {
      ...fitted,
      inliers: source.filter(s => Math.abs(dot(fitted.n, s.p) - fitted.d) < .035 && Math.abs(dot(fitted.n, s.n)) > .94)
    };
  }
  const axes = basis(best.n),
    cells = new Set(),
    bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of best.inliers) {
    const x = dot(axes[0], s.p),
      y = dot(axes[1], s.p);
    cells.add(`${Math.floor(x / .12)},${Math.floor(y / .12)}`);
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], y);
  }
  if (cells.size * .0144 < .6 || bounds[2] - bounds[0] < .7 || bounds[3] - bounds[1] < .7) return null;
  return {
    ...best,
    kind,
    area: cells.size * .0144
  };
}
export function discoverStructuralPlanes(frames, {
  floorY = NaN
} = {}) {
  if (!Number.isFinite(floorY) || frames.length < 3) return [];
  const candidates = [];
  frames.forEach((frame, id) => {
    const samples = samplesFor(frame);
    for (const kind of ['floor', 'ceiling', 'wall']) {
      const fit = planeCandidate(samples, kind, floorY, 81 + id * 37);
      if (fit) candidates.push({
        ...fit,
        frame
      });
    }
  });
  const planes = [],
    used = new Set();
  for (const seed of candidates.slice().sort((a, b) => b.area - a.area)) {
    if (used.has(seed)) continue;
    const group = candidates.filter(c => !used.has(c) && c.kind === seed.kind && dot(c.n, seed.n) > .993 && Math.abs(dot(seed.n, c.inliers[Math.floor(c.inliers.length / 2)].p) - seed.d) < (seed.kind === 'wall' ? .09 : .14));
    const independent = [];
    for (const c of group) if (independent.every(other => cameraDistance(c.frame, other.frame) >= .06)) independent.push(c);
    if (independent.length < 3) continue;
    const records = independent.flatMap(c => c.inliers.filter((_, i) => i % 3 === 0).map(s => ({
      p: [s.p],
      center: s.p,
      area: 1 / c.inliers.length
    })));
    const fit = fitPlane(records, seed),
      axes = basis(fit.n),
      cells = new Map();
    for (const c of group) for (const s of c.inliers) {
      if (Math.abs(dot(fit.n, s.p) - fit.d) > .065) continue;
      const key = `${Math.floor(dot(axes[0], s.p) / .12)},${Math.floor(dot(axes[1], s.p) / .12)}`;
      if (!cells.has(key)) cells.set(key, new Set());
      cells.get(key).add(c.frame.frameId);
    }
    const supported = [...cells.values()].filter(ids => ids.size >= 2).length;
    if (supported * .0144 < .65) continue;
    // Extend the footprint using nearby observations, but never over a stable
    // second height (a real step, beam or suspended panel). Each cell votes
    // once per camera view so dense sampling does not masquerade as evidence.
    if (seed.kind !== 'wall') {
      const nearby = new Map();
      for (const f of frames) for (const s of samplesFor(f)) {
        const residual = dot(fit.n, s.p) - fit.d;
        if (Math.abs(residual) > .22 || Math.abs(dot(fit.n, s.n)) < .9) continue;
        const k = `${Math.floor(dot(axes[0], s.p) / .12)},${Math.floor(dot(axes[1], s.p) / .12)}`;
        if (!nearby.has(k)) nearby.set(k, new Map());
        const views = nearby.get(k),
          values = views.get(f.frameId) || [];
        values.push(residual);
        views.set(f.frameId, values);
      }
      for (const [k, views] of nearby) {
        if (views.size < 3 || (cells.get(k)?.size || 0) >= 2) continue;
        const values = [...views.values()].map(v => v.reduce((s, x) => s + x, 0) / v.length).sort((a, b) => a - b);
        const median = values[Math.floor(values.length / 2)],
          spread = values[Math.floor(values.length * .8)] - values[Math.floor(values.length * .2)];
        if (Math.abs(median) > .09 || (Math.abs(median) > .045 && spread < .035)) continue;
        cells.set(k, new Set(views.keys()));
      }
    }
    group.forEach(c => used.add(c));
    planes.push({
      normal: fit.n,
      offset: fit.d,
      kind: seed.kind,
      axes,
      cells,
      cellSize: .12,
      supportingFrameIds: independent.map(c => c.frame.frameId),
      area: supported * .0144
    });
  }
  return planes;
}
export function structuralSupportAt(plane, p, minimum = 2) {
  const x = Math.floor(dot(plane.axes[0], p) / plane.cellSize),
    y = Math.floor(dot(plane.axes[1], p) / plane.cellSize);
  return (plane.cells.get(`${x},${y}`)?.size || 0) >= minimum;
}

// Correct depth along its original camera ray. An orthogonal vertex snap alone
// would change the pixel/point correspondence and stretch its photograph.
// Never turn an empty ray into measured support or change the original arrays.
export function regularizeStructuralDepth(frames, planes, helpers) {
  const diagnostics = {
    planes: planes.map(p => ({
      kind: p.kind,
      normal: p.normal,
      offset: p.offset,
      supportingFrameIds: p.supportingFrameIds,
      area: p.area
    })),
    correctedSamples: 0,
    maxDisplacementMeters: 0,
    frames: []
  };
  const corrected = frames.map(frame => {
    const changes = new Map();
    for (const s of samplesFor(frame)) {
      for (const plane of planes) {
        // Walls carry pictures and curtain relief. Their measured geometry is
        // handled by the relief-aware mesh pass; this depth pass is horizontal.
        if (plane.kind === 'wall' || Math.abs(dot(plane.normal, s.n)) < .94 || !structuralSupportAt(plane, s.p)) continue;
        const residual = dot(plane.normal, s.p) - plane.offset;
        if (Math.abs(residual) > (plane.kind === 'floor' ? .2 : .26)) continue;
        const ray = sub(s.p, Array.from(frame.camera)),
          denominator = dot(plane.normal, ray);
        if (Math.abs(denominator) / length(ray) < .18) continue;
        const scale = (plane.offset - dot(plane.normal, frame.camera)) / denominator;
        const depth = frame.filteredDepth[s.i] * scale;
        if (!(scale > .75 && scale < 1.25)) continue;
        const p = helpers.unproject(frame, s.i, depth),
          movement = length(sub(p, s.p));
        if (movement > .28) continue;
        // A sharp local depth step may be a real riser, beam or fixture.
        const w = frame.columns,
          neighborhood = [s.i - 2, s.i + 2, s.i - 2 * w, s.i + 2 * w];
        if (neighborhood.some(i => frame.measuredMask[i] && Math.abs(dot(plane.normal, at(frame, i)) - dot(plane.normal, s.p)) > .075)) continue;
        changes.set(s.i, {
          depth,
          p,
          movement
        });
        break;
      }
    }
    if (!changes.size) return frame;
    const result = {
      ...frame,
      positions: frame.positions.slice(),
      filteredDepth: frame.filteredDepth.slice(),
      depthConfidence: frame.depthConfidence.slice(),
      freeSpaceMask: frame.freeSpaceMask.slice(),
      originalFilteredDepth: frame.originalFilteredDepth || frame.filteredDepth
    };
    result.originalPositions = frame.originalPositions || frame.positions;
    for (const [i, change] of changes) {
      result.filteredDepth[i] = change.depth;
      result.positions.set(change.p, i * 3);
      // Adjusted geometry cannot claim that the original ray measured free space.
      if (change.movement > .015) {
        result.freeSpaceMask[i] = 0;
        result.depthConfidence[i] = Math.min(result.depthConfidence[i], 180);
      }
      diagnostics.maxDisplacementMeters = Math.max(diagnostics.maxDisplacementMeters, change.movement);
    }
    diagnostics.correctedSamples += changes.size;
    diagnostics.frames.push({
      frameId: frame.frameId,
      correctedSamples: changes.size
    });
    return result;
  });
  return {
    frames: corrected,
    diagnostics
  };
}
