import { PerspectiveCamera, Matrix4 } from "three";
import {
  coveragePreviewSize,
  DEPTH_TYPE_PREFERENCE,
  KEYFRAME_RETENTION_TRIGGER,
  MAX_FUSION_KEYFRAMES,
  RoomScanner,
  selectKeyframesForRetention,
  selectTextureKeyframesForRetention,
} from "./RoomScanner";

test("raw depth is preferred before device-smoothed depth", () => {
  expect(DEPTH_TYPE_PREFERENCE).toEqual(["raw", "smooth"]);
});

test("short out-and-back camera motion is detected between depth samples", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  const pose = (x) => ({ position: { x, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  scanner.measureFrameMotion(pose(0), 500);
  scanner.recordCameraMotion(pose(0), 850);
  scanner.recordCameraMotion(pose(0.03), 875);
  const cameraMotion = scanner.recordCameraMotion(pose(0), 900);
  const depthMotion = scanner.measureFrameMotion(pose(0), 900);
  expect(depthMotion.linearSpeed).toBe(0);
  expect(cameraMotion.linearSpeed).toBeGreaterThan(1);
  expect(scanner.isColorFrameReliable({ ...depthMotion, textureLinearSpeed: cameraMotion.linearSpeed })).toBe(false);
  const settled = scanner.recordCameraMotion(pose(0), 1050);
  expect(scanner.isColorFrameReliable(settled)).toBe(true);
  expect(scanner.paused).toBe(false);
});

test("successive texture refreshes cannot drift away from the original depth pose", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  const camera = new PerspectiveCamera(60, 1, 0.1, 20);
  const frame = {
    transformMatrix: new Float32Array(new Matrix4().makeTranslation(0, 1.6, 0).elements),
    viewTransformMatrix: new Float32Array(new Matrix4().makeTranslation(0.03, 1.6, 0).elements),
    colorImage: new Uint8Array([80, 80, 80, 255]),
    colorSharpness: 1, colorFocus: 1,
  };
  scanner.keyframes = [frame];
  const color = Object.assign(() => [140, 140, 140], {
    sharpness: 20, focus: 20,
    snapshot: jest.fn(() => ({ width: 1, height: 1, data: new Uint8Array([140, 140, 140, 255]) })),
  });
  const pose = { position: { x: 0.06, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const view = { projectionMatrix: camera.projectionMatrix.elements, transform: { matrix: new Matrix4().makeTranslation(0.06, 1.6, 0).elements } };
  expect(scanner.refreshNearbyTextureKeyframe(color, pose, view, {}, 1000)).toBe(false);
  expect(color.snapshot).not.toHaveBeenCalled();
  expect(frame.viewTransformMatrix[12]).toBeCloseTo(0.03);
});

test("stationary unsaved frames cannot turn the preview green", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  scanner.renderer = { render: () => {} };
  scanner.session = { depthUsage: "cpu-optimized" };
  scanner.updatePreview = () => {};
  const camera = new PerspectiveCamera(60, 0.5, 0.1, 20);
  const position = { x: 0, y: 1.6, z: 0 };
  const view = {
    projectionMatrix: camera.projectionMatrix.elements,
    transform: {
      position,
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      matrix: new Matrix4().makeTranslation(0, 1.6, 0).elements,
    },
  };
  const frame = {
    getViewerPose: () => ({ transform: view.transform, views: [view] }),
    getHitTestResults: () => [],
    getDepthInformation: () => ({ width: 120, height: 240, getDepthInMeters: () => 2 }),
  };
  scanner.frame(500, frame);
  scanner.frame(1000, frame);
  scanner.frame(1500, frame);
  expect(scanner.stats.errors).toEqual([]);
  expect(scanner.keyframes).toHaveLength(0);
  expect(scanner.capture.state).toBe("starting");
  expect(scanner.cloud.previewStableCount()).toBe(0);
  expect(scanner.stats.currentConfirmedRatio).toBe(0);
  position.x = 0.12;
  view.transform.matrix = new Matrix4().makeTranslation(0.12, 1.6, 0).elements;
  scanner.frame(2000, frame);
  expect(scanner.stats.errors).toEqual([]);
  expect(scanner.keyframes).toHaveLength(2);
  expect(scanner.cloud.previewStableCount()).toBeGreaterThan(0);
  // Waiting at the same pose must never make one depth observation look like
  // independent multi-view support or flood fusion with redundant samples.
  scanner.frame(3500, frame);
  expect(scanner.keyframes).toHaveLength(2);
  scanner.frame(5000, frame);
  expect(scanner.keyframes).toHaveLength(2);
  expect(scanner.stats.errors).toEqual([]);
});

test("confirmed coverage splats stay smaller than the measured surface detail", () => {
  expect(coveragePreviewSize(0.08)).toBeGreaterThanOrEqual(0.045);
  expect(coveragePreviewSize(0.08)).toBeLessThan(0.08);
  expect(coveragePreviewSize(0.18)).toBeLessThanOrEqual(0.11);
});

test("higher-resolution texture snapshots stay bounded without dropping depth frames", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  scanner.keyframes = Array.from({ length: 25 }, (_, index) => ({
    frameId: index,
    depths: new Float32Array([2]),
    colorImage: new Uint8Array([index, index, index, 255]),
  }));
  scanner.compactTextureKeyframes();
  expect(scanner.keyframes).toHaveLength(25);
  expect(scanner.keyframes.every((frame) => frame.depths[0] === 2)).toBe(true);
  expect(scanner.stats.textureKeyframes).toBe(15);
  expect(scanner.keyframes[0].colorImage).toBeNull();
  expect(
    scanner.keyframes.slice(-2).some((frame) => frame.colorImage !== null),
  ).toBe(true);
});

test("texture compaction keeps sharper low-motion images among redundant poses", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  const flat = new Uint8Array(Array(64).fill([120, 120, 120, 255]).flat());
  const checker = new Uint8Array(
    Array.from({ length: 64 }, (_, index) => {
      const value = (index + Math.floor(index / 8)) % 2 ? 30 : 225;
      return [value, value, value, 255];
    }).flat(),
  );
  scanner.keyframes = Array.from({ length: 5 }, (_, index) => ({
    colorImage: index === 2 ? checker.slice() : flat.slice(),
    colorWidth: 8,
    colorHeight: 8,
    colorChannels: 4,
    linearSpeed: index === 1 ? 0.8 : 0.05,
    angularSpeed: index === 1 ? 0.9 : 0.05,
  }));
  scanner.compactTextureKeyframes(4, 3);
  expect(scanner.stats.textureKeyframes).toBe(3);
  expect(scanner.keyframes[2].colorImage).not.toBeNull();
  expect(
    scanner.keyframes.filter((frame) => frame.colorImage !== null),
  ).toHaveLength(3);
});

