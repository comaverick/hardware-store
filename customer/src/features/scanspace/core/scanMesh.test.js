import {
  createRgbdKeyframe,
  depthPosition,
  filterDepth,
  fillSmallMeshHoles,
  fuseRgbdKeyframes,
  gridIndex,
  sampleProjectiveDepth,
  meshFragmentationIsUnacceptable,
  meshOutsideRectangularRoomModel,
  meshWallStructureDiagnostics,
  projectWorld,
} from "./fusion";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { unprojectDepth } from "./depth";

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

test("subpixel sampling preserves an oblique plane instead of depth steps", () => {
  const columns = 32, rows = 24;
  const exactDepth = (u, v) => 1 / (0.5 + 0.22 * (u - 0.5) + 0.08 * (v - 0.5));
  const frame = { columns, rows, filteredDepth: new Float32Array(columns * rows) };
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++)
      frame.filteredDepth[y * columns + x] = exactDepth((x + 0.5) / columns, (y + 0.5) / rows);
  let oldError = 0, correctedError = 0;
  for (let y = 1; y < rows - 2; y++)
    for (let x = 1; x < columns - 2; x++) {
      const u = (x + 0.91) / columns, v = (y + 0.83) / rows;
      const expected = exactDepth(u, v);
      oldError += Math.abs(frame.filteredDepth[gridIndex(frame, u, v)] - expected);
      correctedError += Math.abs(sampleProjectiveDepth(frame, u, v) - expected);
    }
  expect(oldError).toBeGreaterThan(1);
  expect(correctedError).toBeLessThan(oldError * 0.001);
});

test("subpixel sampling does not blend across an occlusion or missing depth", () => {
  const frame = { columns: 2, rows: 2, filteredDepth: new Float32Array([1, 2, 1, 2]) };
  expect(sampleProjectiveDepth(frame, 0.49, 0.5)).toBe(1);
  expect(sampleProjectiveDepth(frame, 0.51, 0.5)).toBe(2);
  frame.filteredDepth = new Float32Array([0, 2, 2, 2]);
  expect(sampleProjectiveDepth(frame, 0.4, 0.4)).toBe(0);
  expect(sampleProjectiveDepth(frame, 0.6, 0.4)).toBe(2);
});

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

test("retains a real depth edge supported by two agreeing neighbors", () => {
  const depths = new Float32Array(25);
  [2, 7, 12, 17, 22].forEach((index) => {
    depths[index] = 2;
  });
  const result = filterDepth({ columns: 5, rows: 5, depths });
  expect(result.filtered[12]).toBeCloseTo(2);
  expect(result.confidence[12]).toBeGreaterThan(0);
  expect(result.weakSupportedCount).toBeGreaterThan(0);
});

test("does not retain an isolated or depth-discontinuous sample", () => {
  const depths = new Float32Array(25);
  depths[12] = 2;
  depths[7] = 1;
  depths[17] = 3;
  const result = filterDepth({ columns: 5, rows: 5, depths });
  expect(result.filtered[12]).toBe(0);
});

function gridPlaneWithMissingCell(missingColumn, missingRow) {
  const positions = [];
  const colors = [];
  const indices = [];
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4; column++) {
      positions.push(column / 3, row / 3, 0);
      colors.push(120, 160, 140);
    }
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++) {
      if (column === missingColumn && row === missingRow) continue;
      const first = row * 4 + column;
      indices.push(
        first,
        first + 4,
        first + 1,
        first + 1,
        first + 4,
        first + 5,
      );
    }
  return {
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    surfaceArea: 8 / 9,
  };
}

test("fills a small closed planar hole in the extracted mesh", () => {
  const mesh = gridPlaneWithMissingCell(1, 1);
  const repaired = fillSmallMeshHoles(mesh, { maxDiameter: 0.5 });
  expect(repaired.filledHoleCount).toBe(1);
  expect(repaired.filledHoleTriangles).toBe(4);
  expect(repaired.indices.length).toBe(mesh.indices.length + 12);
  expect(repaired.positions.length).toBe(mesh.positions.length + 3);
});

