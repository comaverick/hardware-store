import { Matrix4, PerspectiveCamera } from "three";
import { createRgbdKeyframe, fuseRgbdKeyframes } from "./fusion";
import { scanFusionOptions } from "./fusionOptions";
import { unprojectDepth } from "./depth";
import { AdaptiveCapture, adaptiveCaptureProfile, auditCapture, captureBridgeOverlap, captureOverlap, confirmedViewRatio, connectedCoverage } from "./adaptiveCapture";

function wallFrame(x, timestamp, { yaw = 0, wallZ = -2, upperWallZ = null, sparse = false, visible = null } = {}) {
  const camera = new PerspectiveCamera(65, 1, 0.1, 20);
  const matrix = new Matrix4().makeRotationY(yaw).setPosition(x, 1.5, 0);
  const view = { projectionMatrix: camera.projectionMatrix.elements, transform: { matrix: matrix.elements } };
  const depth = { getDepthInMeters: (u, v) => {
    if ((sparse && (u > 0.2 || v > 0.2)) || (visible && !visible(u, v))) return 0;
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

test("XR-tracked capture saves new areas without live overlap comparisons", () => {
  const compare = jest.fn(() => ({ accepted: false, conflict: true, overlap: 0 }));
  const capture = started({ validateOverlap: false, compare });
  expect(capture.frames).toHaveLength(2);
  const next = wallFrame(0.16, 800, { wallZ: -2.35, yaw: 0.6 });
  expect(capture.consider(next)).toMatchObject({ accepted: true, committed: [next], reason: "connected" });
  expect(capture.frames).toHaveLength(3);
  expect(compare).not.toHaveBeenCalled();
  expect(capture.snapshot()).toMatchObject({ validationMode: "xr-tracking", state: "tracking", pendingCount: 0 });
  // Retention is not proof of repeated depth agreement.
  expect(confirmedViewRatio(next, capture.frames)).toBe(0);
});

test("XR-tracked capture keeps startup translation and viewpoint spacing", () => {
  const capture = new AdaptiveCapture({ validateOverlap: false });
  for (let i = 0; i < 12; i++) capture.consider(wallFrame(0, 100 + i * 200));
  expect(capture.frames).toHaveLength(0);
  capture.consider(wallFrame(0.08, 2600));
  expect(capture.frames).toHaveLength(2);
  expect(capture.consider(wallFrame(0.09, 3000)).committed).toHaveLength(0);
  expect(capture.frames).toHaveLength(2);
});

test("XR-tracked capture resumes on the first valid tracked view and ignores capture gaps", () => {
  const compare = jest.fn(() => ({ accepted: false, conflict: false, overlap: 0 }));
  const capture = started({ validateOverlap: false, compare });
  capture.failure("tracking-lost", 600);
  capture.failure("sparse-depth", 800);
  expect(capture.frames).toHaveLength(2);
  expect(capture.consider(wallFrame(0.16, 1000, { wallZ: -2.15 })).accepted).toBe(true);
  expect(capture.state).toBe("tracking");
  expect(capture.consider(wallFrame(0.24, 5000)).accepted).toBe(true);
  expect(capture.frames).toHaveLength(4);
  expect(capture.events.recoveries).toBe(1);
  expect(compare).not.toHaveBeenCalled();
});

test("XR-tracked capture skips a sudden camera jump and retries the next steady view", () => {
  const capture = started({ validateOverlap: false });
  expect(capture.consider(wallFrame(0.9, 800)).accepted).toBe(false);
  expect(capture.frames).toHaveLength(2);
  expect(capture.state).toBe("recovering");
  expect(capture.consider(wallFrame(0.98, 1200)).accepted).toBe(true);
  expect(capture.frames).toHaveLength(3);
});

test("XR-tracked capture never resumes after a coordinate reset", () => {
  const capture = started({ validateOverlap: false });
  capture.failure("tracking-reset", 600);
  capture.failure("tracking-lost", 800);
  expect(capture.consider(wallFrame(0.16, 1000)).accepted).toBe(false);
  expect(capture.frames).toHaveLength(2);
});

test("XR-tracked capture continues at capacity while keeping a bounded trajectory", () => {
  const compare = jest.fn(() => { throw new Error("Live overlap must not run"); });
  const capture = started({ validateOverlap: false, maximumFrames: 3, compare });
  capture.consider(wallFrame(0.16, 800));
  const anchor = capture.frames[0], latest = wallFrame(0.24, 1200);
  const decision = capture.consider(latest);
  expect(decision).toMatchObject({ accepted: true, reason: "connected" });
  expect(decision.committed).toHaveLength(1);
  expect(decision.committed[0]).toBe(latest);
  expect(capture.frames[0]).toBe(anchor);
  expect(capture.frames.at(-1)).toBe(latest);
  expect(capture.snapshot()).toMatchObject({ capacityReached: false, frameCount: 3, connected: true, removed: 1 });
  const ids = new Set(capture.frames.map(frame => frame.captureId));
  capture.frames.forEach(frame => frame.captureLinks.forEach(id => expect(ids.has(id)).toBe(true)));
  expect(compare).not.toHaveBeenCalled();
});

test("long XR-tracked capture retains early, middle and recent views and pinned photos", () => {
  const capture = started({ validateOverlap: false });
  const anchors = capture.frames.slice(), photos = [];
  for (let i = 2; i < 240; i++) {
    const frame = wallFrame(i * 0.08, 100 + i * 400);
    if ([10, 40, 90, 130, 170, 210].includes(i)) {
      frame.colorImage = new Uint8Array([120, 120, 120, 255]);
      photos.push(frame);
    }
    const decision = capture.consider(frame);
    expect(decision).toMatchObject({ accepted: true, reason: "connected" });
    expect(decision.committed).toHaveLength(1);
    expect(decision.committed[0]).toBe(frame);
    expect(capture.frames.length).toBeLessThanOrEqual(60);
  }
  expect(capture.snapshot()).toMatchObject({ connected: true, capacityReached: false, frameCount: 60, capacityStops: 0 });
  expect(capture.frames.slice(0, 2)).toEqual(anchors);
  expect(capture.frames.at(-2).camera[0]).toBeCloseTo(238 * 0.08);
  expect(capture.frames.at(-1).camera[0]).toBeCloseTo(239 * 0.08);
  photos.forEach(frame => expect(capture.frames).toContain(frame));
  for (let section = 0; section < 4; section++)
    expect(capture.frames.filter(frame => frame.camera[0] >= section * 4.8 && frame.camera[0] < (section + 1) * 4.8).length).toBeGreaterThanOrEqual(8);
  const largestGap = Math.max(...capture.frames.slice(1).map((frame, index) => frame.camera[0] - capture.frames[index].camera[0]));
  expect(largestGap).toBeLessThan(0.8);
  const ids = new Set(capture.frames.map(frame => frame.captureId));
  capture.frames.forEach(frame => frame.captureLinks.forEach(id => expect(ids.has(id)).toBe(true)));
});

test("tracked compaction preserves sharp turns and also handles a full set of photo views", () => {
  const capture = started({ validateOverlap: false, maximumFrames: 6 });
  capture.consider(wallFrame(0.16, 800));
  const corner = wallFrame(0.24, 1200);
  capture.consider(corner);
  capture.consider(wallFrame(0.16, 1600));
  capture.consider(wallFrame(0.08, 2000));
  capture.consider(wallFrame(0, 2400));
  expect(capture.frames).toContain(corner);
  capture.frames.forEach(frame => { frame.colorImage = new Uint8Array([120, 120, 120, 255]); });
  const next = wallFrame(-0.08, 2800);
  next.colorImage = new Uint8Array([120, 120, 120, 255]);
  expect(capture.consider(next).accepted).toBe(true);
  expect(capture.frames).toHaveLength(6);
  expect(capture.frames.at(-1)).toBe(next);
  expect(capture.snapshot()).toMatchObject({ connected: true, capacityReached: false });
});

test("XR-tracked depth refresh does not rerun live overlap checks", () => {
  const compare = jest.fn(() => ({ accepted: false, conflict: true, overlap: 0 }));
  const capture = started({ validateOverlap: false, compare });
  const refreshed = wallFrame(0, 800, { wallZ: -2.15 });
  expect(capture.replace(capture.frames[0], refreshed)).toBe(true);
  expect(capture.frames[0]).toBe(refreshed);
  expect(compare).not.toHaveBeenCalled();
});

test("reconstruction rejects a bad depth layer retained by XR-tracked acquisition", () => {
  const capture = started({ validateOverlap: false });
  capture.consider(wallFrame(0.16, 800, { wallZ: -2.35 }));
  capture.consider(wallFrame(0.24, 1200));
  capture.consider(wallFrame(0.32, 1600));
  capture.snapshot();
  expect(capture.frames).toHaveLength(5);
  const result = fuseRgbdKeyframes(capture.frames, scanFusionOptions({ stats: { depthType: "smooth" } }, "surface", { maxDimension: 48 }));
  expect(result.mesh).toBeTruthy();
  expect(result.diagnostics.alignment.rejectedFrameIds).toContain(2);
  expect(result.diagnostics.fusedFrameIds).not.toContain(2);
  expect(result.diagnostics.fusedFrameIds).toHaveLength(4);
});

test("reconstruction independently rejects conflicting depth after tracked trajectory compaction", () => {
  const capture = started({ validateOverlap: false, maximumFrames: 6 });
  const bad = wallFrame(0.16, 800, { wallZ: -2.35 });
  // A retained photo must not turn its trajectory links into geometric proof.
  bad.colorImage = new Uint8Array([120, 120, 120, 255]);
  bad.colorWidth = bad.colorHeight = 1;
  capture.consider(bad);
  for (let i = 3; i < 9; i++) capture.consider(wallFrame(i * 0.08, 400 + i * 400));
  expect(capture.snapshot()).toMatchObject({ connected: true, capacityReached: false, frameCount: 6, removed: 3 });
  const badIndex = capture.frames.indexOf(bad);
  expect(badIndex).toBeGreaterThanOrEqual(0);
  const result = fuseRgbdKeyframes(capture.frames, scanFusionOptions({ stats: { depthType: "smooth" } }, "surface", { maxDimension: 48 }));
  expect(result.mesh).toBeTruthy();
  expect(result.diagnostics.alignment.rejectedFrameIds).toContain(badIndex);
  expect(result.diagnostics.fusedFrameIds).not.toContain(badIndex);
  expect(result.diagnostics.fusedFrameIds).toHaveLength(5);
});

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

test("a thin measured strip is a possible bridge, but a shifted layer is not", () => {
  const original = wallFrame(0, 100);
  const strip = wallFrame(0.08, 400, { visible: (_u, v) => v < 0.1 });
  const overlap = captureOverlap(original, strip);
  expect(overlap.accepted).toBe(false);
  expect(captureBridgeOverlap(overlap)).toBe(true);
  expect(captureBridgeOverlap(captureOverlap(original, wallFrame(0.08, 400, { wallZ: -2.22 })))).toBe(false);
  expect(captureBridgeOverlap(captureOverlap(original, wallFrame(0.08, 400, { sparse: true })))).toBe(false);
});

test("broad near-threshold overlap needs strong support and still rejects conflicting depth", () => {
  const measured = { compared: 150, agreeing: 60, tiles: 9, support: 0.24,
    agreement: 0.46, median: 0.058, upper: 0.098, freeSpaceRatio: 0.04 };
  expect(captureBridgeOverlap({ conflict: false, forward: measured, backward: measured })).toBe(true);
  expect(captureBridgeOverlap({ conflict: false, forward: measured,
    backward: { ...measured, median: 0.07 } })).toBe(false);
  expect(captureBridgeOverlap({ conflict: false, forward: measured,
    backward: { ...measured, freeSpaceRatio: 0.2 } })).toBe(false);
  expect(captureBridgeOverlap({ conflict: false, forward: measured,
    backward: { ...measured, support: 0.19 } })).toBe(false);
  expect(captureBridgeOverlap({ conflict: true, forward: measured, backward: measured })).toBe(false);
  expect(captureBridgeOverlap(captureOverlap(wallFrame(0, 100), wallFrame(0.08, 400, { wallZ: -2.22 })))).toBe(false);
});

test("a sampling-phase miss during a turn gets a bounded bidirectional recheck", () => {
  const original = wallFrame(0, 100);
  const normal = captureOverlap(original, wallFrame(0.08, 400, { yaw: 1.08 }));
  expect(normal.accepted).toBe(true);
  expect(normal.forward.agreeing).toBeGreaterThan(20);
  expect(normal.backward.agreeing).toBeGreaterThan(20);
  const narrow = captureOverlap(original, wallFrame(0.08, 400, { yaw: 1.1 }));
  expect(narrow.accepted).toBe(false);
  expect(captureBridgeOverlap(narrow)).toBe(true);
  expect(captureBridgeOverlap(captureOverlap(original, wallFrame(0.08, 400, { yaw: 1.16 })))).toBe(false);
});

test("two displaced, agreeing views reconnect a narrow bridge into one saved scan", () => {
  const capture = started();
  const bridge = wallFrame(0.08, 650, { yaw: 1.1 });
  expect(capture.consider(bridge).accepted).toBe(false);
  expect(capture.frames).toHaveLength(2);
  expect(capture.snapshot().connected).toBe(true);
  const result = capture.consider(wallFrame(0.13, 950, { yaw: 1.1 }));
  expect(result.accepted).toBe(true);
  expect(result.committed).toHaveLength(2);
  expect(capture.snapshot().connected).toBe(true);
  expect(capture.frames).toHaveLength(4);
  expect(capture.pending).toHaveLength(0);
});

test("a narrow bridge cannot promote a second view from a shifted depth layer", () => {
  const capture = started();
  capture.consider(wallFrame(0.08, 650, { yaw: 1.1 }));
  capture.consider(wallFrame(0.13, 950, { yaw: 1.1, wallZ: -2.22 }));
  expect(capture.frames).toHaveLength(2);
  expect(capture.snapshot().connected).toBe(true);
});

test("a bridge at the frame limit stops clearly without saving half the pair", () => {
  const capture = started({ maximumFrames: 3 });
  capture.consider(wallFrame(0.16, 650, { visible: (_u, v) => v < 0.1 }));
  const result = capture.consider(wallFrame(0.23, 950, { visible: (_u, v) => v < 0.1 }));
  expect(result.reason).toBe("capacity");
  expect(capture.frames).toHaveLength(2);
  expect(capture.snapshot()).toMatchObject({ connected: true, capacityReached: true });
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

test("brief motion skips preserve recent recovery evidence without saving the skipped observation", () => {
  const capture = started();
  capture.failure("tracking-lost", 600);
  expect(capture.consider(wallFrame(0.1, 800)).accepted).toBe(false);
  capture.failure("moving-too-fast", 1000);
  expect(capture.frames).toHaveLength(2);
  expect(capture.consider(wallFrame(0.16, 1200)).accepted).toBe(true);
  expect(capture.state).toBe("tracking");
});

test("one uncertain depth read does not restart a verified recovery sequence", () => {
  const capture = started();
  capture.failure("tracking-lost", 600);
  expect(capture.consider(wallFrame(0.1, 800)).accepted).toBe(false);
  expect(capture.consider(wallFrame(0.12, 950, { wallZ: -2.1 })).accepted).toBe(false);
  expect(capture.consider(wallFrame(0.16, 1150)).accepted).toBe(true);
  expect(capture.snapshot().connected).toBe(true);
});

test("alternating aligned and conflicting depth cannot trap capture at two saved views", () => {
  const capture = started();
  const rejected = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    const start = 650 + cycle * 1000;
    const x = 0.1 + cycle * 0.1;
    const firstBad = wallFrame(x, start, { wallZ: -2.35 });
    expect(capture.consider(firstBad).reason).toBe("alignment-conflict");
    expect(capture.consider(wallFrame(x, start + 250)).reason).toBe("confirming-recovery");
    const secondBad = wallFrame(x + 0.02, start + 500, { wallZ: -2.35 });
    expect(capture.consider(secondBad).reason).toBe("alignment-conflict");
    expect(capture.consider(wallFrame(x + 0.06, start + 750)).accepted).toBe(true);
    rejected.push(firstBad, secondBad);
  }
  expect(capture.frames).toHaveLength(4);
  for (const frame of rejected) {
    expect(capture.frames).not.toContain(frame);
    expect(capture.pending).not.toContain(frame);
  }
  expect(capture.snapshot()).toMatchObject({ connected: true, state: "tracking" });
});

test("a conflicting saved reference still vetoes the candidate when another reference agrees", () => {
  const compare = (left, right) => ({
    accepted: left.timestamp !== 1000 || right.timestamp !== 100,
    conflict: left.timestamp === 1000 && right.timestamp === 100,
    overlap: 0.8,
  });
  const capture = started({ compare });
  capture.failure("tracking-lost", 600);
  expect(capture.consider(wallFrame(0.1, 800)).reason).toBe("confirming-recovery");
  const rejected = wallFrame(0.12, 1000);
  expect(capture.consider(rejected).reason).toBe("alignment-conflict");
  expect(capture.frames).not.toContain(rejected);
  expect(capture.consider(wallFrame(0.16, 1200)).accepted).toBe(true);
  expect(capture.snapshot().connected).toBe(true);
});

test("recovery can corroborate an earlier view across a different valid saved patch", () => {
  const compare = (left, right) => ({
    accepted: left.timestamp <= 400 || right.timestamp <= 400 ||
      Math.abs(left.camera[0] - right.camera[0]) < 0.05,
    conflict: false, overlap: 0.8,
  });
  const capture = started({ compare });
  capture.failure("tracking-lost", 600);
  expect(capture.consider(wallFrame(0.1, 800)).accepted).toBe(false);
  const differentPatch = wallFrame(0.2, 1100);
  expect(capture.consider(differentPatch).accepted).toBe(false);
  expect(capture.frames).toHaveLength(2);
  expect(capture.consider(wallFrame(0.12, 1400)).accepted).toBe(true);
  expect(capture.frames).not.toContain(differentPatch);
  expect(capture.snapshot()).toMatchObject({ connected: true, state: "tracking" });
});

test("recovery history stays bounded and stale observations cannot confirm a later view", () => {
  const compare = (left, right) => ({
    accepted: left.timestamp <= 400 || right.timestamp <= 400 ||
      Math.abs(left.camera[0] - right.camera[0]) < 0.01,
    conflict: false, overlap: 0.8,
  });
  const capture = started({ compare });
  capture.failure("tracking-lost", 600);
  for (let index = 0; index < 9; index++) {
    expect(capture.consider(wallFrame(0.1 + index * 0.06, 800 + index * 200)).accepted).toBe(false);
    expect(capture.snapshot({ refreshCoverage: false }).recoveryEvidenceCount).toBeLessThanOrEqual(3);
    expect(capture.frames).toHaveLength(2);
  }
  capture.failure("sparse-depth", 4201);
  expect(capture.snapshot().recoveryEvidenceCount).toBe(0);
  expect(capture.consider(wallFrame(0.58, 4500)).reason).toBe("confirming-recovery");
  expect(capture.consider(wallFrame(0.58, 4750)).accepted).toBe(true);
});

test("persistent conflicting depth expires recovery evidence and still needs a fresh agreeing pair", () => {
  const capture = started();
  capture.failure("tracking-lost", 600);
  capture.consider(wallFrame(0.1, 800));
  for (const time of [1000, 1400, 1800, 2300, 2700]) {
    expect(capture.consider(wallFrame(0.12, time, { wallZ: -2.35 })).reason).toBe("alignment-conflict");
    expect(capture.frames).toHaveLength(2);
  }
  expect(capture.consider(wallFrame(0.16, 3000)).reason).toBe("confirming-recovery");
  expect(capture.consider(wallFrame(0.22, 3250)).accepted).toBe(true);
  expect(capture.snapshot().connected).toBe(true);
});

test("an alignment-conflict report withholds its observation without clearing recent validated recovery", () => {
  const capture = started();
  capture.failure("tracking-lost", 600);
  capture.consider(wallFrame(0.1, 800));
  capture.failure("alignment-conflict", 1000);
  expect(capture.frames).toHaveLength(2);
  expect(capture.consider(wallFrame(0.16, 1200)).accepted).toBe(true);
});

test("three motion rejections do not turn a connected scan into an amber recovery loop", () => {
  const capture = started();
  for (const timestamp of [600, 800, 1000]) capture.failure("moving-too-fast", timestamp);
  expect(capture.state).toBe("tracking");
  expect(capture.events.recoveries).toBe(0);
  expect(capture.frames).toHaveLength(2);
  expect(capture.consider(wallFrame(0.16, 1200)).accepted).toBe(true);
  expect(capture.snapshot().connected).toBe(true);
});

test.each(["tracking-lost", "tracking-reset", "camera-jump"])(
  "%s clears the previous successful recovery observation", reason => {
    const capture = started();
    capture.failure("tracking-lost", 600);
    capture.consider(wallFrame(0.1, 800));
    capture.failure(reason, 1000);
    expect(capture.consider(wallFrame(0.12, 1200)).accepted).toBe(false);
    expect(capture.consider(wallFrame(0.16, 1450)).accepted).toBe(true);
  },
);

test("repeated quality skips cannot keep old recovery evidence alive indefinitely", () => {
  const capture = started();
  capture.failure("tracking-lost", 600);
  capture.consider(wallFrame(0.1, 800));
  for (const timestamp of [1200, 1600, 2000, 2400, 2800]) capture.failure("moving-too-fast", timestamp);
  expect(capture.consider(wallFrame(0.12, 3000)).accepted).toBe(false);
  expect(capture.consider(wallFrame(0.16, 3250)).accepted).toBe(true);
});

test("recovery observations that match different saved patches must also agree with each other", () => {
  const compare = (left, right) => ({
    accepted: left.timestamp <= 400 || right.timestamp <= 400 ||
      Math.abs(left.camera[0] - right.camera[0]) < 0.05,
    conflict: false, overlap: 0.8,
  });
  const capture = started({ compare });
  capture.failure("tracking-lost", 600);
  expect(capture.consider(wallFrame(0.1, 800)).accepted).toBe(false);
  capture.failure("sparse-depth", 1000);
  expect(capture.consider(wallFrame(0.2, 1200)).accepted).toBe(false);
  expect(capture.frames).toHaveLength(2);
  expect(capture.consider(wallFrame(0.22, 1450)).accepted).toBe(true);
  expect(capture.state).toBe("tracking");
});

test("one uncertain overlap stays provisional and does not force a return after a good match", () => {
  const capture = started();
  const uncertain = wallFrame(0.1, 650, { wallZ: -2.1 });
  expect(capture.consider(uncertain).accepted).toBe(false);
  expect(capture.state).toBe("checking");
  expect(capture.frames).not.toContain(uncertain);
  expect(capture.consider(wallFrame(0.16, 1000)).accepted).toBe(true);
  expect(capture.state).toBe("tracking");
  expect(capture.events.recoveries).toBe(0);
  expect(capture.frames).not.toContain(uncertain);
});

test("persistent lost overlap still requires verified recovery", () => {
  const capture = started();
  capture.consider(wallFrame(0.1, 600, { wallZ: -2.1 }));
  capture.consider(wallFrame(0.12, 1600, { wallZ: -2.1 }));
  expect(capture.state).toBe("recovering");
  expect(capture.consider(wallFrame(0.14, 1800)).accepted).toBe(false);
  expect(capture.consider(wallFrame(0.16, 2050)).accepted).toBe(true);
  expect(capture.frames.every(frame => frame.depths[0] < 2.05)).toBe(true);
});

test("stale provisional views expire with a separate age counter", () => {
  const capture = started();
  capture.consider(wallFrame(5, 600));
  for (let i = 0; i < 3; i++) capture.failure("moving-too-fast", 800 + i * 200);
  expect(capture.state).toBe("recovering");
  capture.failure("depth-missing", 9500);
  expect(capture.pending).toHaveLength(0);
  expect(capture.events.expired).toBeGreaterThan(0);
  expect(capture.events.pendingAgeDrops).toBeGreaterThan(0);
});

test("pending retention protects a likely bridge and removes redundant viewpoints first", () => {
  const compare = (left, right) => {
    const separation = Math.abs(left.camera[0] - right.camera[0]);
    return { accepted: separation < 0.11, conflict: false, overlap: Math.max(0, 1 - separation) };
  };
  const capture = started({ maximumPending: 3, compare });
  const bridge = wallFrame(0.22, 600);
  capture.consider(bridge);
  capture.consider(wallFrame(0.44, 800));
  capture.consider(wallFrame(0.48, 1000));
  capture.consider(wallFrame(0.8, 1200));
  expect(capture.pending).toHaveLength(3);
  expect(capture.pending).toContain(bridge);
  expect(capture.events.pendingCapacityDrops).toBe(1);
  expect(capture.events.pendingAgeDrops).toBe(0);
  capture.consider(wallFrame(0.16, 1400));
  capture.consider(wallFrame(0.17, 1650));
  expect(capture.frames).toContain(bridge);
  expect(capture.snapshot().connected).toBe(true);
  for (const frame of capture.frames) for (const id of frame.captureLinks)
    expect(compare(frame, capture.frames.find(other => other.captureId === id)).accepted).toBe(true);
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
  const previewBusy = adaptiveCaptureProfile({ processingMs: 700, geometryProcessingMs: 20 });
  expect(previewBusy.interval).toBe(600);
  expect(previewBusy.sampleLongSide).toBe(96);
});

test("live coverage can use a recent snapshot while saved views still update immediately", () => {
  const capture = started();
  const previous = capture.snapshot().coverage;
  capture.consider(wallFrame(0.16, 700));
  expect(capture.frames).toHaveLength(3);
  expect(capture.snapshot({ refreshCoverage: false }).coverage).toBe(previous);
  expect(capture.snapshot().coverage).not.toBe(previous);
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
  expect(auditCapture({ ...stats, captureDiagnostics: { attempts: 40,
    decisions: { "moving-too-fast": 16 } } }).issues.join(" ")).toMatch(/fast motion/);
  expect(auditCapture({ ...stats, cameraBaseline: .12 }).issues.join(" ")).toMatch(/too close together/);
  expect(auditCapture(stats, { triangles: 10000, topologyAfterRepair: { nonManifoldEdges: 250 } }).issues.join(" ")).toMatch(/overlapping or torn edges/);
});
