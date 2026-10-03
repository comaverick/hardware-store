// A small missing-depth patch may be estimated from its closed planar rim and
// matching photographs. A missing-depth estimate cannot override an observed
// foreground object or reliable free-space reading.
import { independentFrameIds } from './structuralDepth';

const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function createColorGapRepair(frames, { project, projectColor, sampleColor }, { maximumDiameter = .3 } = {}) {
  const byId = new Map(frames.map(frame => [frame.frameId, frame]));
  const photoById = new Map(frames.map(frame => [frame.frameId, {
    ...frame, camera: frame.viewTransformMatrix?.length === 16
      ? Array.from(frame.viewTransformMatrix).slice(12, 15) : frame.camera,
  }]));
  const count = ids => independentFrameIds(ids, byId, .06).size;
  const rimCache = new WeakMap();
  const observedDepth = (frame, index, plane) => {
    const repaired = plane?.ceilingRecoveryId && frame.ceilingRepairMask?.[index] === plane.ceilingRecoveryId;
    return (repaired ? frame.filteredDepth : frame.originalFilteredDepth || frame.filteredDepth)?.[index];
  };
  const depthEvidence = (frame, p, plane) => {
    const uv = project(frame, ...p);
    if (!uv) return null;
    const x = Math.floor(uv.u * frame.columns), y = Math.floor(uv.v * frame.rows);
    if (x < 0 || y < 0 || x >= frame.columns || y >= frame.rows) return null;
    const index = y * frame.columns + x;
    if (!frame.measuredMask?.[index]) return null;
    const depth = observedDepth(frame, index, plane);
    if (!(depth > 0)) return null;
    return { difference: depth - uv.depth,
      reliable: (frame.depthConfidence?.[index] ?? 255) >= 140 && !!(frame.freeSpaceMask?.[index] ?? 1) };
  };
  const coloredRims = (rim, plane) => {
    if (rimCache.has(rim)) return rimCache.get(rim);
    const samples = rim.filter((_, index) => index % Math.max(1, Math.ceil(rim.length / 24)) === 0);
    const result = [];
    for (const frame of frames) {
      if (!frame.colorImage?.length) continue;
      const colors = [], measured = [];
      for (const p of samples) {
        const uv = projectColor(frame, ...p);
        const color = uv && sampleColor(frame, uv);
        if (!color) break;
        colors.push(color);
        const depth = depthEvidence(frame, p, plane);
        if (depth && Math.abs(depth.difference) < .08) measured.push(p);
      }
      if (colors.length !== samples.length || measured.length < 3 || measured.length < samples.length * .5) continue;
      const palette = [0, 1, 2].map(axis => median(colors.map(color => color[axis])));
      const scatter = median(colors.map(color => distance(color, palette)));
      // Complex or sharply divided surroundings are not a solid surface color.
      if (scatter > 32) continue;
      result.push({ frame, palette, tolerance: Math.max(25, Math.min(45, scatter * 2)) });
    }
    rimCache.set(rim, result);
    return result;
  };
  return (p, rim, context = {}) => {
    const agrees = [], conflicts = [];
    let trustedConflict = false;
    for (const frame of frames) {
      const depth = depthEvidence(frame, p, context.plane);
      if (!depth) continue;
      if (Math.abs(depth.difference) < .05) agrees.push(frame.frameId);
      else if (Math.abs(depth.difference) > .09) {
        conflicts.push(frame.frameId);
        // A closer object is still an obstruction when its ray cannot claim
        // empty space. A farther reading needs the existing reliable-ray check.
        if (depth.difference < 0 || depth.reliable) trustedConflict = true;
      }
    }
    const support = count(agrees), contradiction = count(conflicts);
    if (support >= 2 && (!contradiction || (support >= 3 && contradiction / (support + contradiction) < .1))) return true;
    if (trustedConflict || contradiction || !(context.diameter <= maximumDiameter) || !context.plane || !rim?.length) return false;
    const colors = coloredRims(rim, context.plane), witnesses = [];
    for (const { frame, palette, tolerance } of colors) {
      const uv = projectColor(frame, ...p), color = uv && sampleColor(frame, uv);
      if (color && distance(color, palette) <= tolerance) witnesses.push(frame.frameId);
    }
    return independentFrameIds(witnesses, photoById, .06).size >= 2 ? 'surrounding-colors' : false;
  };
}