test("does not fill a hole connected to the mesh boundary", () => {
  const mesh = gridPlaneWithMissingCell(1, 0);
  const repaired = fillSmallMeshHoles(mesh, { maxDiameter: 0.5 });
  expect(repaired.filledHoleCount).toBe(0);
  expect(repaired.indices).toEqual(mesh.indices);
});

test("rejects a mesh made from many similarly sized floating islands", () => {
  expect(
    meshFragmentationIsUnacceptable({
      keptComponentCount: 12,
      dominantAreaRatio: 0.24,
    }),
  ).toBe(true);
  expect(
    meshFragmentationIsUnacceptable({
      keptComponentCount: 3,
      dominantAreaRatio: 0.8,
    }),
  ).toBe(false);
});

test("distinguishes planar room walls from a curled shell", () => {
  const plane = {
    positions: new Float32Array([
      -1, 0, -2, 1, 0, -2, 1, 2, -2, -1, 2, -2,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
  expect(
    meshOutsideRectangularRoomModel(meshWallStructureDiagnostics(plane)),
  ).toBe(false);

  const positions = [];
  const indices = [];
  const segments = 36;
  for (let segment = 0; segment < segments; segment++) {
    const angle = (segment / segments) * Math.PI * 2;
    positions.push(Math.cos(angle), 0, Math.sin(angle));
    positions.push(Math.cos(angle), 2, Math.sin(angle));
  }
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    const bottom = segment * 2;
    const top = bottom + 1;
    const nextBottom = next * 2;
    const nextTop = nextBottom + 1;
    indices.push(bottom, nextBottom, top, top, nextBottom, nextTop);
  }
  const shell = meshWallStructureDiagnostics({
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  });
  expect(shell.manhattanAlignedRatio).toBeLessThan(0.52);
  expect(meshOutsideRectangularRoomModel(shell)).toBe(true);
});

test.each([
  ["identity", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
  ["90 degrees", [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]],
  ["180 degrees", [-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1]],
  ["270 degrees", [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]],
  ["crop and scale", [0.7, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 1, 0, 0.12, 0.2, 0, 1]],
])("view-grid points round trip with a native %s depth mapping", (_, nativeMatrix) => {
  const camera = new PerspectiveCamera(73, 12 / 7, 0.1, 20);
  const projectionMatrix = [...camera.projectionMatrix.elements];
  projectionMatrix[8] = 0.11;
  projectionMatrix[9] = -0.07;
  const transform = new Matrix4().makeRotationY(0.31);
  transform.setPosition(1.3, 0.4, -0.8);
  const view = {
    projectionMatrix,
    transform: { matrix: transform.elements },
  };
  const points = unprojectDepth(
    {
      getDepthInMeters: () => 2.4,
      projectionMatrix,
      transform: { matrix: new Matrix4().makeTranslation(20, 0, 0).elements },
      normDepthBufferFromNormView: { matrix: nativeMatrix },
    },
    view,
    12,
    7,
  );
  const frame = createRgbdKeyframe(points, {
    columns: 12,
    rows: 7,
    projectionMatrix,
    transformMatrix: transform.elements,
    nativeDepthUvTransform: nativeMatrix,
  });
  points.forEach((point) => {
    const index = point.gridY * frame.columns + point.gridX;
    const reconstructed = depthPosition(frame, index, frame.depths[index]);
    const projected = projectWorld(frame, ...reconstructed);
    expect(gridIndex(frame, projected.u, projected.v)).toBe(index);
    expect(reconstructed[0]).toBeCloseTo(point.x, 5);
    expect(reconstructed[1]).toBeCloseTo(point.y, 5);
    expect(reconstructed[2]).toBeCloseTo(point.z, 5);
  });
});

test("fuses repeated RGB-D views into one bounded surface", () => {
  const keyframes = [0, 0.08, -0.08].map((x) => planeKeyframe(x));
  const result = fuseRgbdKeyframes(keyframes, { floorY: 0 });
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  expect(result.mesh.kind).toBe("projective-tsdf-surface-net");
  expect(result.mesh.textureCoverage).toBeGreaterThan(90);
  expect(result.mesh.uvs).toHaveLength(result.mesh.vertexCount * 2);
  expect(result.mesh.texture.data.length).toBeGreaterThan(0);
  expect(result.mesh.normals).toHaveLength(result.mesh.positions.length);
  expect(
    result.diagnostics.roundTrip.every(
      (frame) => frame.checked > 100 && frame.indexMismatches === 0,
    ),
  ).toBe(true);
});

test("filtered positions preserve a rotated wall captured with an off-axis projection", () => {
  const camera = new PerspectiveCamera(80, 1, 0.1, 20);
  const projectionMatrix = [...camera.projectionMatrix.elements];
  projectionMatrix[8] = 0.15;
  projectionMatrix[9] = -0.08;
  const angle = 0.3;
  const frames = [0, 0.08, -0.08].map((x) => {
    const transform = new Matrix4().makeRotationY(angle);
    transform.setPosition(x * Math.cos(angle), 0, -x * Math.sin(angle));
    const view = { projectionMatrix, transform: { matrix: transform.elements } };
    return createRgbdKeyframe(unprojectDepth(
      { getDepthInMeters: () => 2 }, view, 16, 16,
    ), { columns: 16, rows: 16, projectionMatrix, transformMatrix: transform.elements });
  });
  const result = fuseRgbdKeyframes(frames);
  expect(result.mesh?.kind).toBe("projective-tsdf-surface-net");
  for (let i = 0; i < result.mesh.positions.length; i += 3) {
    const normalDistance = Math.sin(angle) * result.mesh.positions[i] +
      Math.cos(angle) * result.mesh.positions[i + 2];
    expect(Math.abs(normalDistance + 2)).toBeLessThan(0.06);
  }
});

test("a wall viewed obliquely from different camera poses remains planar", () => {
  const camera = new PerspectiveCamera(65, 0.65, 0.1, 20);
  const normal = new Vector3(0.45, 0.18, 1);
  const frames = [-0.15, 0, 0.15].map((x) => {
    const pose = new Matrix4().makeRotationY(x * 0.6);
    pose.setPosition(x, 0, 0);
    const origin = new Vector3(x, 0, 0);
    const view = { projectionMatrix: camera.projectionMatrix.elements, transform: { matrix: pose.elements } };
    const points = unprojectDepth({ getDepthInMeters: (u, v) => {
      const ray = new Vector3(u * 2 - 1, 1 - v * 2, 0.5)
        .applyMatrix4(camera.projectionMatrixInverse);
      ray.multiplyScalar(1 / -ray.z);
      ray.applyMatrix4(pose).sub(origin);
      return -(2.5 + normal.dot(origin)) / normal.dot(ray);
    } }, view, 28, 40);
    return createRgbdKeyframe(points, {
      columns: 28, rows: 40,
      projectionMatrix: view.projectionMatrix,
      transformMatrix: pose.elements,
      camera: origin,
    });
  });
  const result = fuseRgbdKeyframes(frames, { maxDimension: 64 });
  expect(result.mesh?.kind).toBe("projective-tsdf-surface-net");
  let checked = 0, squaredError = 0;
  const p = result.mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i]) > 0.6 || Math.abs(p[i + 1]) > 0.6) continue;
    const error = (normal.x * p[i] + normal.y * p[i + 1] + p[i + 2] + 2.5) / normal.length();
    squaredError += error * error;
    checked++;
  }
  expect(checked).toBeGreaterThan(100);
  expect(Math.sqrt(squaredError / checked)).toBeLessThan(0.015);
});