test("texture compaction does not force blurred endpoint images into the atlas", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  const flat = new Uint8Array(Array(64).fill([120, 120, 120, 255]).flat());
  const checker = new Uint8Array(
    Array.from({ length: 64 }, (_, index) => {
      const value = (index + Math.floor(index / 8)) % 2 ? 30 : 225;
      return [value, value, value, 255];
    }).flat(),
  );
  scanner.keyframes = Array.from({ length: 6 }, (_, index) => ({
    colorImage: index === 1 || index === 4 ? checker.slice() : flat.slice(),
    colorWidth: 8,
    colorHeight: 8,
    colorChannels: 4,
  }));
  scanner.compactTextureKeyframes(5, 2);
  expect(scanner.stats.textureKeyframes).toBe(2);
  expect(scanner.keyframes[0].colorImage).toBeNull();
  expect(scanner.keyframes[1].colorImage).not.toBeNull();
  expect(scanner.keyframes[4].colorImage).not.toBeNull();
  expect(scanner.keyframes[5].colorImage).toBeNull();
});

test("texture retention lets a later novel view displace a redundant early view", () => {
  const textureFrame = (frameId, x, yaw, quality) => {
    const matrix = new Matrix4()
      .makeRotationY(yaw)
      .setPosition(x, 1.6, 0);
    return {
      frameId,
      camera: new Float32Array([x, 1.6, 0]),
      transformMatrix: new Float32Array(matrix.elements),
      viewTransformMatrix: new Float32Array(matrix.elements),
      colorImage: new Uint8Array([120, 120, 120, 255]),
      colorWidth: 1,
      colorHeight: 1,
      colorChannels: 4,
      colorSharpness: quality,
      colorFocus: quality,
    };
  };
  const frames = [
    textureFrame("early-blur", 0, 0, 1),
    textureFrame("early-clear", 0.01, 0.01, 12),
    textureFrame("later-new-wall", 0.45, Math.PI / 2, 2),
  ];
  const retained = selectTextureKeyframesForRetention(frames, 2).map(
    (index) => frames[index].frameId,
  );
  expect(retained).toContain("early-clear");
  expect(retained).toContain("later-new-wall");
  expect(retained).not.toContain("early-blur");
});

