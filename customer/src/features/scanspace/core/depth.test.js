import { PerspectiveCamera, Matrix4 } from "three";
import { detectCapabilities, unprojectDepth, VoxelCloud } from "./depth";
import { reconstructRoom } from "./reconstruction";
import { area } from "./domain";

test("capabilities distinguish secure context, immersive AR, and absent depth evidence", async () => {
  expect((await detectCapabilities({}, false)).ar).toBe(false);
  expect((await detectCapabilities({}, true)).ar).toBe(false);
  const c = await detectCapabilities(
    { xr: { isSessionSupported: async () => true } },
    true,
  );
  expect(c.ar).toBe(true);
  expect(c.depthActive).toBeUndefined();
});
test("unprojects plane depth with camera pose and leaves depth transform to the XR accessor", () => {
  const camera = new PerspectiveCamera(90, 1, 0.1, 100),
    view = {
      projectionMatrix: camera.projectionMatrix.elements,
      transform: { matrix: new Matrix4().makeTranslation(1, 2, 3).elements },
    },
    depth = { getDepthInMeters: jest.fn(() => 2) };
  const points = unprojectDepth(depth, view, 2, 2);
  expect(points).toHaveLength(4);
  expect(points[0].x).toBeCloseTo(0);
  expect(points[0].y).toBeCloseTo(3);
  expect(points[0].z).toBeCloseTo(1);
  expect(depth.getDepthInMeters).toHaveBeenCalledWith(0.25, 0.25);
});
test("invalid depths do not become geometry", () => {
  const camera = new PerspectiveCamera(),
    view = {
      projectionMatrix: camera.projectionMatrix.elements,
      transform: { matrix: new Matrix4().elements },
    };
  for (const meters of [0, -1, NaN, Infinity, 15])
    expect(
      unprojectDepth({ getDepthInMeters: () => meters }, view, 2, 2),
    ).toHaveLength(0);
});
test("voxel downsampling compacts before reporting a hard memory limit", () => {
  const cloud = new VoxelCloud(0.1, 3);
  cloud.add(
    [
      { x: 0, y: 0, z: 0 },
      { x: 0.01, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ],
    1,
  );
  expect(cloud.values()).toHaveLength(3);
  expect(cloud.compactions).toBeGreaterThan(0);
  expect(cloud.full).toBe(false);
  expect(cloud.values(true)).toHaveLength(0);
});
test("repeat observations and neighbors produce stable geometry", () => {
  const cloud = new VoxelCloud(0.1);
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 0.1, y: 0, z: 0 },
    { x: 0.1, y: 0.1, z: 0 },
  ];
  cloud.add(points, 1);
  cloud.add(points, 2);
  expect(cloud.values(true)).toHaveLength(3);
});
test("adaptive compaction preserves room coverage before reporting a hard limit", () => {
  const cloud = new VoxelCloud(0.05, 10, 0.2);
  cloud.add(
    Array.from({ length: 40 }, (_, index) => ({
      x: index * 0.03,
      y: 0,
      z: 0,
    })),
    1,
  );
  expect(cloud.compactions).toBeGreaterThan(0);
  expect(cloud.size).toBeGreaterThan(0.05);
  expect(cloud.full).toBe(false);
});
function fixture(wallCount = 4) {
  const points = [];
  for (let y = 0.4; y < 2.5; y += 0.13)
    for (let t = 0.1; t < 3.9; t += 0.13) {
      if (wallCount >= 1) points.push({ x: 0, y, z: t });
      if (wallCount >= 2) points.push({ x: t, y, z: 0 });
      if (wallCount >= 3) points.push({ x: 4, y, z: t });
      if (wallCount >= 4) points.push({ x: t, y, z: 4 });
    }
  for (let x = 0.1; x < 4; x += 0.18)
    for (let z = 0.1; z < 4; z += 0.18)
      points.push({ x, y: 0, z }, { x, y: 2.7, z });
  return points;
}
test("reconstructs a bounded room from synthetic measured points", () => {
  const result = reconstructRoom(fixture(), {
    floorY: 0,
    observer: { x: 2, z: 2 },
    height: 2.7,
    depthFrames: 20,
  });
  expect(area(result.room.floorPolygon)).toBeCloseTo(16, 0);
  expect(result.room.scanMetadata.mode).toBe("depth");
  expect(result.room.scanMetadata.partial).toBe(false);
  expect(result.ceilingMeasured).toBe(true);
});
test("two adjoining walls infer a bounded rectangular room without measurements", () => {
  const result = reconstructRoom(fixture(2), {
    floorY: 0,
    observer: { x: 2, z: 2 },
    height: 2.7,
  });
  expect(area(result.room.floorPolygon)).toBeCloseTo(16, 0);
  expect(result.room.scanMetadata.partial).toBe(true);
  expect(result.room.scanMetadata.inferredWallCount).toBe(2);
});
test("one wall cannot establish an automatic room footprint", () => {
  expect(() =>
    reconstructRoom(fixture(1), {
      floorY: 0,
      observer: { x: 2, z: 2 },
      height: 2.7,
    }),
  ).toThrow(/Two connected wall directions/);
  expect(() => reconstructRoom([])).toThrow(/Too little/);
});
