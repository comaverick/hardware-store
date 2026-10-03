// Recover a photographed ceiling patch when translated measured depth views
// disagree. This runs after capture, before fusion and camera texturing.
// Ownership stays inside a continuous photographed region; fixtures, trim,
// missing rays, and independently consistent alternate heights remain measured.
import { independentFrameIds } from './structuralDepth';
import { MIN_CEILING_PATCH_AREA } from './structuralCriteria';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(...a);
const unit = a => {
  const l = length(a) || 1;
  return a.map(v => v / l);
};
const median = a => {
  const s = a.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 0;
};
const at = (a, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
const lum = a => (a[0] + a[1] + a[2]) / 3;
const chroma = a => {
  const l = lum(a) || 1;
  return a.map(v => v / l * 128);
};
export function repairCeilingRegions(frames = [], planes = [], helpers = {}, {
  maximumMovement = .72,
  minimumNormalY = .3
} = {}) {
  const project = helpers?.project;
  const requestedMovement = Number(maximumMovement);
  const cap = Math.min(.72, Math.max(0, Number.isFinite(requestedMovement) ? requestedMovement : .72));
  const requestedNormal = Number(minimumNormalY);
  const normalMinimum = Math.min(1, Math.max(.3, Number.isFinite(requestedNormal) ? requestedNormal : .3));
  const diagnostics = {
    mode: 'model-based-ceiling-ray-repair',
    maximumAllowedDisplacementMeters: cap,
    minimumNormalY: normalMinimum,
    correctedSamples: 0,
    maxDisplacementMeters: 0,
    maxVerticalChangeMeters: 0,
    planes: []
  };
  const unchanged = reason => ({
    frames,
    planes,
    diagnostics: {
      ...diagnostics,
      reason
    }
  });
  if (typeof project !== 'function') return unchanged('missing-projection-helper');
  if (!Array.isArray(frames) || frames.length < 3) return unchanged('insufficient-frames');
  if (!cap) return unchanged('disabled');
  const validVector = value => value?.length === 3 &&
    Array.from(value).every(Number.isFinite) && length(value) > .9 && length(value) < 1.1;
  const supportedCeilings = Array.isArray(planes) ? planes.filter(plane =>
    plane?.kind === 'ceiling' && Number.isFinite(plane.area) &&
    plane.area >= MIN_CEILING_PATCH_AREA && Array.isArray(plane.supportingFrameIds) &&
    new Set(plane.supportingFrameIds).size >= 3 && validVector(plane.normal) &&
    Math.abs(plane.normal[1]) >= .9 && Number.isFinite(plane.offset) &&
    plane.axes?.length === 2 && plane.axes.every(validVector) && plane.cells instanceof Map &&
    (plane.cellSize === undefined || (Number.isFinite(plane.cellSize) && plane.cellSize > 0))
  ) : [];
  if (!supportedCeilings.length) return unchanged('insufficient-supported-ceiling');
  let result = frames;
  const repairedPlanes = planes.slice();
  for (const plane of supportedCeilings) {
    const planeIndex = planes.indexOf(plane),
      recoveryId = planeIndex + 1;
    const size = plane.cellSize || .12;
    const cell = p => plane.axes.map(a => Math.floor(dot(a, p) / size)).join(',');
    const byId = new Map(result.map(f => [f.frameId, f]));
    const independent = ids => [...independentFrameIds(ids, byId, .06)];
    const descriptors = result.map(frame => {
      const positions = frame.originalPositions || frame.positions,
        depths = frame.originalFilteredDepth || frame.filteredDepth;
      const count = depths.length,
        normals = new Float32Array(count * 3),
        residual = new Float32Array(count);
      const colors = new Uint8Array(count * 3),
        colorMask = new Uint8Array(count);
      const colorView = {
        ...frame,
        projectionMatrix: frame.viewProjectionMatrix || frame.projectionMatrix,
        transformMatrix: frame.viewTransformMatrix || frame.transformMatrix
      };
      const readColor = uv => {
        const x = Math.max(0, Math.min(frame.colorWidth - 1, Math.round(uv.u * (frame.colorWidth - 1))));
        const y = Math.max(0, Math.min(frame.colorHeight - 1, Math.round((1 - uv.v) * (frame.colorHeight - 1))));
        const k = (y * frame.colorWidth + x) * (frame.colorChannels || 4);
        return Array.from(frame.colorImage.subarray(k, k + 3));
      };
      for (let i = 0; i < count; i++) {
        const p = at(positions, i);
        residual[i] = dot(plane.normal, p) - plane.offset;
        if (!depths[i] || !frame.measuredMask[i]) continue;
        const x = i % frame.columns,
          y = Math.floor(i / frame.columns),
          w = frame.columns;
        if (x > 0 && x < w - 1 && y > 0 && y < frame.rows - 1 &&
            [i - 1, i + 1, i - w, i + w].every(k => frame.measuredMask[k] && depths[k])) {
          normals.set(unit(cross(
            sub(at(positions, i + 1), at(positions, i - 1)),
            sub(at(positions, i + w), at(positions, i - w))
          )), i * 3);
        }
        if (frame.colorImage?.length && frame.colorWidth && frame.colorHeight) {
          const uv = project(colorView, ...p);
          if (uv) {
            colors.set(readColor(uv), i * 3);
            colorMask[i] = 1;
          }
        } else if (frame.colorMask?.[i]) {
          colors.set(frame.colors.subarray(i * 3, i * 3 + 3), i * 3);
          colorMask[i] = 1;
        }
      }
      return {
        frame,
        positions,
        depths,
        normals,
        residual,
        colors,
        colorMask,
        colorView,
        readColor,
        count,
        mask: new Uint8Array(count)
      };
    });
    // Start inside the original supported plane, then follow its photographed
    // material. Normalize hue so a ceiling shadow does not split the patch.
    const anchors = [];
    for (const d of descriptors.filter(d => plane.supportingFrameIds.includes(d.frame.frameId))) {
      for (let i = 0; i < d.count; i++) {
        if (d.frame.measuredMask[i] && d.colorMask[i] && Math.abs(d.residual[i]) <= .05 &&
            Math.abs(dot(plane.normal, at(d.normals, i))) > .9 &&
            (plane.cells.get(cell(at(d.positions, i)))?.size || 0) >= 3) {
          anchors.push(at(d.colors, i));
        }
      }
    }
    const detail = {
      kind: 'ceiling',
      anchorColorSamples: anchors.length,
      masks: [],
      supportedCells: 0,
      disagreementCells: 0,
      stableOffsetCells: 0,
      correctedSamples: 0,
      maxDisplacementMeters: 0,
      maxVerticalChangeMeters: 0
    };
    if (!anchors.length) {
      detail.reason = 'no-independent-colored-anchor';
      diagnostics.planes.push(detail);
      continue;
    }
    const palette = [0, 1, 2].map(a => median(anchors.map(c => c[a]))),
      paletteChroma = chroma(palette),
      paletteLum = lum(palette);
    const colorEligible = c => lum(c) > paletteLum * .55 && lum(c) < paletteLum * 1.5 &&
      length(sub(chroma(c), paletteChroma)) <= 15;
    detail.palette = palette;
    for (const d of descriptors.filter(d => d.colorMask.some(Boolean))) {
      const f = d.frame,
        queue = [];
      const valid = i => i >= 0 && i < d.count && d.depths[i] && f.measuredMask[i] &&
        d.colorMask[i] && at(d.positions, i)[1] > 1.9 && Math.abs(d.residual[i]) < .6 &&
        Math.abs(d.normals[i * 3 + 1]) >= normalMinimum;
      for (let i = 0; i < d.count; i++) if (valid(i) && Math.abs(d.residual[i]) <= .05 &&
        Math.abs(dot(plane.normal, at(d.normals, i))) > .9 &&
        length(sub(at(d.colors, i), palette)) <= 45 &&
        (plane.cells.get(cell(at(d.positions, i)))?.size || 0) >= 3) {
        d.mask[i] = 1;
        queue.push(i);
      }
      const seedCount = queue.length;
      const crossesColorBoundary = (i, j) => {
        if (!f.colorImage?.length) return false;
        const a = project(d.colorView, ...at(d.positions, i)),
          b = project(d.colorView, ...at(d.positions, j));
        if (!a || !b) return true;
        const start = at(d.colors, i),
          end = at(d.colors, j);
        for (let t = 1; t < 8; t++) {
          const color = d.readColor({
            u: a.u + (b.u - a.u) * t / 8,
            v: a.v + (b.v - a.v) * t / 8
          });
          const expected = start.map((value, k) => value + (end[k] - value) * t / 8);
          if (!colorEligible(color) || length(sub(color, expected)) > 45) return true;
        }
        return false;
      };
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q],
          x = i % f.columns,
          y = Math.floor(i / f.columns);
        for (const j of [x ? i - 1 : -1, x < f.columns - 1 ? i + 1 : -1, y ? i - f.columns : -1, y < f.rows - 1 ? i + f.columns : -1]) {
          if (d.mask[j] || !valid(j) || Math.abs(d.residual[j] - d.residual[i]) > .12 ||
              Math.abs(dot(at(d.normals, i), at(d.normals, j))) < .5 ||
              length(sub(at(d.colors, j), at(d.colors, i))) > 35 ||
              !colorEligible(at(d.colors, j)) || crossesColorBoundary(i, j)) continue;
          d.mask[j] = 1;
          queue.push(j);
        }
      }
      detail.masks.push({
        frameId: f.frameId,
        seeds: seedCount,
        pixels: queue.length,
        highResolution: !!f.colorImage?.length
      });
    }
    // Require exact source and proposed image ownership in translated cameras.
    // A broad cell that contains a light cannot authorize flattening the light.
    const masks = descriptors.filter(d => d.mask.some(Boolean));
    const maskAt = (d, p) => {
      const uv = project(d.frame, ...p);
      if (!uv) return false;
      const x = Math.min(d.frame.columns - 1, Math.floor(uv.u * d.frame.columns)),
        y = Math.min(d.frame.rows - 1, Math.floor(uv.v * d.frame.rows));
      if (!d.mask[y * d.frame.columns + x]) return false;
      if (d.frame.colorImage?.length) {
        const colorUv = project(d.colorView, ...p);
        if (!colorUv || !colorEligible(d.readColor(colorUv))) return false;
      }
      return true;
    };
    const owns = (p, target) => {
      const voters = masks.filter(d => maskAt(d, p) && maskAt(d, target)).map(d => d.frame.frameId);
      return independent(voters).length >= 2;
    };
    const candidates = [],
      cells = new Map();
    for (const d of descriptors) for (let i = 0; i < d.count; i++) {
      const f = d.frame;
      if (!d.depths[i] || !f.measuredMask[i] || Math.abs(d.residual[i]) > .6 || Math.abs(d.normals[i * 3 + 1]) < normalMinimum) continue;
      const p = at(d.positions, i);
      if (p[1] <= 1.9) continue;
      const ray = sub(p, Array.from(f.camera)),
        den = dot(plane.normal, ray),
        rayLength = length(ray);
      if (!rayLength || Math.abs(den) / rayLength < .18) continue;
      const scale = (plane.offset - dot(plane.normal, Array.from(f.camera))) / den;
      if (!(scale > 0)) continue;
      const target = Array.from(f.camera).map((v, a) => v + scale * ray[a]),
        movement = length(sub(target, p));
      if (movement > cap || !owns(p, target)) continue;
      const key = cell(target);
      if (!cells.has(key)) cells.set(key, new Map());
      const views = cells.get(key);
      if (!views.has(f.frameId)) views.set(f.frameId, []);
      views.get(f.frameId).push(d.residual[i]);
      candidates.push({
        d,
        i,
        p,
        target,
        movement,
        scale,
        key,
        residual: d.residual[i]
      });
    }
    // Dense pixels from one camera contribute one median. Stable offsets can
    // be an actual beam or raised tray, even when its paint matches the ceiling.
    const noisy = new Set(),
      noisyEvidence = new Map();
    for (const [key, views] of cells) {
      const ids = independent([...views].filter(([id, values]) => values.length >= 3).map(([id]) => id));
      if (ids.length < 3) continue;
      detail.supportedCells++;
      const offsets = ids.map(id => median(views.get(id))),
        center = median(offsets),
        mad = median(offsets.map(v => Math.abs(v - center)));
      const stable = Math.abs(center) > .045 && mad < .012 &&
        offsets.filter(v => Math.abs(v - center) <= .025).length >= Math.ceil(offsets.length * .7);
      if (stable) {
        detail.stableOffsetCells++;
        continue;
      }
      if (mad >= .025 || Math.max(...offsets) - Math.min(...offsets) >= .06) {
        noisy.add(key);
        noisyEvidence.set(key, new Set(ids));
      }
    }
    detail.disagreementCells = noisy.size;
    detail.disagreementArea = noisy.size * size * size;
    const changes = new Map();
    for (const c of candidates) if (noisy.has(c.key) && c.movement > .001) {
      if (!changes.has(c.d.frame.frameId)) changes.set(c.d.frame.frameId, []);
      changes.get(c.d.frame.frameId).push(c);
    }
    // A model correction retains the original pixel ray and original arrays.
    // Tag it for this ceiling only; it cannot supply a new free-space veto.
    result = result.map(frame => {
      const edits = changes.get(frame.frameId);
      if (!edits?.length) return frame;
      const filteredDepth = frame.filteredDepth.slice(),
        positions = frame.positions.slice(),
        freeSpaceMask = frame.freeSpaceMask?.slice(),
        depthConfidence = frame.depthConfidence?.slice();
      const ceilingRepairMask = frame.ceilingRepairMask?.slice() || new Uint8Array(filteredDepth.length);
      for (const c of edits) {
        filteredDepth[c.i] = c.d.depths[c.i] * c.scale;
        positions.set(c.target, c.i * 3);
        ceilingRepairMask[c.i] = recoveryId;
        if (freeSpaceMask) freeSpaceMask[c.i] = 0;
        if (depthConfidence) depthConfidence[c.i] = Math.min(depthConfidence[c.i], 128);
        detail.correctedSamples++;
        detail.maxDisplacementMeters = Math.max(detail.maxDisplacementMeters, c.movement);
        detail.maxVerticalChangeMeters = Math.max(detail.maxVerticalChangeMeters, Math.abs(c.target[1] - c.p[1]));
      }
      return {
        ...frame,
        filteredDepth,
        positions,
        freeSpaceMask,
        depthConfidence,
        ceilingRepairMask,
        originalFilteredDepth: frame.originalFilteredDepth || frame.filteredDepth,
        originalPositions: frame.originalPositions || frame.positions
      };
    });
    if (noisy.size) {
      const recoveredCells = new Set(noisy),
        recoveredCellViews = new Map([...noisyEvidence].map(([key, ids]) => [key, new Set(ids)]));
      const recoveredFootprint = new Map([...plane.cells].map(([key, ids]) => [key, new Set(ids)]));
      for (const [key, ids] of recoveredCellViews) {
        const combined = new Set([...(recoveredFootprint.get(key) || []), ...ids]);
        recoveredFootprint.set(key, new Set(independent(combined)));
      }
      repairedPlanes[planeIndex] = {
        ...plane,
        cells: recoveredFootprint,
        recoveredCells,
        recoveredCellViews,
        ceilingRecoveryId: recoveryId,
        area: [...recoveredFootprint.values()].filter(ids => ids.size >= (plane.minimumCellViews || 3)).length * size * size
      };
      detail.recoveredCells = recoveredCells.size;
      detail.recoveredFootprintArea = repairedPlanes[planeIndex].area;
      detail.ceilingRecoveryId = recoveryId;
    }
    diagnostics.correctedSamples += detail.correctedSamples;
    diagnostics.maxDisplacementMeters = Math.max(diagnostics.maxDisplacementMeters, detail.maxDisplacementMeters);
    diagnostics.maxVerticalChangeMeters = Math.max(diagnostics.maxVerticalChangeMeters, detail.maxVerticalChangeMeters);
    diagnostics.planes.push(detail);
  }
  return {
    frames: result,
    planes: repairedPlanes,
    diagnostics
  };
}
