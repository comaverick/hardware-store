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
  // One deliberate pause saves a confirmation frame, but additional transient
  // frames from the same pose cannot flood fusion with redundant observations.
  scanner.frame(3500, frame);
  expect(scanner.keyframes).toHaveLength(3);
  scanner.frame(5000, frame);
  expect(scanner.keyframes).toHaveLength(3);
  expect(scanner.stats.errors).toEqual([]);
});
