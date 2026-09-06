import { createRgbdKeyframe, fuseRgbdKeyframes } from "./fusion";

function grid(depthAt = () => 0) {
  const points = [];
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++)
      points.push({
        x: x * 0.08,
        y: y * 0.08,
        z: depthAt(x, y),
        gridX: x,
        gridY: y,
        gridColumns: 3,
        gridRows: 3,
        color: [200, 100, 50],
      });
  return points;
}

test("stores a compact transferable RGB-D keyframe instead of a frame mesh", () => {
  const frame = createRgbdKeyframe(grid(), {
    columns: 3,
    rows: 3,
    projectionMatrix: Array(16).fill(0),
    transformMatrix: Array(16).fill(0),
    camera: { x: 1, y: 2, z: 3 },
    timestamp: 42,
  });
  expect(frame.validCount).toBe(9);
  expect(frame.positions).toHaveLength(27);
  expect(frame.depths).toHaveLength(9);
  expect(frame.camera).toEqual(new Float32Array([1, 2, 3]));
  expect(frame.timestamp).toBe(42);
});

test("returns a safe no-mesh result when depth coverage is too small", () => {
  const result = fuseRgbdKeyframes([], { floorY: 0 });
  expect(result.mesh).toBeNull();
  expect(result.diagnostics.reason).toMatch(/Not enough/i);
});

test("fuses repeated RGB-D views into one bounded surface", () => {
  const points = [];
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++)
      points.push({
        x: (x - 5.5) * 0.08,
        y: (y - 5.5) * 0.08,
        z: 2,
        depth: 2,
        color: [180, 120, 80],
        gridX: x,
        gridY: y,
        gridColumns: 12,
        gridRows: 12,
      });
  const keyframes = [0, 0.08, -0.08].map((cameraX, timestamp) =>
    createRgbdKeyframe(points, {
      columns: 12,
      rows: 12,
      camera: { x: cameraX, y: 0, z: 0 },
      timestamp,
    }),
  );
  const result = fuseRgbdKeyframes(keyframes, { floorY: 0 });
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  expect(result.mesh.triangleCount).toBeLessThan(140001);
  expect(result.mesh.colorCoverage).toBe(100);
});
