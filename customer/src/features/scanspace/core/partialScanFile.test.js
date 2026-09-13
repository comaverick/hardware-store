import {
  looksLikePartialScan,
  parsePartialScan,
  serializePartialScan,
} from "./partialScanFile";

function measuredScan() {
  return {
    name: "Unfinished kitchen",
    reason: "The room boundary is incomplete.",
    pointCount: 3,
    measuredGapWarning: true,
    mesh: {
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      colors: new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]),
      indices: new Uint32Array([0, 1, 2]),
      textureCoverage: 72,
      observer: { x: 1, y: 1.6, z: 2 },
    },
    cloud: {
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      colors: new Uint8Array([1, 2, 3, 4, 5, 6]),
      count: 2,
      colorCoverage: 100,
      pointSize: 0.02,
      floorY: 0,
      observer: { x: 0.5, y: 1.6, z: 1 },
    },
  };
}

test("incomplete scans survive portable serialization", () => {
  const serialized = serializePartialScan(measuredScan());
  expect(looksLikePartialScan(serialized.slice(0, 256))).toBe(true);
  expect(serialized).not.toContain("texture");

  const restored = parsePartialScan(serialized);
  expect(restored.name).toBe("Unfinished kitchen");
  expect(restored.imported).toBe(true);
  expect(Array.from(restored.mesh.positions)).toEqual([
    0, 0, 0, 2, 0, 0, 0, 2, 0,
  ]);
  expect(Array.from(restored.mesh.indices)).toEqual([0, 1, 2]);
  expect(Array.from(restored.mesh.colors)).toEqual([
    10, 20, 30, 40, 50, 60, 70, 80, 90,
  ]);
  expect(restored.mesh.triangleCount).toBe(1);
  expect(restored.mesh.portableColors).toBe(false);
  expect(restored.cloud.count).toBe(2);
});

test("incomplete scan imports reject unsafe geometry", () => {
  const value = JSON.parse(serializePartialScan(measuredScan()));
  value.scan.mesh.indices.data = btoa(
    String.fromCharCode(...new Uint8Array(new Uint32Array([0, 1, 99]).buffer)),
  );
  expect(() => parsePartialScan(JSON.stringify(value))).toThrow(
    "invalid mesh index",
  );
});

test("portable exports retain the live mesh texture when it fits", () => {
  const scan = measuredScan();
  scan.mesh.uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  scan.mesh.texture = {
    width: 2,
    height: 2,
    data: new Uint8Array([
      12, 24, 36, 255,
      48, 60, 72, 255,
      84, 96, 108, 255,
      120, 132, 144, 255,
    ]),
  };
  const restored = parsePartialScan(serializePartialScan(scan));
  expect(restored.mesh.texture.width).toBe(2);
  expect(restored.mesh.texture.height).toBe(2);
  expect(Array.from(restored.mesh.texture.data)).toEqual(
    Array.from(scan.mesh.texture.data),
  );
  expect(Array.from(restored.mesh.uvs)).toEqual([0, 0, 1, 0, 0, 1]);
  expect(restored.mesh.portableColors).toBe(false);
});
