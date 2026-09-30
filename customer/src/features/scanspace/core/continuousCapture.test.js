import { Matrix4, PerspectiveCamera } from "three";
import { ContinuousCapture } from "./continuousCapture";
import { CaptureAnalysisStore } from "./captureAnalysis";
import { createRgbdKeyframe, fuseRgbdKeyframes } from "./fusion";
import { unprojectDepth } from "./depth";
import { auditCapture } from "./adaptiveCapture";
import { scanFusionOptions } from "./fusionOptions";
import { serializePartialScan, parsePartialScan } from "./partialScanFile";

const profile = { spacing: 0.055, turn: 0.11 };
function wall(id, x, depth = 2) {
  const camera = new PerspectiveCamera(65, 1, 0.1, 20);
  const view = { projectionMatrix: camera.projectionMatrix.elements,
    transform: { matrix: new Matrix4().makeTranslation(x, 1.5, 0).elements } };
  return createRgbdKeyframe(unprojectDepth({ getDepthInMeters: () => depth }, view, 24, 24), {
    columns: 24, rows: 24, timestamp: id * 300, transformMatrix: view.transform.matrix,
    projectionMatrix: view.projectionMatrix, camera: { x, y: 1.5, z: 0 }, depthType: "smooth",
  });
}
const analyze = (store, capture) => {
  const frames = capture.frames.slice();
  const result = store.analyze({ ids: frames.map(frame => frame.captureId), changed: frames, floorY: 0 });
  capture.applyAnalysis(result, frames);
  return result;
};

test("a failed starting connection never prevents saving a later wall sweep", () => {
  const capture = new ContinuousCapture(), store = new CaptureAnalysisStore();
  for (let id = 1; id <= 12; id++) {
    expect(capture.consider(wall(id, id * 0.08, id <= 2 ? 1.65 : 2), profile).committed).toHaveLength(1);
    expect(capture.frames).toHaveLength(id);
  }
  expect(capture.checkedFrames).toHaveLength(0);
  expect(capture.snapshot()).toMatchObject({ connected: false, pendingCount: 12, captured: 12, state: "tracking" });
  const checked = analyze(store, capture);
  expect(checked.checkedIds).toHaveLength(10);
  expect(checked.groupCount).toBe(2);
  expect(capture.frames).toHaveLength(12);
  expect(capture.frames.slice(0, 2).every(frame => frame.captureStatus === "captured")).toBe(true);
  expect(checked.coverage.confirmed).toBeGreaterThan(0);
});

test("capture is bounded and continues saving diverse new viewpoints after capacity", () => {
  const capture = new ContinuousCapture({ maximumFrames: 12 });
  for (let id = 1; id <= 100; id++) capture.consider(wall(id, id * 0.08), profile);
  expect(capture.frames).toHaveLength(12);
  expect(capture.events.captured).toBe(100);
  expect(capture.events.removed).toBe(88);
  expect(capture.frames[0].camera[0]).toBeCloseTo(0.08);
  expect(capture.frames.at(-1).camera[0]).toBeCloseTo(8);
  expect(new Set(capture.frames.map(frame => frame.captureId)).size).toBe(12);
  expect(capture.snapshot().capacityReached).toBe(false);
});

test("stationary repeats do not inflate saved viewpoints or multi-view confidence", () => {
  const capture = new ContinuousCapture(), store = new CaptureAnalysisStore();
  for (let id = 1; id <= 50; id++) capture.consider(wall(id, 0), profile);
  expect(capture.frames).toHaveLength(1);
  expect(capture.events.captured).toBe(1);
  expect(analyze(store, capture).checkedIds).toEqual([]);
  expect(capture.snapshot().coverage.confirmed).toBe(0);
  expect(capture.needsObservation(wall(51, 0), profile, capture.frames[0].timestamp + 300)).toBe(false);
  expect(capture.needsObservation(wall(51, 0.1), profile, capture.frames[0].timestamp + 300)).toBe(true);
});

test("lost tracking and malformed poses are withheld; a reference-space reset blocks mixing epochs", () => {
  const capture = new ContinuousCapture();
  expect(capture.consider({ ...wall(1, 0), tracking: false }, profile).accepted).toBe(false);
  const invalid = wall(2, 0); invalid.transformMatrix[12] = NaN;
  expect(capture.consider(invalid, profile).accepted).toBe(false);
  expect(capture.consider({ ...wall(3, 0), validCount: 2 }, profile).accepted).toBe(false);
  capture.consider(wall(4, 0), profile);
  capture.failure("tracking-reset");
  expect(capture.consider(wall(5, 0.1), profile).accepted).toBe(false);
  expect(capture.frames).toHaveLength(1);
});

test("analysis for an evicted or replaced source cannot certify current observations", () => {
  const capture = new ContinuousCapture({ maximumFrames: 3 }), store = new CaptureAnalysisStore();
  for (let id = 1; id <= 3; id++) capture.consider(wall(id, id * 0.1), profile);
  const sources = capture.frames.slice();
  const result = store.analyze({ ids: sources.map(frame => frame.captureId), changed: sources, floorY: 0 });
  capture.consider(wall(4, 0.4), profile);
  expect(capture.applyAnalysis(result, sources)).toBe(false);
  expect(capture.checkedFrames).toEqual([]);
});

test("review validates unconfirmed observations and raw export retains excluded measurements", () => {
  const capture = new ContinuousCapture();
  for (let id = 1; id <= 7; id++) capture.consider(wall(id, id * 0.08, id === 7 ? 2.35 : 2), profile);
  const raw = { keyframes: capture.frames, stats: { captureMode: "continuous", capturedKeyframes: 7,
    cameraBaseline: 0.5, adaptiveCapture: capture.snapshot() }, floorY: 0 };
  const fused = fuseRgbdKeyframes(raw.keyframes, scanFusionOptions(raw, "surface", {
    voxelSize: 0.09, maxGridDimension: 50, maxVolumeCells: 125000, surfaceTexture: false,
    textureRegistration: false, structuralRebuild: false, conformTopology: false,
  }));
  expect(fused.diagnostics.captureRetention).toMatchObject({ capturedFrames: 7, liveCheckedFrames: 0,
    finalValidatedFrames: 6, excludedFrameIds: [6] });
  expect(fused.diagnostics.alignment.disconnectedFrameIds).toContain(6);
  expect(fused.mesh?.triangleCount).toBeGreaterThan(0);
  expect(capture.frames.every(frame => frame.captureStatus === "captured")).toBe(true);
  const restored = parsePartialScan(serializePartialScan({ rawCapture: raw, pointCount: 0 }));
  expect(restored.rawCapture.keyframes).toHaveLength(7);
  expect(restored.rawCapture.keyframes[6].depths).toEqual(raw.keyframes[6].depths);
  expect(restored.rawCapture.stats.adaptiveCapture.mode).toBe("continuous");
  expect(restored.rawCapture.keyframes[6].captureStatus).toBe("captured");
  expect(auditCapture(raw.stats, fused.diagnostics).issues.join(" ")).toMatch(/remain in the raw scan/);
});