test("refuses to finish when room-direction coverage is incomplete", () => {
  const keyframe = planeKeyframe(0, false);
  const result = fuseRgbdKeyframes([keyframe], {
    floorY: 0,
    headingCoverage: 25,
  });
  expect(result.mesh).toBeNull();
  expect(result.diagnostics.reason).toMatch(/Reach at least 75%/);
  expect(result.diagnostics.fallback).toBeUndefined();
});

test("rejects a drifted pose without losing the consistent wall", () => {
  const result = fuseRgbdKeyframes(
    [planeKeyframe(0), planeKeyframe(0.08), planeKeyframe(-0.08), planeKeyframe(8)],
    { floorY: 0 },
  );
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  expect(result.diagnostics.rejectedKeyframes).toBeGreaterThanOrEqual(1);
  expect(result.observations.count).toBeGreaterThan(0);
  expect(Math.max(...result.observations.positions)).toBeLessThan(3);
});

test("uses depth geometry for visibility and camera geometry for color UVs", () => {
  const frames = [0, 0.08, -0.08].map((x) => {
    const frame = planeKeyframe(x);
    frame.viewTransformMatrix = new Float32Array(frame.transformMatrix);
    frame.viewTransformMatrix[14] += 0.3;
    return frame;
  });
  const result = fuseRgbdKeyframes(frames);
  expect(result.mesh?.kind).toBe("projective-tsdf-surface-net");
  expect(result.mesh.textureCoverage).toBeGreaterThan(90);
});

