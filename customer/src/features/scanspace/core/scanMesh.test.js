import { buildDepthMeshFrame, mergeScanMesh } from "./scanMesh";

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

test("connects neighboring RGB-D samples into triangle surfaces", () => {
  const frame = buildDepthMeshFrame(grid(), {
    columns: 3,
    rows: 3,
    camera: { x: 0, y: 0, z: 2 },
  });
  expect(frame.vertexCount).toBe(9);
  expect(frame.triangleCount).toBe(8);
  const mesh = mergeScanMesh([frame], {
    floorY: 0,
    observer: { x: 1, z: 2 },
  });
  expect(mesh.triangleCount).toBe(8);
  expect(mesh.positions).toHaveLength(27);
  expect(mesh.colorCoverage).toBe(100);
  expect(mesh.observer).toEqual({ x: 1, y: 1.6, z: 2 });
});

test("does not bridge a large depth discontinuity", () => {
  const frame = buildDepthMeshFrame(
    grid((x) => (x === 2 ? 2 : 0)),
    { columns: 3, rows: 3, camera: { x: 0, y: 0, z: 2 } },
  );
  expect(frame.triangleCount).toBe(4);
});
