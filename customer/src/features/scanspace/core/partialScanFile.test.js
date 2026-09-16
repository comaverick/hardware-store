import {
  looksLikePartialScan,
  parsePartialScan,
  serializePartialScan,
} from "./partialScanFile";
import { createRgbdKeyframe } from "./fusion";

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

function rawScan() {
  const identity = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]);
  const frame = createRgbdKeyframe(
    Array.from({ length: 6 }, (_, index) => ({
      x: (index % 3) * 0.2,
      y: Math.floor(index / 3) * 0.2,
      z: -2,
      depth: 2,
      gridX: index % 3,
      gridY: Math.floor(index / 3),
      color: [140, 100, 80],
    })),
    {
      columns: 3,
      rows: 2,
      projectionMatrix: identity,
      transformMatrix: identity,
      viewProjectionMatrix: identity,
      viewTransformMatrix: identity,
      camera: { x: 0, y: 1.6, z: 0 },
      colorImage: {
        data: new Uint8Array([
          10, 20, 30, 255,
          40, 50, 60, 255,
          70, 80, 90, 255,
          100, 110, 120, 255,
        ]),
        width: 2,
        height: 2,
        channels: 4,
      },
      keepColor: true,
    },
  );
  return {
    name: "Raw kitchen",
    pointCount: 6,
    reason: "Captured raw surfaces.",
    captureQuality: { coverage: 25, cameraBaseline: 0.2 },
    rawCapture: {
      keyframes: [frame],
      textureKeyframes: [{ ...frame, textureOnly: true }],
      floorY: 0,
      observer: { x: 0, y: 1.6, z: 0 },
      stats: { coverage: 25, acceptedDepthFrames: 1, fusion: { notExported: true } },
      maxTextureSize: 2048,
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

test("raw scan exports contain capture keyframes and no derived mesh or atlas", () => {
  const serialized = serializePartialScan(rawScan());
  const value = JSON.parse(serialized);
  expect(value.version).toBe(2);
  expect(value.sourceType).toBe("raw-rgbd-capture");
  expect(value.scan.mesh).toBeUndefined();
  expect(value.scan.cloud).toBeUndefined();
  expect(value.scan.rawCapture.keyframes[0].positions.type).toBe("f32");
  expect(value.scan.rawCapture.keyframes[0].colorImage.type).toBe("u8");
  expect(value.scan.rawCapture.stats.fusion).toBeUndefined();
  const restored = parsePartialScan(serialized);
  expect(restored.mesh).toBeNull();
  expect(restored.cloud).toBeNull();
  expect(restored.fusionMode).toBe("raw-import");
  expect(restored.rawCapture.keyframes).toHaveLength(1);
  expect(restored.rawCapture.textureKeyframes).toHaveLength(1);
  expect(Array.from(restored.rawCapture.keyframes[0].colorImage)).toEqual([
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
  ]);
  expect(restored.rawCapture.keyframes[0].viewTransformMatrix).toEqual(
    restored.rawCapture.keyframes[0].transformMatrix,
  );
});

test("raw scan validation rejects a malformed keyframe before rendering", () => {
  const value = JSON.parse(serializePartialScan(rawScan()));
  value.scan.rawCapture.keyframes[0].positions.data = value.scan.rawCapture.keyframes[0].depths.data;
  expect(() => parsePartialScan(JSON.stringify(value))).toThrow(/inconsistent raw keyframe .* grid/);
});

test("planar reconstruction diagnostics survive export and import", () => {
  const scan = measuredScan();
  scan.captureQuality = { algorithmVersion: 36, planarConsolidation: { version: 1, removedOverlapArea: 0.9, planes: [{ normal: [0, 0, 1], offset: -2, retainedArea: 2.5 }] } };
  const restored = parsePartialScan(serializePartialScan(scan));
  expect(restored.captureQuality).toEqual(scan.captureQuality);
  expect(restored.mesh.positions).toEqual(scan.mesh.positions);
  expect(restored.mesh.indices).toEqual(scan.mesh.indices);
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
