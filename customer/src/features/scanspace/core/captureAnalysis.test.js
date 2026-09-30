import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { createRgbdKeyframe } from "./fusion";
import { unprojectDepth } from "./depth";
import { CaptureAnalysisController, CaptureAnalysisStore, copyAnalysisFrame } from "./captureAnalysis";
import { captureSurfaceForFrame, observedCaptureSurfaces } from "./captureSurfaces";

function planeFrame(id, x, { n = [0, 0, 1], d = -2, pitch = 0 } = {}) {
  const camera = new PerspectiveCamera(65, 1, 0.1, 20);
  const matrix = new Matrix4().makeRotationX(pitch).setPosition(x, 1.5, 0);
  const view = { projectionMatrix: camera.projectionMatrix.elements, transform: { matrix: matrix.elements } };
  const depth = { getDepthInMeters: (u, v) => {
    const ray = new Vector3((u * 2 - 1) / view.projectionMatrix[0], (1 - v * 2) / view.projectionMatrix[5], -1);
    const m = matrix.elements;
    const world = [m[0] * ray.x + m[4] * ray.y + m[8] * ray.z,
      m[1] * ray.x + m[5] * ray.y + m[9] * ray.z, m[2] * ray.x + m[6] * ray.y + m[10] * ray.z];
    return (d - n[0] * x - n[1] * 1.5) / world.reduce((sum, value, axis) => sum + value * n[axis], 0);
  } };
  const frame = createRgbdKeyframe(unprojectDepth(depth, view, 32, 32), {
    columns: 32, rows: 32, timestamp: id * 300, projectionMatrix: view.projectionMatrix,
    transformMatrix: matrix.elements, camera: { x, y: 1.5, z: 0 }, depthType: "raw",
  });
  frame.captureId = id;
  return frame;
}

const wallFrames = () => [planeFrame(1, 0), planeFrame(2, 0.08), planeFrame(3, 0.16)];
const worker = () => ({ postMessage: jest.fn(), terminate: jest.fn() });

test("three translated views check only the measured part of a wall", () => {
  const frames = wallFrames(), surfaces = observedCaptureSurfaces(frames, 0);
  expect(surfaces).toHaveLength(1);
  expect(surfaces[0]).toMatchObject({ kind: "wall", views: 3 });
  expect(captureSurfaceForFrame(frames[1], surfaces)).toMatchObject({ kind: "wall" });
  expect(captureSurfaceForFrame(planeFrame(4, 4), surfaces)).toBeNull();
  expect(captureSurfaceForFrame(planeFrame(4, 0.16, { d: -1.5 }), surfaces)).toBeNull();
});

test("stationary observations and a shifted third layer cannot complete a surface", () => {
  expect(observedCaptureSurfaces([planeFrame(1, 0), planeFrame(2, 0), planeFrame(3, 0)], 0)).toEqual([]);
  expect(observedCaptureSurfaces([planeFrame(1, 0), planeFrame(2, 0.08), planeFrame(3, 0.16, { d: -2.25 })], 0)).toEqual([]);
});

test("horizontal furniture is not classified as a ceiling and floor needs a known floor height", () => {
  const table = [1, 2, 3].map(id => planeFrame(id, (id - 1) * 0.08, { n: [0, 1, 0], d: 0.8, pitch: -0.65 }));
  expect(observedCaptureSurfaces(table, 0)).toEqual([]);
  const floor = [1, 2, 3].map(id => planeFrame(id, (id - 1) * 0.08, { n: [0, 1, 0], d: 0, pitch: -0.65 }));
  expect(observedCaptureSurfaces(floor, null)).toEqual([]);
  expect(observedCaptureSurfaces(floor, 0)[0]?.kind).toBe("floor");
});

test("worker patches retain unchanged views and remove evicted geometry", () => {
  const frames = wallFrames(), store = new CaptureAnalysisStore();
  const first = store.analyze({ ids: [1, 2, 3], changed: frames.map(copyAnalysisFrame), floorY: 0 });
  expect(first.coverage.confirmed).toBeGreaterThan(0);
  expect(first.surfaces).toHaveLength(1);
  const retained = store.frames.get(2);
  const next = planeFrame(4, 0.24);
  store.analyze({ ids: [2, 3, 4], changed: [copyAnalysisFrame(next)], floorY: 0 });
  expect(store.frames.size).toBe(3);
  expect(store.frames.has(1)).toBe(false);
  expect(store.frames.get(2)).toBe(retained);
  expect(() => store.analyze({ ids: Array.from({ length: 61 }, (_, i) => i), changed: [], floorY: 0 })).toThrow(/size/);
});

