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
test("voxel downsampling bounds memory and rejects isolated observations", () => {
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
  expect(cloud.full).toBe(true);
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
function fixture(missing = false) {
  const points = [];
  for (let y = 0.4; y < 2.5; y += 0.13)
    for (let t = 0.1; t < 3.9; t += 0.13) {
      points.push({ x: 0, y, z: t }, { x: 4, y, z: t }, { x: t, y, z: 0 });
      if (!missing) points.push({ x: t, y, z: 4 });
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
  expect(result.ceilingMeasured).toBe(true);
});
test("incomplete scans do not fabricate the missing wall", () => {
  expect(() =>
    reconstructRoom(fixture(true), {
      floorY: 0,
      observer: { x: 2, z: 2 },
      height: 2.7,
    }),
  ).toThrow(/enclose|coverage/);
  expect(() => reconstructRoom([])).toThrow(/Too little/);
});