test("motion-unreliable depth frames keep sampled RGB but omit the atlas image", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  scanner.addSavedPreview = () => {};
  const camera = new PerspectiveCamera(60, 1, 0.1, 20);
  const matrix = new Matrix4().makeTranslation(0, 1.6, 0);
  const view = {
    projectionMatrix: camera.projectionMatrix.elements,
    transform: {
      position: { x: 0, y: 1.6, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      matrix: matrix.elements,
    },
  };
  const points = Array.from({ length: 6 }, (_, index) => ({
    x: (index % 3) * 0.05,
    y: 1.4 + Math.floor(index / 3) * 0.05,
    z: -2,
    depth: 2,
    color: [30, 80, 140],
    gridX: index % 3,
    gridY: Math.floor(index / 3),
  }));
  const colorAt = Object.assign(() => [30, 80, 140], {
    sharpness: 20,
    focus: 18,
    clippedRatio: 0,
    snapshot: jest.fn(() => ({
      data: new Uint8Array(16).fill(120),
      width: 2,
      height: 2,
      channels: 4,
    })),
  });
  scanner.captureKeyframe(
    points,
    view,
    3,
    2,
    500,
    colorAt,
    scanner.keyframePose(view),
    { width: 3, height: 2 },
    { linearSpeed: 0.3, angularSpeed: 0.1 },
  );
  expect(scanner.keyframes).toHaveLength(1);
  expect(scanner.keyframes[0].colorImage).toBeNull();
  expect(Array.from(scanner.keyframes[0].colorMask)).toEqual(
    Array(6).fill(1),
  );
  expect(colorAt.snapshot).not.toHaveBeenCalled();
});

