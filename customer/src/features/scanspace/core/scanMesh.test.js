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

function planeKeyframe(
  cameraX = 0,
  withColor = true,
  centerMissing = false,
  phantomPatch = false,
  surfaceDepth = 2,
) {
  const points = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (
        (centerMissing === true && x >= 6 && x <= 9 && y >= 6 && y <= 9) ||
        (centerMissing === "single" && x === 8 && y === 8)
      )
        continue;
      const u = (x + 0.5) / 16;
      const v = (y + 0.5) / 16;
      const phantomDepth = typeof phantomPatch === "number" ? phantomPatch : 0.62;
      const depth = phantomPatch && x < 5 && y < 5
        ? phantomDepth
        : surfaceDepth;
      points.push({
        x: cameraX + (u * 2 - 1) * depth,
        y: (1 - v * 2) * depth,
        z: -depth,
        depth,
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

test("rejects a drifted pose without losing the consistent wall", () => {
  const result = fuseRgbdKeyframes(
    [planeKeyframe(0), planeKeyframe(0.08), planeKeyframe(-0.08), planeKeyframe(8)],
    { floorY: 0 },
  );
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  expect(result.diagnostics.rejectedKeyframes).toBeGreaterThanOrEqual(1);
});

test("preserves a broad unmeasured opening in an otherwise stable wall", () => {
  const result = fuseRgbdKeyframes(
    [
      planeKeyframe(0, true, true),
      planeKeyframe(0.08, true, true),
      planeKeyframe(-0.08, true, true),
    ],
    { floorY: 0 },
  );
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  let centerTriangles = 0;
  for (let index = 0; index < result.mesh.indices.length; index += 3) {
    const vertices = [
      result.mesh.indices[index],
      result.mesh.indices[index + 1],
      result.mesh.indices[index + 2],
    ];
    const centerX = vertices.reduce(
      (sum, vertex) => sum + result.mesh.positions[vertex * 3] / 3,
      0,
    );
    const centerY = vertices.reduce(
      (sum, vertex) => sum + result.mesh.positions[vertex * 3 + 1] / 3,
      0,
    );
    if (Math.abs(centerX) < 0.2 && Math.abs(centerY) < 0.2)
      centerTriangles++;
  }
  expect(centerTriangles).toBe(0);
});

test("repairs an isolated depth dropout without opening a hole in the wall", () => {
  const result = fuseRgbdKeyframes(
    [
      planeKeyframe(0, true, "single"),
      planeKeyframe(0.08, true, "single"),
      planeKeyframe(-0.08, true, "single"),
    ],
    { floorY: 0 },
  );
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  let centerTriangles = 0;
  for (let index = 0; index < result.mesh.indices.length; index += 3) {
    const vertices = [
      result.mesh.indices[index],
      result.mesh.indices[index + 1],
      result.mesh.indices[index + 2],
    ];
    const centerX = vertices.reduce(
      (sum, vertex) => sum + result.mesh.positions[vertex * 3] / 3,
      0,
    );
    const centerY = vertices.reduce(
      (sum, vertex) => sum + result.mesh.positions[vertex * 3 + 1] / 3,
      0,
    );
    if (Math.abs(centerX) < 0.2 && Math.abs(centerY) < 0.2)
      centerTriangles++;
  }
  expect(centerTriangles).toBeGreaterThan(0);
});

test("rejects a repeatedly reported near-field phantom contradicted by clear views", () => {
  const keyframes = [
    planeKeyframe(0),
    planeKeyframe(0.04, true, false, true),
    planeKeyframe(-0.04, true, false, true),
    planeKeyframe(0.08, true, false, true),
    planeKeyframe(-0.08, true, false, true),
    planeKeyframe(0.12),
    planeKeyframe(-0.12),
    planeKeyframe(0.16),
    planeKeyframe(-0.16),
  ];
  const result = fuseRgbdKeyframes(keyframes, { floorY: 0 });
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  let closestSurface = -Infinity;
  for (let index = 2; index < result.mesh.positions.length; index += 3)
    closestSurface = Math.max(closestSurface, result.mesh.positions[index]);
  expect(closestSurface).toBeLessThan(-1.2);
});

test("rejects a ghost surface behind a wall when nearer depth occludes it", () => {
  const keyframes = [
    planeKeyframe(0),
    planeKeyframe(0.04, true, false, 3.4),
    planeKeyframe(-0.04, true, false, 3.4),
    planeKeyframe(0.08, true, false, 3.4),
    planeKeyframe(-0.08, true, false, 3.4),
    planeKeyframe(0.12),
    planeKeyframe(-0.12),
    planeKeyframe(0.16),
    planeKeyframe(-0.16),
  ];
  const result = fuseRgbdKeyframes(keyframes, { floorY: 0 });
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  let farthestSurface = Infinity;
  for (let index = 2; index < result.mesh.positions.length; index += 3)
    farthestSurface = Math.min(farthestSurface, result.mesh.positions[index]);
  expect(farthestSurface).toBeGreaterThan(-2.8);
});

test("preserves a measured back surface through ordinary furniture-depth occlusion", () => {
  const result = fuseRgbdKeyframes(
    [
      planeKeyframe(0),
      planeKeyframe(0.05),
      planeKeyframe(-0.05),
      ...[0.08, -0.08, 0.11, -0.11, 0.14, -0.14, 0.17].map(
        (cameraX) => planeKeyframe(cameraX, true, false, 1.45),
      ),
    ],
    { floorY: 0 },
  );
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  let backVertices = 0;
  for (let index = 0; index < result.mesh.positions.length; index += 3)
    if (
      result.mesh.positions[index] < -0.55 &&
      result.mesh.positions[index + 1] > 0.55 &&
      result.mesh.positions[index + 2] < -1.8
    )
      backVertices++;
  expect(backVertices).toBeGreaterThan(0);
});

test("uses a continuous measured surface instead of dots when strict close-range fusion cannot mesh", () => {
  const result = fuseRgbdKeyframes(
    [0, 0.04, -0.04].map((cameraX) =>
      planeKeyframe(cameraX, true, false, false, 0.62),
    ),
    { floorY: 0 },
  );
  expect(result.mesh?.triangleCount).toBeGreaterThan(100);
  expect(result.mesh.kind).toBe("measured-depth-surface");
  expect(result.diagnostics.fallback).toBe("strongest-measured-view");
});

test("uses one measured view instead of dots when captured poses cannot be aligned", () => {
  const result = fuseRgbdKeyframes(
    [planeKeyframe(0), planeKeyframe(8)],
    { floorY: 0 },
  );
  expect(result.mesh?.triangleCount).toBeGreaterThan(100);
  expect(result.mesh.kind).toBe("measured-depth-surface");
  expect(result.diagnostics.overlappingKeyframes).toBe(1);
});