test("resamples different camera image sizes into valid atlas tiles", () => {
  const frames = [0, 0.08, -0.08].map((x, index) => {
    const frame = planeKeyframe(x);
    if (index === 1) {
      frame.colorWidth = 4;
      frame.colorHeight = 6;
      frame.colorImage = new Uint8Array(4 * 6 * 4).fill(140);
    }
    return frame;
  });
  const result = fuseRgbdKeyframes(frames);
  expect(result.mesh?.texture.data.length).toBeGreaterThan(0);
  expect(Math.min(...result.mesh.texture.data)).toBeGreaterThan(0);
});

test("a bad first frame cannot force a valid overlapping sequence into fallback", () => {
  const result = fuseRgbdKeyframes(
    [planeKeyframe(8), planeKeyframe(0), planeKeyframe(0.08), planeKeyframe(-0.08)],
    { floorY: 0 },
  );
  expect(result.mesh?.triangleCount).toBeGreaterThan(0);
  expect(result.mesh.kind).toBe("projective-tsdf-surface-net");
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

function measuredBackArea(mesh) {
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const points = [0, 1, 2].map((corner) => {
      const offset = mesh.indices[i + corner] * 3;
      return Array.from(mesh.positions.slice(offset, offset + 3));
    });
    const center = [0, 1, 2].map((axis) =>
      (points[0][axis] + points[1][axis] + points[2][axis]) / 3);
    if (center[0] <= -1.6 || center[0] >= -1.05 ||
        center[1] <= 1.05 || center[1] >= 1.6 ||
        Math.abs(center[2] + 2) >= 0.05) continue;
    const a = points[1].map((v, axis) => v - points[0][axis]);
    const b = points[2].map((v, axis) => v - points[0][axis]);
    area += Math.hypot(a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) / 2;
  }
  return area;
}

test.each([1, 0.6])("preserves at least 85%% of a wall later occluded at %sm", (depth) => {
  // This exact visible wall region used to go from 0.302m² to zero solely
  // because ten later views saw an object in front of it.
  const frames = [0, 0.05, -0.05].map((x) => planeKeyframe(x));
  const baseline = fuseRgbdKeyframes(frames).mesh;
  const result = fuseRgbdKeyframes([
    ...frames,
    ...[0.08, -0.08, 0.11, -0.11, 0.14, -0.14, 0.17, -0.17, 0.2, -0.2]
      .map((x) => planeKeyframe(x, true, false, depth)),
  ]);
  expect(result.mesh?.kind).toBe("projective-tsdf-surface-net");
  expect(measuredBackArea(result.mesh)).toBeGreaterThan(measuredBackArea(baseline) * 0.85);
});

test("rejects a 14cm pose error that passes the spatial-neighbor overlap check", () => {
  const shifted = planeKeyframe(0.04);
  shifted.transformMatrix[14] = 0.14;
  const result = fuseRgbdKeyframes([
    planeKeyframe(0), shifted, planeKeyframe(0.08), planeKeyframe(-0.08),
  ]);
  expect(result.mesh?.kind).toBe("projective-tsdf-surface-net");
  expect(result.diagnostics.alignment.rejectedFrameIds).toContain(1);
  expect(result.diagnostics.alignment.pairs.some((pair) =>
    (pair.firstFrame === 1 || pair.secondFrame === 1) && !pair.accepted)).toBe(true);
  expect(result.mesh.bounds.max.z).toBeLessThan(-1.95);
});

test("rejects a frame when only one quarter of its wall depth agrees", () => {
  const mostlyShifted = planeKeyframe(0.04);
  for (let y = 0; y < mostlyShifted.rows; y++)
    for (let x = 4; x < mostlyShifted.columns; x++)
      mostlyShifted.depths[y * mostlyShifted.columns + x] = 2.14;
  const result = fuseRgbdKeyframes([
    planeKeyframe(0),
    mostlyShifted,
    planeKeyframe(0.08),
    planeKeyframe(-0.08),
  ]);
  expect(result.mesh?.kind).toBe("projective-tsdf-surface-net");
  expect(result.diagnostics.alignment.rejectedFrameIds).toContain(1);
});

test("does not mutate accepted poses without explicit validated refinement", () => {
  const drifted = planeKeyframe(0.04);
  const angle = 0.025;
  drifted.transformMatrix[0] = Math.cos(angle);
  drifted.transformMatrix[2] = -Math.sin(angle);
  drifted.transformMatrix[8] = Math.sin(angle);
  drifted.transformMatrix[10] = Math.cos(angle);
  drifted.transformMatrix[12] += 0.025;
  drifted.transformMatrix[14] += 0.025;
  const originalPose = new Float32Array(drifted.transformMatrix);
  const result = fuseRgbdKeyframes([
    planeKeyframe(0),
    planeKeyframe(0.08),
    drifted,
    planeKeyframe(-0.08),
  ]);
  expect(result.mesh?.kind).toBe("projective-tsdf-surface-net");
  expect(result.diagnostics.alignment.poseCorrectionApplied).toBe(false);
  expect(result.diagnostics.alignment.poseRefinement).toBe(
    "disabled-until-independently-validated",
  );
  expect(drifted.transformMatrix).toEqual(originalPose);
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

test("refuses a close-range capture when strict fusion cannot make a reliable mesh", () => {
  const result = fuseRgbdKeyframes(
    [0, 0.04, -0.04].map((cameraX) =>
      planeKeyframe(cameraX, true, false, false, 0.62),
    ),
    { floorY: 0 },
  );
  expect(result.mesh).toBeNull();
  expect(result.diagnostics.reason).toMatch(/reliable|overlap|surface/i);
  expect(result.diagnostics.fallback).toBeUndefined();
});

test("does not substitute a single-view mesh when close-range fusion fails", () => {
  const result = fuseRgbdKeyframes(
    [0, 0.04, -0.04].map((x) => planeKeyframe(x, true, "single", false, 0.62)),
  );
  expect(result.mesh).toBeNull();
  expect(result.diagnostics.fallback).toBeUndefined();
});

test("one-wall coverage cannot bypass the room completion gate", () => {
  const reference = planeKeyframe(0, true, true);
  const result = fuseRgbdKeyframes([
    reference,
    planeKeyframe(0.08, false),
    planeKeyframe(-0.08, false),
  ], { floorY: 0, headingCoverage: 25 });
  expect(result.mesh).toBeNull();
  expect(result.diagnostics.reason).toMatch(/75%/);
  expect(result.diagnostics.fallback).toBeUndefined();
});

test("refuses a result when captured poses cannot be aligned", () => {
  const result = fuseRgbdKeyframes(
    [planeKeyframe(0), planeKeyframe(8)],
    { floorY: 0 },
  );
  expect(result.mesh).toBeNull();
  expect(result.diagnostics.overlappingKeyframes).toBe(1);
  expect(result.diagnostics.fallback).toBeUndefined();
});

test("same-position frames cannot masquerade as independent fusion support", () => {
  const repeated = planeKeyframe(0);
  const duplicate = planeKeyframe(0);
  const result = fuseRgbdKeyframes([repeated, duplicate], { floorY: 0 });
  expect(result.mesh).toBeNull();
  expect(result.diagnostics.confirmedVoxels).toBe(0);
  expect(result.diagnostics.fallback).toBeUndefined();
});

test("does not choose either unaligned view as a fallback result", () => {
  const result = fuseRgbdKeyframes(
    [
      planeKeyframe(0, true, false, false, 0.7),
      planeKeyframe(8, true, false, false, 2),
    ],
    { floorY: 0 },
  );
  expect(result.mesh).toBeNull();
  expect(result.diagnostics.overlappingKeyframes).toBe(1);
  expect(result.diagnostics.fallback).toBeUndefined();
});