test("an accepted stationary revisit refreshes texture without adding geometry", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  scanner.session = {
    depthUsage: "cpu-optimized",
    depthDataFormat: "float32",
    depthType: "raw",
  };
  scanner.binding = {};
  scanner.renderer = { getContext: () => ({}), resetState: () => {} };
  const texture = (quality, value) =>
    Object.assign(() => [value, value, value], {
      sharpness: quality,
      focus: quality,
      clippedRatio: 0,
      snapshot: () => ({
        data: new Uint8Array(16).fill(value),
        width: 2,
        height: 2,
        channels: 4,
        sharpness: quality,
        focus: quality,
        clippedRatio: 0,
      }),
    });
  scanner.colorReader = {
    read: jest
      .fn()
      .mockReturnValueOnce(texture(1, 80))
      .mockReturnValueOnce(texture(1, 80))
      .mockReturnValueOnce(texture(20, 160)),
  };
  const add = jest.spyOn(scanner.cloud, "add");
  const camera = new PerspectiveCamera(60, 0.5, 0.1, 20);
  const matrix = new Matrix4().makeTranslation(0, 1.6, 0);
  const view = {
    camera: { width: 360, height: 720 },
    projectionMatrix: camera.projectionMatrix.elements,
    transform: {
      position: { x: 0, y: 1.6, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      matrix: matrix.elements,
    },
  };
  const depth = {
    width: 120,
    height: 240,
    getDepthInMeters: () => 2,
  };
  const frame = { getDepthInformation: () => depth };
  scanner.captureDepthFrame(500, frame, view);
  // Establish a connected seed before testing a stationary texture refresh.
  view.transform.position.x = 0.08;
  view.transform.matrix = new Matrix4().makeTranslation(0.08, 1.6, 0).elements;
  scanner.captureDepthFrame(1000, frame, view);
  // Stay inside the same geometry-keyframe pose, but prove that the refreshed
  // camera image keeps the exact later color pose instead of borrowing the
  // original depth pose.
  view.transform.position.x = 0.10;
  view.transform.matrix = new Matrix4().makeTranslation(0.10, 1.6, 0).elements;
  scanner.captureDepthFrame(1500, frame, view);
  expect(scanner.colorReader.read).toHaveBeenCalledTimes(3);
  expect(scanner.keyframes).toHaveLength(2);
  expect(add).toHaveBeenCalledTimes(2);
  expect(scanner.stats.independentTextureCaptures).toBe(2);
  expect(scanner.textureKeyframes).toHaveLength(1);
  expect(scanner.textureKeyframes[0].colorFocus).toBe(20);
  expect(scanner.textureKeyframes[0].colorImage[0]).toBe(160);
  expect(scanner.keyframes[1].colorImage).toBeNull();
  expect(scanner.keyframes[1].transformMatrix[12]).toBeCloseTo(0.08);
  expect(scanner.textureKeyframes[0].transformMatrix[12]).toBeCloseTo(0.10);
  expect(scanner.textureKeyframes[0].viewTransformMatrix[12]).toBeCloseTo(0.10);
  expect(scanner.textureKeyframes[0].textureOnly).toBe(true);
});

test("a genuinely focused slow-sweep exposure is retained, but fast or blurred exposures are not", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  const focused = { quality: { samples: 400 }, focus: 8, sharpness: 16, clippedRatio: 0.03 };
  expect(scanner.isColorFrameReliable({ linearSpeed: 0.3, angularSpeed: 0.4 }, focused)).toBe(true);
  expect(scanner.isColorFrameReliable({ linearSpeed: 0.3 }, { ...focused, focus: 0.8 })).toBe(false);
  expect(scanner.isColorFrameReliable({ linearSpeed: 1.2 }, focused)).toBe(false);
});

test("independent photo retention shares the image budget without dropping depth frames", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  const makeFrame = (index) => ({
    colorImage: new Uint8Array(512 * 1024 * 4),
    colorSharpness: 8, colorFocus: 8,
    transformMatrix: new Float32Array(new Matrix4().makeTranslation(index * 0.1, 0, 0).elements),
  });
  scanner.keyframes = Array.from({ length: 6 }, (_, i) => makeFrame(i));
  scanner.textureKeyframes = Array.from({ length: 15 }, (_, i) => makeFrame(i + 6));
  scanner.compactTextureKeyframes();
  expect(scanner.keyframes).toHaveLength(6);
  const images = [...scanner.keyframes, ...scanner.textureKeyframes].filter((frame) => frame.colorImage);
  expect(images.length).toBeLessThanOrEqual(15);
  expect(images.reduce((sum, frame) => sum + frame.colorImage.byteLength, 0)).toBeLessThanOrEqual(24 * 1024 * 1024);
});

