import { fitPlane } from './planarSurface';
import { MIN_CEILING_PATCH_AREA } from './structuralCriteria';
export const MIN_STRUCTURAL_CELL_VIEWS = 3;
export const MAX_STRUCTURAL_DISPLACEMENT_METERS = 0.05;
export const MIN_STRUCTURAL_CAMERA_BASELINE_METERS = 0.06;
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
const median = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
};
export function independentFrameIds(ids, framesById, minimumBaseline) {
  const frames = [...new Set(ids)].map(id => framesById.get(id))
    .filter(frame => frame?.camera?.length >= 3)
    .sort((a, b) => typeof a.frameId === 'number' && typeof b.frameId === 'number'
      ? a.frameId - b.frameId : String(a.frameId).localeCompare(String(b.frameId)));
  const count = frames.length;
  if (!count) return new Set();
  // Cache distances once. Farthest-first selection gives nearby repeat views
  // no extra vote and is independent of capture/input iteration order.
  const distances = Array.from({ length: count }, () => new Float64Array(count));
  const center = [0, 1, 2].map(axis => frames.reduce((sum, frame) => sum + frame.camera[axis], 0) / count);
  let seed = 0, farthest = -1;
  for (let i = 0; i < count; i++) {
    const distance = length(sub(Array.from(frames[i].camera), center));
    if (distance > farthest) { seed = i; farthest = distance; }
    for (let j = 0; j < i; j++)
      distances[i][j] = distances[j][i] = cameraDistance(frames[i], frames[j]);
  }
  const extend = selected => {
    const remaining = new Set(Array.from({ length: count }, (_, i) => i)
      .filter(i => !selected.includes(i)));
    const nearest = new Float64Array(count).fill(Infinity);
    for (const i of remaining) for (const j of selected)
      nearest[i] = Math.min(nearest[i], distances[i][j]);
    while (remaining.size) {
      let next = -1, separation = -1;
      for (const i of remaining) if (nearest[i] >= minimumBaseline && nearest[i] > separation) {
        next = i; separation = nearest[i];
      }
      if (next < 0) break;
      selected.push(next); remaining.delete(next);
      for (const i of remaining) nearest[i] = Math.min(nearest[i], distances[i][next]);
    }
    return selected;
  };
  let independent = extend([seed]);
  if (independent.length < 3 && count >= 3) {
    // A central camera can block three mutually translated views. Search only
    // for the required three-view witness, then resume the bounded greedy pass;
    // never attempt to solve the full maximum-independent-set problem.
    findThree: for (let i = 0; i < count - 2; i++) for (let j = i + 1; j < count - 1; j++) {
      if (distances[i][j] < minimumBaseline) continue;
      for (let k = j + 1; k < count; k++) if (distances[i][k] >= minimumBaseline && distances[j][k] >= minimumBaseline) {
        independent = extend([i, j, k]);
        break findThree;
      }
    }
  }
  return new Set(independent.map(i => frames[i].frameId));
}
function samplesFor(frame, maximumSamples = Infinity) {
  const samples = [],
    w = frame.columns,
    h = frame.rows,
    stride = Math.max(1, Math.ceil(Math.sqrt(w * h / maximumSamples)));
  for (let y = 2; y < h - 2; y += stride) for (let x = 2; x < w - 2; x += stride) {
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

// A wall footprint can include a shallow picture or curtain ridge. Repeated
// offsets in the same cell are measured relief, even when they fit inside the
// plane's noise band. Each translated camera gets one vote, regardless of how
// many pixels it contributes. These cells remain available as measured data
// but cannot authorize snapping a later mesh onto the background wall.
function wallReliefCells(frames, plane, axes, cells, minimumViews, minimumBaseline) {
  const observations = new Map(), framesById = new Map(frames.map(frame => [frame.frameId, frame]));
  for (const frame of frames) for (const sample of samplesFor(frame, 1800)) {
    const residual = dot(plane.n, sample.p) - plane.d;
    if (Math.abs(residual) > .065 || Math.abs(dot(plane.n, sample.n)) < .55) continue;
    const key = axes.map(axis => Math.floor(dot(axis, sample.p) / .12)).join(',');
    if (!cells.has(key)) continue;
    if (!observations.has(key)) observations.set(key, new Map());
    const views = observations.get(key), values = views.get(frame.frameId) || [];
    values.push(residual);
    views.set(frame.frameId, values);
  }
  const relief = new Set();
  for (const [key, views] of observations) {
    const ids = independentFrameIds(views.keys(), framesById, minimumBaseline);
    if (ids.size < Math.max(3, minimumViews)) continue;
    const offsets = [...ids].map(id => median(views.get(id))), center = median(offsets);
    const scatter = 1.4826 * median(offsets.map(value => Math.abs(value - center)));
    if (Math.abs(center) < .014 || scatter > .008 || Math.abs(center) < scatter * 2) continue;
    if (offsets.filter(value => value * center > 0 && Math.abs(value - center) <= .012).length >= Math.ceil(offsets.length * .7))
      relief.add(key);
  }
  return relief;
}

// Per-view fits must explain a broad patch, not just a ribbon on a curtain or
// the top of a desk. Consensus is then required from translated camera poses.
function fitStructuralPlane(records, seed, kind) {
  if (kind !== 'wall') return fitPlane(records, seed);
  // WebXR's Y axis is gravity-aligned. A vertical structural wall has a
  // horizontal normal; allowing a height slope turns opposing depth bias into
  // two intersecting copies of the same wall. Preserve its measured yaw.
  let weight = 0, x = 0, z = 0;
  for (const r of records) { weight += r.area; x += r.center[0] * r.area; z += r.center[2] * r.area; }
  x /= weight; z /= weight;
  let xx = 0, zz = 0, xz = 0;
  for (const r of records) {
    const dx = r.center[0] - x, dz = r.center[2] - z;
    xx += dx * dx * r.area; zz += dz * dz * r.area; xz += dx * dz * r.area;
  }
  const angle = .5 * Math.atan2(2 * xz, xx - zz);
  let n = [-Math.sin(angle), 0, Math.cos(angle)];
  if (dot(n, seed.n) < 0) n = n.map(v => -v);
  return { n, d: n[0] * x + n[2] * z };
}

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
    const n = canonical(unit(kind === 'wall' ? [q[2] - p[2], 0, p[0] - q[0]] : normal));
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
    const fitted = fitStructuralPlane(records, best, kind);
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
    axes, footprint: cells,
    area: cells.size * .0144
  };
}
export function discoverStructuralPlanes(frames, {
  floorY = NaN,
  minimumCellViews = MIN_STRUCTURAL_CELL_VIEWS,
  minimumCameraBaseline = MIN_STRUCTURAL_CAMERA_BASELINE_METERS,
} = {}) {
  if (!Number.isFinite(floorY) || frames.length < 3) return [];
  const candidates = [];
  const framesById = new Map(frames.map(frame => [frame.frameId, frame]));
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
  const planeSources = new Map(), planes = [],
    used = new Set();
  for (const seed of candidates.slice().sort((a, b) => b.area - a.area)) {
    if (used.has(seed)) continue;
    const group = candidates.filter(c => {
      if (used.has(c) || c.kind !== seed.kind || dot(c.n, seed.n) <= .993) return false;
      const distance = Math.abs(dot(seed.n, c.inliers[Math.floor(c.inliers.length / 2)].p) - seed.d);
      if (distance < (seed.kind === 'wall' ? .09 : .14)) return true;
      if (seed.kind !== 'wall' || distance >= .18 ||
          (dot(seed.n, c.frame.camera) - seed.d) * (dot(seed.n, seed.frame.camera) - seed.d) <= 0) return false;
      // A second fit through the SAME observed wall footprint is depth bias,
      // not another wall. Disjoint recesses and opposite partition sides must
      // keep their own planes even when their equations are close together.
      let overlap = 0;
      for (const s of c.inliers) {
        const k = seed.axes.map(a => Math.floor(dot(a, s.p) / .12)).join(',');
        if (seed.footprint.has(k)) overlap++;
      }
      return overlap / c.inliers.length >= .6;
    });
    const candidatesById = new Map(group.map(candidate => [candidate.frame.frameId, candidate]));
    const independent = [...independentFrameIds(candidatesById.keys(), framesById, minimumCameraBaseline)]
      .map(id => candidatesById.get(id));
    if (independent.length < Math.max(3, minimumCellViews)) continue;
    const records = independent.flatMap(c => c.inliers.filter((_, i) => i % 3 === 0).map(s => ({
      p: [s.p],
      center: s.p,
      area: 1 / c.inliers.length
    })));
    const fit = fitStructuralPlane(records, seed, seed.kind),
      axes = basis(fit.n),
      cells = new Map();
    for (const c of group) for (const s of c.inliers) {
      if (Math.abs(dot(fit.n, s.p) - fit.d) > .065) continue;
      const key = `${Math.floor(dot(axes[0], s.p) / .12)},${Math.floor(dot(axes[1], s.p) / .12)}`;
      if (!cells.has(key)) cells.set(key, new Set());
      cells.get(key).add(c.frame.frameId);
    }
    for (const [key, ids] of cells)
      cells.set(key, independentFrameIds(ids, framesById, minimumCameraBaseline));
    const supported = [...cells.values()].filter(ids => ids.size >= minimumCellViews).length;
    // Partial captures often include only a ceiling corner. Its observed
    // footprint can be smaller than a wall/floor while still spanning three
    // independent camera positions; never extrapolate beyond these cells.
    if (supported * .0144 < (seed.kind === 'ceiling' ? MIN_CEILING_PATCH_AREA : .65)) continue;
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
        const independentIds = independentFrameIds(views.keys(), framesById, minimumCameraBaseline);
        if (independentIds.size < minimumCellViews || (cells.get(k)?.size || 0) >= minimumCellViews) continue;
        const values = [...independentIds].map(id => {
          const v = views.get(id);
          return v.reduce((s, x) => s + x, 0) / v.length;
        }).sort((a, b) => a - b);
        const median = values[Math.floor(values.length / 2)],
          spread = values[Math.floor(values.length * .8)] - values[Math.floor(values.length * .2)];
        if (Math.abs(median) > .09 || (Math.abs(median) > .045 && spread < .035)) continue;
        cells.set(k, independentIds);
      }
    }
    group.forEach(c => used.add(c));
    const plane = {
      normal: fit.n,
      offset: fit.d,
      kind: seed.kind,
      axes,
      cells,
      ...(seed.kind === 'wall' ? { reliefCells: wallReliefCells(frames, fit, axes, cells, minimumCellViews, minimumCameraBaseline) } : {}),
      cellSize: .12,
      minimumCellViews,
      supportingFrameIds: independent.map(c => c.frame.frameId),
      area: supported * .0144
    };
    planes.push(plane); planeSources.set(plane, { records, group });
  }
  for (let i = 0; i < planes.length; i++) {
    let a = planes[i];
    if (a.kind !== 'wall') continue;
    for (let j = i+1; j < planes.length; j++) {
      const b = planes[j];
      if (b.kind !== 'wall' || dot(a.normal,b.normal)<.997) continue;
      const referenceNormal = a.normal, referenceOffset = a.offset;
      const side = p => median(p.supportingFrameIds.map(id => dot(referenceNormal,framesById.get(id).camera)-referenceOffset));
      if (side(a)*side(b)<=0) continue;
      let overlap = 0, total = 0; const distances = [];
      for (const [k,ids] of b.cells) {
        if (ids.size<minimumCellViews) continue;
        const [x,y]=k.split(',').map(Number);
        const p=b.normal.map((v,h)=>v*b.offset+b.axes[0][h]*(x+.5)*b.cellSize+b.axes[1][h]*(y+.5)*b.cellSize);
        total++; distances.push(Math.abs(dot(a.normal,p)-a.offset));
        if (structuralSupportAt(a,p,minimumCellViews)) overlap++;
      }
      distances.sort((x,y)=>x-y);
      if (!total || overlap/total<.5 || median(distances)>.14 || distances[Math.floor(distances.length*.9)]>.18) continue;
      const records=[...planeSources.get(a).records,...planeSources.get(b).records];
      const group=[...planeSources.get(a).group,...planeSources.get(b).group];
      const fit=fitStructuralPlane(records,{n:a.normal,d:a.offset},'wall'), axes=basis(fit.n), cells=new Map();
      for (const c of group) for (const s of c.inliers) {
        if (Math.abs(dot(fit.n,s.p)-fit.d)>.1) continue;
        const k=axes.map(axis=>Math.floor(dot(axis,s.p)/.12)).join(',');
        if (!cells.has(k)) cells.set(k,new Set());
        cells.get(k).add(c.frame.frameId);
      }
      for (const [k,ids] of cells) cells.set(k,independentFrameIds(ids,framesById,minimumCameraBaseline));
      a={...a,normal:fit.n,offset:fit.d,axes,cells,
        supportingFrameIds:[...independentFrameIds(group.map(c=>c.frame.frameId),framesById,minimumCameraBaseline)],
        reliefCells:wallReliefCells(frames,fit,axes,cells,minimumCellViews,minimumCameraBaseline),
        area:[...cells.values()].filter(ids=>ids.size>=minimumCellViews).length*.0144};
      planes[i]=a; planeSources.set(a,{records,group}); planes.splice(j--,1);
    }
  }
  return planes;
}
export function structuralSupportAt(plane, p, minimum = MIN_STRUCTURAL_CELL_VIEWS) {
  const x = Math.floor(dot(plane.axes[0], p) / plane.cellSize),
    y = Math.floor(dot(plane.axes[1], p) / plane.cellSize);
  return (plane.cells.get(`${x},${y}`)?.size || 0) >= minimum;
}

