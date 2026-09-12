import { PerspectiveCamera, Matrix4 } from "three";
import { RoomScanner } from "./RoomScanner";

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
  expect(scanner.keyframes[24].colorImage).not.toBeNull();
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
  expect(scanner.keyframes[4].colorImage).not.toBeNull();
});