test("a materially better stationary depth revisit replaces one keyframe", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  const camera = new PerspectiveCamera(60, 1, 0.1, 20);
  const view = {
    projectionMatrix: camera.projectionMatrix.elements,
    transform: {
      position: { x: 0, y: 1.6, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      matrix: new Matrix4().makeTranslation(0, 1.6, 0).elements,
    },
  };
  const points = (missing = false) =>
    Array.from({ length: 16 }, (_, index) => {
      if (missing && index % 2) return null;
      return {
        x: (index % 4) * 0.05,
        y: 1.4 + Math.floor(index / 4) * 0.05,
        z: -2,
        depth: 2,
        gridX: index % 4,
        gridY: Math.floor(index / 4),
      };
    }).filter(Boolean);
  scanner.captureKeyframe(
    points(true),
    view,
    4,
    4,
    500,
    null,
    scanner.keyframePose(view),
    { width: 4, height: 4 },
    { linearSpeed: 0, angularSpeed: 0 },
  );
  const replaced = scanner.refreshNearbyDepthKeyframe(
    points(false),
    view,
    4,
    4,
    1000,
    scanner.keyframePose(view),
    { width: 4, height: 4 },
    { linearSpeed: 0, angularSpeed: 0 },
  );
  expect(replaced).toBe(true);
  expect(scanner.stats.depthRefreshes).toBe(1);
  expect(scanner.keyframes).toHaveLength(1);
  expect(scanner.keyframes[0].measuredDepthCount).toBeGreaterThan(0);
});

test("keyframe retention preserves a bounded spatial path instead of dropping every other view", () => {
  const frames = Array.from({ length: KEYFRAME_RETENTION_TRIGGER + 8 }, (_, index) => ({
    frameId: index,
    camera: new Float32Array([index * 0.04, 1.6, 0]),
    transformMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      index * 0.04, 1.6, 0, 1,
    ]),
    timestamp: index * 400,
  }));
  const retained = selectKeyframesForRetention(frames, MAX_FUSION_KEYFRAMES);
  expect(retained).toHaveLength(MAX_FUSION_KEYFRAMES);
  expect(retained[0].frameId).toBe(0);
  expect(retained[retained.length - 1].frameId).toBe(
    frames[frames.length - 1].frameId,
  );
  expect(retained.map((frame) => frame.frameId)).not.toEqual(
    frames.filter((_, index) => index % 2 === 0).slice(0, MAX_FUSION_KEYFRAMES).map((frame) => frame.frameId),
  );
});

test("geometry compaction preserves the bounded texture-view set", () => {
  const texturedIds = new Set([
    1, 4, 7, 11, 16, 21, 27, 32, 38, 43, 49, 54, 60, 66, 70,
  ]);
  const frames = Array.from(
    { length: KEYFRAME_RETENTION_TRIGGER + 8 },
    (_, index) => ({
      frameId: index,
      camera: new Float32Array([index * 0.025, 1.6, 0]),
      transformMatrix: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        index * 0.025, 1.6, 0, 1,
      ]),
      timestamp: index * 400,
      colorImage: texturedIds.has(index) ? new Uint8Array([index]) : null,
    }),
  );
  const retained = selectKeyframesForRetention(frames, MAX_FUSION_KEYFRAMES);
  const retainedIds = new Set(retained.map((frame) => frame.frameId));
  expect(retained).toHaveLength(MAX_FUSION_KEYFRAMES);
  texturedIds.forEach((frameId) => expect(retainedIds.has(frameId)).toBe(true));
});

test("a transient depth read error is recorded without permanently pausing capture", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  scanner.session = { depthUsage: "cpu-optimized" };
  scanner.captureDepthFrame(500, { getDepthInformation: () => { throw new Error("temporary depth failure"); } }, {});
  expect(scanner.paused).toBe(false);
  expect(scanner.stats.depthReadErrors).toBe(1);
  expect(scanner.stats.depthState).toBe("error");
  expect(scanner.stats.errors[0]).toMatch(/Depth read failed/);
});

function captureHarness() {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  scanner.session = { depthUsage: "cpu-optimized", depthType: "raw" };
  scanner.renderer = { render: () => {} };
  scanner.updatePreview = () => {};
  const camera = new PerspectiveCamera(65, 1, 0.1, 20);
  const view = { projectionMatrix: camera.projectionMatrix.elements, transform: {
    position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 },
    matrix: new Matrix4().makeTranslation(0, 1.6, 0).elements,
  } };
  let emulated = false, depth = 2;
  const frame = { getViewerPose: () => ({ transform: view.transform, views: [view], emulatedPosition: emulated }),
    getHitTestResults: () => [], getDepthInformation: jest.fn(() => ({ width: 320, height: 240, getDepthInMeters: () => depth })) };
  const move = x => {
    view.transform.position.x = x;
    view.transform.matrix = new Matrix4().makeTranslation(x, 1.6, 0).elements;
  };
  scanner.frame(500, frame);
  move(0.08);
  scanner.frame(1000, frame);
  return { scanner, frame, view, move, setEmulated: value => { emulated = value; }, setDepth: value => { depth = value; } };
}

