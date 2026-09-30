import { prepareCaptureFrame } from "./adaptiveCapture";

const CELL_SIZE = 0.24;
const MIN_BASELINE = 0.06;
const MAX_SURFACES = 24;
const MAX_CELLS = 1024;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const distance = (a, b) => Math.hypot(...subtract(a, b));
const unit = value => value.map(component => component / Math.hypot(...value));
const pointAt = (frame, index) => Array.from(frame.positions.subarray(index * 3, index * 3 + 3));
const cellKey = (surface, point) => `${Math.floor(dot(surface.u, point) / CELL_SIZE)},${Math.floor(dot(surface.v, point) / CELL_SIZE)}`;
const cellSets = new WeakMap();

function normalAt(view, index) {
  const neighbors = [index, index + 1, index + view.columns];
  if (index % view.columns === view.columns - 1 || neighbors.some(i => !view.measuredMask[i])) return null;
  const p = pointAt(view, index), a = subtract(pointAt(view, index + 1), p), b = subtract(pointAt(view, index + view.columns), p);
  if (Math.hypot(...a) > 0.2 || Math.hypot(...b) > 0.2) return null;
  const normal = cross(a, b);
  if (Math.hypot(...normal) < 1e-7) return null;
  const n = unit(normal), axis = n.reduce((best, value, i) => Math.abs(value) > Math.abs(n[best]) ? i : best, 0);
  return n[axis] < 0 ? n.map(value => -value) : n;
}

function surfaceKind(n, p, floorY) {
  if (Math.abs(n[1]) < 0.12) return "wall";
  if (Math.abs(n[1]) < 0.97 || !Number.isFinite(floorY)) return null;
  if (Math.abs(p[1] - floorY) <= 0.25) return "floor";
  return p[1] - floorY >= 1.9 ? "ceiling" : null;
}

// This is a small capture-time model, not a replacement for reconstruction.
// Only measured cells supported by three translated views become checked;
// plane rectangles and unseen gaps are never painted as captured geometry.
export function observedCaptureSurfaces(frames, floorY) {
  const surfaces = [];
  for (const frame of frames) {
    const view = prepareCaptureFrame(frame), samples = [];
    const stride = Math.max(1, Math.ceil(view.filteredDepth.length / 192));
    for (let i = 0; i < view.filteredDepth.length; i += stride) {
      if (!view.measuredMask[i]) continue;
      const n = normalAt(view, i);
      if (n) samples.push({ p: pointAt(view, i), n });
    }
    if (samples.length < 24) continue;
    const candidates = [];
    const seedStride = Math.max(1, Math.floor(samples.length / 16));
    for (let i = 0; i < samples.length; i += seedStride) {
      const seed = samples[i], kind = surfaceKind(seed.n, seed.p, floorY);
      if (!kind) continue;
      const d = dot(seed.n, seed.p);
      if (candidates.some(candidate => dot(candidate.n, seed.n) > 0.995 && Math.abs(dot(candidate.n, seed.p) - candidate.d) < 0.04)) continue;
      const inliers = samples.filter(sample => dot(seed.n, sample.n) > 0.97 && Math.abs(dot(seed.n, sample.p) - d) <= 0.035);
      if (inliers.length < Math.max(24, samples.length * 0.25)) continue;
      const u = unit(cross(seed.n, Math.abs(seed.n[1]) < 0.8 ? [0, 1, 0] : [1, 0, 0])), v = cross(seed.n, u);
      const x = inliers.map(sample => dot(u, sample.p)), y = inliers.map(sample => dot(v, sample.p));
      if ((Math.max(...x) - Math.min(...x)) * (Math.max(...y) - Math.min(...y)) < 0.4) continue;
      candidates.push({ n: seed.n, d, kind, u, v, inliers });
    }
    for (const candidate of candidates.sort((a, b) => b.inliers.length - a.inliers.length).slice(0, 3)) {
      let surface = surfaces.find(value => value.kind === candidate.kind && dot(value.n, candidate.n) > 0.995 &&
        Math.abs(dot(value.n, candidate.inliers[0].p) - value.d) <= 0.045);
      if (!surface) {
        if (surfaces.length >= MAX_SURFACES) continue;
        surface = { ...candidate, inliers: undefined, cameras: [], cells: new Map() };
        surfaces.push(surface);
      }
      const camera = Array.from(frame.camera);
      if (surface.cameras.every(other => distance(camera, other) >= MIN_BASELINE)) surface.cameras.push(camera);
      const seen = new Set();
      for (const sample of candidate.inliers) {
        const key = cellKey(surface, sample.p);
        if (seen.has(key)) continue;
        seen.add(key);
        let observers = surface.cells.get(key);
        if (!observers) {
          if (surface.cells.size >= MAX_CELLS) continue;
          observers = [];
          surface.cells.set(key, observers);
        }
        if (observers.length < 3 && observers.every(other => distance(camera, other) >= MIN_BASELINE)) observers.push(camera);
      }
    }
  }
  return surfaces.filter(surface => surface.cameras.length >= 3).map(surface => ({
    n: surface.n, d: surface.d, u: surface.u, v: surface.v, kind: surface.kind,
    views: surface.cameras.length,
    cells: [...surface.cells].filter(([, observers]) => observers.length >= 3).map(([key]) => key),
  })).filter(surface => surface.cells.length >= 8);
}

export function captureSurfaceForFrame(frame, surfaces = []) {
  if (!surfaces.length) return null;
  const view = prepareCaptureFrame(frame), stride = Math.max(1, Math.ceil(view.filteredDepth.length / 192));
  let measured = 0;
  const support = new Map();
  for (let index = 0; index < view.filteredDepth.length; index += stride) {
    if (!view.measuredMask[index]) continue;
    measured++;
    const point = pointAt(view, index);
    for (const surface of surfaces) {
      if (Math.abs(dot(surface.n, point) - surface.d) > 0.04) continue;
      if (!cellSets.has(surface)) cellSets.set(surface, new Set(surface.cells));
      if (!cellSets.get(surface).has(cellKey(surface, point))) continue;
      support.set(surface, (support.get(surface) || 0) + 1);
      break;
    }
  }
  const [surface, count = 0] = [...support].sort((a, b) => b[1] - a[1])[0] || [];
  return surface && measured >= 24 && count / measured >= 0.85
    ? { kind: surface.kind, views: surface.views, measuredRatio: count / measured } : null;
}