// Correct depth along its original camera ray. An orthogonal vertex snap alone
// would change the pixel/point correspondence and stretch its photograph.
// Never turn an empty ray into measured support or change the original arrays.
export function regularizeStructuralDepth(frames, planes, helpers, {
  maximumDisplacementMeters = MAX_STRUCTURAL_DISPLACEMENT_METERS,
  minimumCellViews = MIN_STRUCTURAL_CELL_VIEWS,
} = {}) {
  const displacementLimit = Math.max(
    0,
    Math.min(
      MAX_STRUCTURAL_DISPLACEMENT_METERS,
      Number(maximumDisplacementMeters) || MAX_STRUCTURAL_DISPLACEMENT_METERS,
    ),
  );
  const diagnostics = {
    planes: planes.map(p => ({
      kind: p.kind,
      normal: p.normal,
      offset: p.offset,
      supportingFrameIds: p.supportingFrameIds,
      protectedReliefCells: p.reliefCells?.size || 0,
      area: p.area
    })),
    correctedSamples: 0,
    maxDisplacementMeters: 0,
    maximumAllowedDisplacementMeters: displacementLimit,
    minimumCellViews,
    rejectedLargeCorrections: 0,
    frames: []
  };
  const corrected = frames.map(frame => {
    const changes = new Map();
    for (const s of samplesFor(frame)) {
      for (const plane of planes) {
        // Walls carry pictures and curtain relief. Their measured geometry is
        // handled by the relief-aware mesh pass; this depth pass is horizontal.
        if (plane.kind === 'wall' || Math.abs(dot(plane.normal, s.n)) < .94 ||
          !structuralSupportAt(plane, s.p, minimumCellViews)) continue;
        const residual = dot(plane.normal, s.p) - plane.offset;
        if (Math.abs(residual) > displacementLimit) continue;
        const ray = sub(s.p, Array.from(frame.camera)),
          denominator = dot(plane.normal, ray);
        if (Math.abs(denominator) / length(ray) < .18) continue;
        const scale = (plane.offset - dot(plane.normal, frame.camera)) / denominator;
        const depth = frame.filteredDepth[s.i] * scale;
        if (!(scale > .75 && scale < 1.25)) continue;
        const p = helpers.unproject(frame, s.i, depth),
          movement = length(sub(p, s.p));
        if (movement > displacementLimit) {
          diagnostics.rejectedLargeCorrections++;
          continue;
        }
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
