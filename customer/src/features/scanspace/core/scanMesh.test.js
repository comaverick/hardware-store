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

const projection = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -1, -1,
  0, 0, -0.2, 0,
]);

function planeKeyframe(cameraX = 0, withColor = true) {
  const points = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const u = (x + 0.5) / 16;
      const v = (y + 0.5) / 16;
      points.push({
        x: cameraX + (u * 2 - 1) * 2,
        y: (1 - v * 2) * 2,
        z: -2,
        depth: 2,
        color: withColor ? [180, 120, 80] : undefined,
        gridX: x,
        gridY: y,
        gridColumns: 16,
        gridRows: 16,
      });
    }
  const transform = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    cameraX, 0, 0, 1,
  ]);
  return createRgbdKeyframe(points, {
    columns: 16,
    rows: 16,
    projectionMatrix: projection,
    transformMatrix: transform,
    camera: { x: cameraX, y: 0, z: 0 },
    colorImage: withColor
      ? { data: new Uint8Array(8 * 8 * 4).fill(180), width: 8, height: 8, channels: 4 }
      : null,
  });
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
  expect(result.diagnostics.reason).toMatch(/required|Not enough/i);
});

test("fuses repeated RGB-D views into one bounded surface", () => {
  const keyframes = [0, 0.08, -0.08].map(planeKeyframe);
  const result = fuseRgbdKeyframes(keyframes, { floorY: 0 });
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  expect(result.mesh.kind).toBe("projective-tsdf-surface-net");
  expect(result.mesh.textureCoverage).toBeGreaterThan(90);
  expect(result.mesh.uvs).toHaveLength(result.mesh.vertexCount * 2);
  expect(result.mesh.texture.data.length).toBeGreaterThan(0);
  expect(result.mesh.normals).toHaveLength(result.mesh.positions.length);
});

test("does not fabricate a mesh from an unconfirmed single camera view", () => {
  const keyframe = planeKeyframe(0, false);
  expect(fuseRgbdKeyframes([keyframe], { floorY: 0 }).mesh).toBeNull();
});