test("live capture retains a locally connected area after losing main-map overlap", () => {
  const { scanner, frame, move } = captureHarness();
  scanner.capture.compare = (left, right) => {
    const separation = Math.abs(left.camera[0] - right.camera[0]);
    return { accepted: separation < .22, conflict: false, overlap: separation < .22 ? .8 : 0 };
  };
  move(1);
  scanner.frame(4000, frame);
  move(1.08);
  scanner.frame(4500, frame);
  expect(scanner.keyframes).toHaveLength(2);
  expect(scanner.stats.adaptiveCapture).toMatchObject({ provisionalFrameCount: 2,
    provisionalSegmentCount: 1, state: "capturing-new-area" });
  expect(scanner.stats.captureDiagnostics.recent.at(-1)).toMatchObject({
    reason: "provisional-connected", accepted: true, committed: 2 });
  expect(scanner.result().provisionalSegments[0].keyframes).toHaveLength(2);
});

test("emulated tracking withholds geometry and automatically confirms recovery in two observations", () => {
  const { scanner, frame, move, setEmulated } = captureHarness();
  expect(scanner.keyframes).toHaveLength(2);
  const reads = frame.getDepthInformation.mock.calls.length;
  scanner.recoveryMarker = { visible: true };
  setEmulated(true);
  scanner.frame(1400, frame);
  expect(frame.getDepthInformation).toHaveBeenCalledTimes(reads);
  expect(scanner.recoveryMarker.visible).toBe(false);
  scanner.recoveryMarker = null;
  expect(scanner.stats.adaptiveCapture.state).toBe("recovering");
  expect(scanner.paused).toBe(false);
  setEmulated(false);
  move(0.1);
  scanner.frame(1800, frame);
  expect(scanner.stats.adaptiveCapture.state).toBe("recovering");
  scanner.frame(2200, frame);
  expect(scanner.stats.adaptiveCapture.state).toBe("tracking");
  expect(scanner.stats.adaptiveCapture.connected).toBe(true);
});

test("an out-and-back shake is rejected even when the sampled depth poses are identical", () => {
  const { scanner, frame, view } = captureHarness();
  const pose = scanner.keyframePose(view);
  scanner.recordCameraMotion(pose, 1300);
  scanner.recordCameraMotion({ ...pose, position: { ...pose.position, x: 0.15 } }, 1320);
  scanner.recordCameraMotion(pose, 1340);
  scanner.captureDepthFrame(1340, frame, view);
  expect(scanner.stats.movingTooFast).toBe(true);
  expect(scanner.keyframes).toHaveLength(2);
  expect(scanner.stats.currentConfirmedRatio).toBe(0);
  expect(scanner.paused).toBe(false);
  expect(scanner.stats.adaptiveCapture.state).toBe("tracking");
  expect(scanner.stats.adaptiveCapture.recoveries).toBe(0);
  const event = scanner.stats.captureDiagnostics.recent.at(-1);
  expect(event.reason).toBe("moving-too-fast");
  expect(event.sampledLinearSpeed).toBe(0);
  expect(event.gateLinearSpeed).toBeGreaterThan(event.maxLinearSpeed);
  expect(event.matched).toBe(false);
  expect(scanner.stats.captureFeedback.code).toBe("confirmed");
});

