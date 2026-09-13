import { PerspectiveCamera, Matrix4 } from "three";
import {
  coveragePreviewSize,
  KEYFRAME_RETENTION_TRIGGER,
  MAX_FUSION_KEYFRAMES,
  RoomScanner,
  selectKeyframesForRetention,
} from "./RoomScanner";

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
  expect(scanner.stats.textureKeyframes).toBe(18);
  expect(scanner.keyframes[0].colorImage).not.toBeNull();
  expect(
    scanner.keyframes.slice(-2).some((frame) => frame.colorImage !== null),
  ).toBe(true);
});

test("texture compaction keeps the sharpest low-motion frame in each scan sector", () => {
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
  expect(scanner.keyframes[0].colorImage).not.toBeNull();
  expect(scanner.keyframes[2].colorImage).not.toBeNull();
  expect(scanner.keyframes[3].colorImage).not.toBeNull();
  expect(scanner.keyframes[4].colorImage).toBeNull();
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