test("live analysis owns copies of geometry and never sends camera images", () => {
  const frames = wallFrames(), target = worker();
  frames[0].colorImage = new Uint8Array([100, 100, 100, 255]);
  const controller = new CaptureAnalysisController(target, jest.fn(), jest.fn());
  controller.request(frames, 0);
  const [job, transfer] = target.postMessage.mock.calls[0];
  expect(job.changed[0].positions).not.toBe(frames[0].positions);
  expect(job.changed[0].colorImage).toBeUndefined();
  expect(transfer).not.toContain(frames[0].positions.buffer);
  expect(frames[0].positions.length).toBe(32 * 32 * 3);
  controller.close();
});

test("one in-flight job coalesces a burst into the latest view set", () => {
  const frames = wallFrames(), target = worker(), results = jest.fn();
  const controller = new CaptureAnalysisController(target, results, jest.fn());
  controller.request(frames, 0);
  for (let id = 4; id <= 30; id++) controller.request([...frames, planeFrame(id, 0.24)], 0);
  expect(target.postMessage).toHaveBeenCalledTimes(1);
  target.onmessage({ data: { type: "analysis", revision: 1, result: { coverage: {}, surfaces: [] } } });
  expect(target.postMessage).toHaveBeenCalledTimes(2);
  const [latest] = target.postMessage.mock.calls[1];
  expect(latest.ids).toEqual([1, 2, 3, 30]);
  expect(latest.changed.map(frame => frame.captureId)).toEqual([30]);
  expect(results).toHaveBeenCalledTimes(1);
  controller.close();
});

test("worker failure releases queued geometry and permits an inline fallback", () => {
  const frames = wallFrames(), target = worker(), results = jest.fn(), failure = jest.fn();
  const controller = new CaptureAnalysisController(target, results, failure);
  controller.request(frames, 0);
  controller.request(frames.slice(1), 0);
  target.onerror();
  expect(failure).toHaveBeenCalledTimes(1);
  expect(target.terminate).toHaveBeenCalledTimes(1);
  expect(controller.sent.size).toBe(0);
  expect(controller.latest).toBeNull();
  target.onmessage({ data: { type: "analysis", revision: 1, result: {} } });
  expect(results).not.toHaveBeenCalled();
});

test("a refreshed depth view is resent even when its capture ID is unchanged", () => {
  const frames = wallFrames(), target = worker();
  const controller = new CaptureAnalysisController(target, jest.fn(), jest.fn());
  controller.request(frames, 0);
  target.onmessage({ data: { type: "analysis", revision: 1, result: {} } });
  const replacement = planeFrame(2, 0.085);
  controller.request([frames[0], replacement, frames[2]], 0);
  expect(target.postMessage.mock.calls[1][0].changed.map(frame => frame.captureId)).toEqual([2]);
  controller.close();
});

test("background connections reuse comparisons and release replaced geometry", () => {
  const compare = jest.fn(() => ({ accepted: true, conflict: false }));
  const store = new CaptureAnalysisStore(compare), frames = wallFrames();
  const job = values => ({ ids: values.map(frame => frame.captureId), changed: values, floorY: 0 });
  const first = store.analyze(job(frames));
  expect(first.checkedIds).toHaveLength(3);
  const calls = compare.mock.calls.length;
  store.analyze(job(frames));
  expect(compare).toHaveBeenCalledTimes(calls);
  const original = frames[1];
  frames[1] = planeFrame(2, 0.09);
  store.analyze(job(frames));
  expect(compare.mock.calls.length).toBeGreaterThan(calls);
  expect([...store.comparisons.values()].some(entry => entry.left === original || entry.right === original)).toBe(false);
  store.analyze(job(frames.slice(1)));
  expect([...store.comparisons.values()].every(entry => [entry.left.captureId, entry.right.captureId]
    .every(id => id !== 1))).toBe(true);
});

test("nearby repeated camera positions do not crowd out an independent comparison pose", () => {
  const frames = [planeFrame(1, 0), ...Array.from({ length: 9 }, (_, index) => planeFrame(index + 2, 0.1))];
  const result = new CaptureAnalysisStore().analyze({ ids: frames.map(frame => frame.captureId), changed: frames, floorY: 0 });
  expect(result.checkedIds).toHaveLength(10);
  expect(result.links[10]).toContain(1);
});