test("a brief pose spike does not veto settled depth, but still protects color", () => {
  const { scanner, frame, view } = captureHarness();
  const pose = scanner.keyframePose(view);
  scanner.recordCameraMotion(pose, 1100);
  scanner.recordCameraMotion({ ...pose, position: { ...pose.position, x: pose.position.x + 0.03 } }, 1120);
  scanner.recordCameraMotion(pose, 1140);
  scanner.recordCameraMotion(pose, 1160);
  scanner.recordCameraMotion(pose, 1180);
  scanner.recordCameraMotion(pose, 1200);
  expect(scanner.cameraMotion.linearSpeed).toBeGreaterThan(1);
  expect(scanner.cameraMotion.depthLinearSpeed).toBe(0);
  expect(scanner.isColorFrameReliable({ textureLinearSpeed: scanner.cameraMotion.linearSpeed })).toBe(false);
  scanner.captureDepthFrame(1200, frame, view);
  expect(scanner.stats.frameQuality).toBe("connected");
  expect(scanner.stats.captureDiagnostics.recent.at(-1)).toMatchObject({ reason: "connected", accepted: true });
  expect(scanner.keyframes).toHaveLength(2);
});

test("a motion-rejected view is retried soon after the phone settles", () => {
  const { scanner, frame, view } = captureHarness();
  scanner.captureProcessingMs = 0;
  const pose = scanner.keyframePose(view);
  scanner.recordCameraMotion(pose, 1100);
  scanner.recordCameraMotion({ ...pose, position: { ...pose.position, x: pose.position.x + 0.15 } }, 1120);
  scanner.frame(1140, frame);
  expect(scanner.stats.frameQuality).toBe("moving-too-fast");
  const reads = frame.getDepthInformation.mock.calls.length;
  scanner.recordCameraMotion(pose, 1230);
  scanner.recordCameraMotion(pose, 1260);
  scanner.recordCameraMotion(pose, 1280);
  scanner.frame(1300, frame);
  expect(frame.getDepthInformation).toHaveBeenCalledTimes(reads + 1);
  expect(scanner.stats.frameQuality).toBe("connected");
  expect(scanner.stats.captureIntervalMs).toBeLessThan(350);
});

test("three brief motion skips preserve the saved map and resume without recovery prompts", () => {
  const { scanner, frame, view } = captureHarness();
  const pose = scanner.keyframePose(view);
  const frames = scanner.keyframes.slice();
  for (const time of [1340, 1480, 1620]) {
    scanner.recordCameraMotion(pose, time - 40);
    scanner.recordCameraMotion({ ...pose, position: { ...pose.position, x: 0.15 } }, time - 20);
    scanner.recordCameraMotion(pose, time);
    scanner.captureDepthFrame(time, frame, view);
  }
  expect(scanner.stats.captureDiagnostics.decisions["moving-too-fast"]).toBe(3);
  expect(scanner.stats.captureDiagnostics.promptCount).toBe(0);
  expect(scanner.stats.adaptiveCapture.recoveries).toBe(0);
  expect(scanner.keyframes).toEqual(frames);
  scanner.frame(1900, frame);
  expect(scanner.stats.frameQuality).toBe("connected");
  expect(scanner.stats.currentViewChecked).toBe(true);
  expect(scanner.stats.adaptiveCapture.state).toBe("tracking");
  expect(scanner.stats.captureDiagnostics.attempts).toBe(6);
});

test("a soft skip between reliable recovery observations does not restart reconnection", () => {
  const { scanner, frame, view, setEmulated } = captureHarness();
  setEmulated(true);
  scanner.frame(1300, frame);
  setEmulated(false);
  scanner.frame(1600, frame);
  expect(scanner.stats.frameQuality).toBe("confirming-recovery");
  const pose = scanner.keyframePose(view);
  scanner.recordCameraMotion(pose, 1700);
  scanner.recordCameraMotion({ ...pose, position: { ...pose.position, x: 0.15 } }, 1720);
  scanner.recordCameraMotion(pose, 1740);
  scanner.captureDepthFrame(1740, frame, view);
  expect(scanner.stats.frameQuality).toBe("moving-too-fast");
  scanner.frame(2050, frame);
  expect(scanner.stats.adaptiveCapture.state).toBe("tracking");
  expect(scanner.stats.adaptiveCapture.recoveries).toBe(1);
  expect(scanner.stats.captureDiagnostics.prompts.reconnect).toBe(0);
});

