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

test("short out-and-back camera motion is detected without changing depth acceptance", () => {
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
  expect(scanner.keyframes).toHaveLength(1);
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

test("confirmed coverage splats overlap a normal preview voxel without becoming huge", () => {
  expect(coveragePreviewSize(0.08)).toBeGreaterThan(0.08);
  expect(coveragePreviewSize(0.08)).toBeLessThanOrEqual(0.12);
  expect(coveragePreviewSize(0.18)).toBeLessThanOrEqual(0.22);
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
  // Stay inside the same geometry-keyframe pose, but prove that the refreshed
  // camera image keeps the exact later color pose instead of borrowing the
  // original depth pose.
  view.transform.position.x = 0.02;
  view.transform.matrix = new Matrix4().makeTranslation(0.02, 1.6, 0).elements;
  scanner.captureDepthFrame(1000, frame, view);
  expect(scanner.colorReader.read).toHaveBeenCalledTimes(2);
  expect(scanner.keyframes).toHaveLength(1);
  expect(add).toHaveBeenCalledTimes(1);
  expect(scanner.stats.textureRefreshes).toBe(1);
  expect(scanner.keyframes[0].colorFocus).toBe(20);
  expect(scanner.keyframes[0].colorImage[0]).toBe(160);
  expect(scanner.keyframes[0].transformMatrix[12]).toBeCloseTo(0);
  expect(scanner.keyframes[0].viewTransformMatrix[12]).toBeCloseTo(0.02);
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
