import { Matrix4, PerspectiveCamera } from "three";
import { createRgbdKeyframe } from "./fusion";
import { unprojectDepth } from "./depth";
import { AdaptiveCapture, adaptiveCaptureProfile, auditCapture, captureOverlap, confirmedViewRatio, connectedCoverage } from "./adaptiveCapture";

function wallFrame(x, timestamp, { yaw = 0, wallZ = -2, upperWallZ = null, sparse = false } = {}) {
  const camera = new PerspectiveCamera(65, 1, 0.1, 20);
  const matrix = new Matrix4().makeRotationY(yaw).setPosition(x, 1.5, 0);
  const view = { projectionMatrix: camera.projectionMatrix.elements, transform: { matrix: matrix.elements } };
  const depth = { getDepthInMeters: (u, v) => {
    if (sparse && (u > 0.2 || v > 0.2)) return 0;
    const rayX = (u * 2 - 1) / view.projectionMatrix[0];
    return (v < 0.2 && upperWallZ != null ? upperWallZ : wallZ) / (-Math.sin(yaw) * rayX - Math.cos(yaw));
  } };
  return createRgbdKeyframe(unprojectDepth(depth, view, 32, 32), {
    columns: 32, rows: 32, timestamp, projectionMatrix: view.projectionMatrix,
    transformMatrix: matrix.elements, camera: { x, y: 1.5, z: 0 }, depthType: "smooth",
  });
}

function started(options) {
  const capture = new AdaptiveCapture(options);
  capture.consider(wallFrame(0, 100));
  capture.consider(wallFrame(0.08, 400));
  return capture;
}

test("bootstrap requires independent, agreeing views and stationary frames do not confirm coverage", () => {
  const capture = new AdaptiveCapture();
  for (let i = 0; i < 12; i++) capture.consider(wallFrame(0, 100 + i * 200));
  expect(capture.frames).toHaveLength(0);
  expect(capture.pending.length).toBeLessThanOrEqual(6);
  expect(capture.snapshot().coverage.confirmed).toBe(0);
  capture.consider(wallFrame(0.08, 2600));
  expect(capture.frames).toHaveLength(2);
  expect(capture.snapshot().connected).toBe(true);
  expect(capture.snapshot().coverage.confirmed).toBeGreaterThan(0);
});

test("very slow continuous motion keeps a fixed bootstrap anchor", () => {
  const capture = new AdaptiveCapture();
  for (let i = 0; i < 12; i++) capture.consider(wallFrame(i * 0.006, 100 + i * 250));
  expect(capture.frames.length).toBeGreaterThanOrEqual(2);
  expect(capture.snapshot().connected).toBe(true);
  expect(capture.frames[0].camera[0]).toBe(0);
});

test("a locally shifted patch is not confirmed just because most of its frame overlaps", () => {
  const first = wallFrame(0, 100, { wallZ: -1.94 });
  const second = wallFrame(0.08, 400, { wallZ: -1.94, upperWallZ: -2.06 });
  expect(captureOverlap(first, second).accepted).toBe(true);
  const coverage = connectedCoverage([first, second]);
  expect(coverage.regions.find(region => region.id === "upper").ratio).toBeLessThan(0.35);
  expect(coverage.regions.find(region => region.id === "middle").ratio).toBeGreaterThan(0.6);
  expect(confirmedViewRatio(second, [first, second])).toBeLessThan(0.85);
  expect(confirmedViewRatio(first, [first])).toBe(0);
  expect(confirmedViewRatio(first, [first, wallFrame(0, 700, { wallZ: -1.94 })])).toBe(0);
  expect(confirmedViewRatio(first, [first, wallFrame(0.08, 700, { wallZ: -1.94 })])).toBeGreaterThan(0.85);
});

test("bidirectional depth tests accept ordinary turns and reject shifted layers and tiny coincidental patches", () => {
  const original = wallFrame(0, 100);
  expect(captureOverlap(original, wallFrame(0.1, 400, { yaw: 0.2 })).accepted).toBe(true);
  expect(captureOverlap(original, wallFrame(0.1, 400, { wallZ: -2.22 })).accepted).toBe(false);
  expect(captureOverlap(original, wallFrame(0.1, 400, { sparse: true })).accepted).toBe(false);
});

test("disconnected views remain bounded and invisible until a measured bridge reconnects them", () => {
  const capture = started();
  const saved = capture.frames.length;
  capture.consider(wallFrame(4, 700));
  expect(capture.frames).toHaveLength(saved);
  expect(capture.snapshot().state).toBe("recovering");
  expect(capture.pending).toHaveLength(1);
  capture.consider(wallFrame(0.12, 1000));
  expect(capture.state).toBe("recovering");
  capture.consider(wallFrame(0.14, 1300));
  expect(capture.state).toBe("tracking");
  // Walk back out through overlapping views. The isolated view can join
  // only when one of these supplies independently tested overlap.
  for (let i = 1; i <= 8; i++) capture.consider(wallFrame(0.14 + i * 0.4, 1300 + i * 350));
  expect(capture.events.promoted).toBeGreaterThan(0);
  expect(capture.snapshot().connected).toBe(true);
});

