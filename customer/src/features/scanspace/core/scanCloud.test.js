import { buildScanCloud } from "./scanCloud";

test("builds a bounded colored scan cloud without generating surfaces", () => {
  const points = Array.from({ length: 2000 }, (_, index) => ({
    x: (index % 40) * 0.08,
    y: Math.floor(index / 40) * 0.04,
    z: index % 2 ? 0 : 1,
    color: index % 3 ? [220, 120, 60] : undefined,
  }));
  const cloud = buildScanCloud(points, {
    floorY: 0,
    observer: { x: 1, z: 0.5 },
    limit: 1200,
    voxelSize: 0.08,
  });
  expect(cloud.count).toBe(1200);
  expect(cloud.positions).toBeInstanceOf(Float32Array);
  expect(cloud.colors).toBeInstanceOf(Uint8Array);
  expect(cloud.positions).toHaveLength(cloud.count * 3);
  expect(cloud.colorCoverage).toBeGreaterThan(60);
  expect(cloud.observer).toEqual({ x: 1, y: 1.6, z: 0.5 });
});