test("missing depth is counted cumulatively even after sensor acquisition resumes", () => {
  const { scanner, frame, view } = captureHarness();
  const missing = { getDepthInformation: () => null };
  scanner.captureDepthFrame(1400, missing, view);
  scanner.captureDepthFrame(1600, missing, view);
  scanner.captureDepthFrame(1800, frame, view);
  expect(scanner.stats.depthMisses).toBe(0);
  expect(scanner.stats.totalDepthMisses).toBe(2);
  expect(scanner.stats.captureDiagnostics.decisions["depth-missing"]).toBe(2);
  expect(scanner.stats.captureDiagnostics.attempts).toBe(5);
});

test("the amber target is reserved for sustained reconnection, not routine coverage or confirmation", () => {
  const { scanner, view } = captureHarness();
  scanner.recoveryMarker = { visible: true, position: { fromArray: jest.fn() } };
  scanner.updateRecoveryTarget(view);
  expect(scanner.recoveryMarker.visible).toBe(false);
  scanner.capture.failure("tracking-lost", 1400);
  scanner.updateAdaptiveStats(1400);
  scanner.updateRecoveryTarget(view);
  expect(scanner.recoveryMarker.visible).toBe(false);
  scanner.updateExperience(2300);
  scanner.updateRecoveryTarget(view);
  expect(scanner.recoveryMarker.visible).toBe(false);
  scanner.updateExperience(3300);
  scanner.updateRecoveryTarget(view);
  expect(scanner.recoveryMarker.visible).toBe(true);
  expect(scanner.stats.recoveryDirection).not.toMatch(/amber/);
  scanner.stats.frameQuality = "confirming-recovery";
  scanner.updateExperience(2400);
  scanner.updateRecoveryTarget(view);
  expect(scanner.recoveryMarker.visible).toBe(false);
});

test("a shifted depth layer is withheld and does not increment accepted capture counts", () => {
  const { scanner, frame, setDepth } = captureHarness();
  const accepted = scanner.stats.acceptedDepthFrames;
  setDepth(2.25);
  scanner.frame(1500, frame);
  expect(scanner.keyframes).toHaveLength(2);
  expect(scanner.stats.acceptedDepthFrames).toBe(accepted);
  expect(scanner.stats.rejectedDepthFrames).toBeGreaterThan(0);
  expect(scanner.stats.adaptiveCapture.state).toBe("recovering");
});

test("faster depth sampling does not perform synchronous RGB readback every frame", () => {
  const { scanner, frame, view } = captureHarness();
  scanner.binding = {};
  scanner.renderer = { getContext: () => ({}), resetState: () => {} };
  view.camera = { width: 360, height: 720 };
  scanner.colorReader = { read: jest.fn(() => null) };
  scanner.captureDepthFrame(1500, frame, view);
  scanner.captureDepthFrame(1630, frame, view);
  scanner.captureDepthFrame(1760, frame, view);
  scanner.captureDepthFrame(1890, frame, view);
  expect(scanner.colorReader.read).toHaveBeenCalledTimes(2);
  expect(scanner.keyframes).toHaveLength(2);
});

test("nearby overlapping views with a shifted surface are rejected live", () => {
  const scanner = new RoomScanner({ onUpdate: () => {} });
  scanner.lastMeshPose = {
    position: { x: 0, y: 1.6, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  const pose = {
    position: { x: 0.1, y: 1.6, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  expect(
    scanner.shouldRejectPose(
      {
        compared: 180,
        overlapRatio: 0.65,
        medianDistance: 0.07,
        upperDistance: 0.11,
      },
      pose,
    ),
  ).toBe(true);
  expect(
    scanner.shouldRejectPose(
      {
        compared: 180,
        overlapRatio: 0.65,
        medianDistance: 0.025,
        upperDistance: 0.05,
      },
      pose,
    ),
  ).toBe(false);
});