test("tracking loss and long gaps recover through new observations without pausing the reader", () => {
  const capture = started();
  capture.failure("tracking-lost", 600);
  expect(capture.consider(wallFrame(0.1, 800)).accepted).toBe(false);
  expect(capture.consider(wallFrame(0.12, 1050)).accepted).toBe(true);
  expect(capture.consider(wallFrame(0.14, 4000)).accepted).toBe(false);
  expect(capture.consider(wallFrame(0.16, 4250)).accepted).toBe(true);
  expect(capture.snapshot().recoveries).toBe(2);
});

test("recovery requires consecutive reliable observations, not matches separated by a bad frame", () => {
  const capture = started();
  capture.failure("tracking-lost", 600);
  expect(capture.consider(wallFrame(0.1, 800)).accepted).toBe(false);
  capture.failure("moving-too-fast", 1000);
  expect(capture.consider(wallFrame(0.12, 1200)).accepted).toBe(false);
  expect(capture.consider(wallFrame(0.14, 1450)).accepted).toBe(true);
});

test("repeated quality failures require reconnection and stale provisional views expire", () => {
  const capture = started();
  capture.consider(wallFrame(5, 600));
  for (let i = 0; i < 3; i++) capture.failure("moving-too-fast", 800 + i * 200);
  expect(capture.state).toBe("recovering");
  capture.failure("depth-missing", 9500);
  expect(capture.pending).toHaveLength(0);
  expect(capture.events.expired).toBeGreaterThan(0);
});

test("more than 60 views remain connected after memory compaction", () => {
  const capture = started();
  for (let i = 2; i < 84; i++) capture.consider(wallFrame(i * 0.08, 100 + i * 250));
  const state = capture.snapshot();
  expect(capture.frames).toHaveLength(60);
  expect(state.connected).toBe(true);
  expect(state.removed).toBeGreaterThan(0);
  expect(state.capacityReached).toBe(false);
  expect(capture.frames[capture.frames.length - 1].camera[0]).toBeCloseTo(83 * 0.08);
  const ids = new Set(capture.frames.map(frame => frame.captureId));
  capture.frames.forEach(frame => frame.captureLinks.forEach(id => expect(ids.has(id)).toBe(true)));
});

test("capacity protects an irreplaceable connecting view instead of severing a chain", () => {
  const compare = (left, right) => ({ accepted: Math.abs(left.camera[0] - right.camera[0]) < 0.11, conflict: false, overlap: 0.8 });
  const capture = started({ maximumFrames: 3, compare });
  capture.consider(wallFrame(0.16, 700));
  const result = capture.consider(wallFrame(0.24, 1000));
  expect(result.reason).toBe("capacity");
  expect(capture.frames).toHaveLength(3);
  expect(capture.snapshot().connected).toBe(true);
  expect(auditCapture({ fusionKeyframes: 10, adaptiveCapture: capture.snapshot() }).issues.join(" ")).toMatch(/capacity/);
});

test("adaptive timing follows motion, depth quality, detail and actual processing cost", () => {
  const still = adaptiveCaptureProfile({ depthType: "raw", width: 320, height: 240 });
  const moving = adaptiveCaptureProfile({ depthType: "raw", width: 320, height: 240, linearSpeed: 0.3 });
  const weak = adaptiveCaptureProfile({ depthType: "smooth", width: 160, height: 90, validRatio: 0.3 });
  const detail = adaptiveCaptureProfile({ edgeRatio: 0.2 });
  const busy = adaptiveCaptureProfile({ processingMs: 110, linearSpeed: 0.3, edgeRatio: 0.2 });
  expect(moving.interval).toBeLessThan(still.interval);
  expect(weak.maxLinearSpeed).toBeLessThan(moving.maxLinearSpeed);
  expect(detail.spacing).toBeLessThan(moving.spacing);
  expect(busy.interval).toBeGreaterThanOrEqual(330);
  expect(busy.sampleLongSide).toBe(64);
});

test("a stationary depth replacement must preserve all existing connections", () => {
  const capture = started();
  expect(capture.replace(capture.frames[0], wallFrame(0.01, 800, { wallZ: -2.3 }))).toBe(false);
  expect(capture.replace(capture.frames[0], wallFrame(0.01, 800))).toBe(true);
  expect(capture.snapshot().connected).toBe(true);
});

test("coverage never calls unobserved regions complete or treats repeated stationary views as independent", () => {
  const coverage = connectedCoverage([wallFrame(0, 100), wallFrame(0, 300)]);
  expect(coverage.confirmed).toBe(0);
  expect(coverage.regions.every(region => region.ratio === 0)).toBe(true);
});

test("finish audit accepts separate objects and flags alignment or structural gaps", () => {
  const stats = { fusionKeyframes: 10, adaptiveCapture: { connected: true, state: "tracking", pendingCount: 0,
    coverage: { regions: [{ id: "middle", observed: 100, ratio: 0.9 }] } } };
  expect(auditCapture(stats, { topologyAfterRepair: { componentCount: 12 }, measuredReviewWarning: {
    issues: [{ code: "disconnected-mesh-patches", message: "Separate furniture" }],
  } }).passed).toBe(true);
  expect(auditCapture(stats, { alignment: { disconnectedFrameIds: [5] } }).passed).toBe(false);
  expect(auditCapture(stats, { measuredReviewWarning: { issues: [{ code: "missing-depth", message: "Wall gap" }] } }).issues).toContain("Wall gap");
  expect(auditCapture({ ...stats, adaptiveCapture: { ...stats.adaptiveCapture, state: "recovering" } }).passed).toBe(false);
});
