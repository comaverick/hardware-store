import {
  looksLikePartialScan,
  parsePartialScan,
  serializePartialScan,
} from "./partialScanFile";
import { createRgbdKeyframe } from "./fusion";
import { buildScanDesignSurfaces, validScanDesignSurfaces } from "./scanDesignSurfaces";

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

test("portable designs retain flat walls and measured source geometry through a round trip", () => {
  const scan = measuredScan();
  scan.mesh.uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  scan.mesh.designSurfaces = buildScanDesignSurfaces(scan.mesh, [{ kind: "wall", normal: [0, 0, 1], offset: 0 }]);
  expect(scan.mesh.designSurfaces).not.toBeNull();
  const encoded = serializePartialScan(scan), decoded = parsePartialScan(encoded);
  expect(validScanDesignSurfaces(decoded.mesh.designSurfaces, decoded.mesh)).toBe(true);
  expect(decoded.mesh.positions).toEqual(scan.mesh.positions);
  expect(decoded.mesh.indices).toEqual(scan.mesh.indices);
  expect(decoded.mesh.designSurfaces.walls[0].positions).toEqual(scan.mesh.designSurfaces.walls[0].positions);
  expect(decoded.mesh.designSurfaces.walls[0].detailMask).toEqual(scan.mesh.designSurfaces.walls[0].detailMask);
  expect(decoded.mesh.designSurfaces.removedSourceFaces).toEqual(scan.mesh.designSurfaces.removedSourceFaces);
  const damaged = JSON.parse(encoded);
  damaged.scan.mesh.designSurfaces.sourceKey = "stale-mesh";
  const fallback = parsePartialScan(JSON.stringify(damaged));
  expect(fallback.mesh.designSurfaces).toBeNull();
  expect(fallback.mesh.positions).toEqual(scan.mesh.positions);
  for (const version of [51,52]) {
    const previousJoin = JSON.parse(encoded);
    previousJoin.scan.mesh.designSurfaces.sourceAlgorithmVersion = version;
    const rebuiltFallback = parsePartialScan(JSON.stringify(previousJoin));
    expect(rebuiltFallback.mesh.designSurfaces).toBeNull();
    expect(rebuiltFallback.mesh.positions).toEqual(scan.mesh.positions);
    expect(rebuiltFallback.mesh.indices).toEqual(scan.mesh.indices);
  }
});

test("portable adjusted boundaries retain their photos, source ownership, and estimate mask", () => {
  const scan = measuredScan();
  scan.mesh.positions = new Float32Array([0,0,.02, 2,0,.02, 0,2,.02, 0,0,.02, 2,0,.02, 0,0,.7]);
  scan.mesh.indices = new Uint32Array([0,1,2, 3,5,4]);
  scan.mesh.normals = new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,1,0, 0,1,0, 0,1,0]);
  scan.mesh.colors = new Uint8Array(18).fill(230);
  scan.mesh.uvs = new Float32Array([0,0, 1,0, 0,1, 0,0, 1,0, 0,1]);
  scan.mesh.designSurfaces = buildScanDesignSurfaces(scan.mesh, [{ kind: "wall", normal: [0,0,1], offset: 0 }]);
  const encoded = serializePartialScan(scan), decoded = parsePartialScan(encoded);
  const original = scan.mesh.designSurfaces.fragments, restored = decoded.mesh.designSurfaces.fragments;
  expect(scan.mesh.designSurfaces.diagnostics.boundaryAdjustedSourceTriangles).toBeGreaterThan(0);
  expect(restored.positions).toEqual(original.positions); expect(restored.uvs).toEqual(original.uvs);
  expect(restored.sourceFaces).toEqual(original.sourceFaces);
  expect(restored.estimatedTriangleMask).toEqual(original.estimatedTriangleMask);
  expect(decoded.mesh.positions).toEqual(scan.mesh.positions);
  const damaged = JSON.parse(encoded);
  damaged.scan.mesh.designSurfaces.fragments.estimatedTriangleMask.data = btoa(String.fromCharCode(2));
  expect(parsePartialScan(JSON.stringify(damaged)).mesh.designSurfaces).toBeNull();
  const legacy = JSON.parse(encoded);
  legacy.scan.mesh.designSurfaces.version = 1;
  const fallback = parsePartialScan(JSON.stringify(legacy));
  expect(fallback.mesh.designSurfaces).toBeNull();
  expect(fallback.mesh.positions).toEqual(scan.mesh.positions);
});

test.each([measuredScan, rawScan])("scan and design exports restore applied finishes while retaining capture data", createScan => {
  const scan = createScan();
  scan.customization = { version: 1, walls: { color: "#a0afa4", finish: "Satin" },
    floor: { finishId: "stone", direction: "crosswise" }, ceiling: { color: "#ffffff", finish: "Matte" } };
  const restored = parsePartialScan(serializePartialScan(scan));
  expect(restored.customization).toEqual(scan.customization);
  if (scan.rawCapture) expect(restored.rawCapture.keyframes[0].positions).toEqual(scan.rawCapture.keyframes[0].positions);
  else expect(restored.mesh.positions).toEqual(scan.mesh.positions);
});

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

test("adaptive capture connections and quality survive export without provisional frames or derived caches", () => {
  const scan = rawScan();
  Object.assign(scan.rawCapture.keyframes[0], {
    captureId: 12, captureLinks: [4, 9], depthType: "smooth", nativeDepthWidth: 160, nativeDepthHeight: 90,
  });
  scan.rawCapture.stats.adaptiveCapture = {
    version: 2, state: "checking", reason: "checking-overlap", connected: true,
    frameCount: 3, pendingCount: 2, recoveries: 1, promoted: 1,
    pendingAgeDrops: 3, pendingCapacityDrops: 4, pendingRedundantDrops: 2,
    coverage: { observed: 120, confirmed: 60, ratio: 0.5, target: [1, 2, 3],
      regions: [{ id: "middle", observed: 120, confirmed: 60, ratio: 0.5 }] },
    pending: [{ shouldNotExport: true }],
  };
  scan.rawCapture.stats.captureDiagnostics = { attempts: 10, rejected: 7, accepted: 3,
    decisions: { "moving-too-fast": 5, "checking-overlap": 2, connected: 3 },
    recent: [{ reason: "moving-too-fast", gateLinearSpeed: 1.2, sampledLinearSpeed: 0, camera: [1, 2, 3] }] };
  scan.captureQuality.captureAudit = { passed: false, issues: ["Needs another angle"], checkedReconstruction: true };
  const restored = parsePartialScan(serializePartialScan(scan));
  expect(restored.rawCapture.keyframes[0]).toMatchObject({
    captureId: 12, captureLinks: [4, 9], depthType: "smooth", nativeDepthWidth: 160, nativeDepthHeight: 90,
  });
  expect(restored.rawCapture.stats.adaptiveCapture).toMatchObject({
    connected: true, pendingCount: 2, state: "checking", coverage: { ratio: 0.5 },
    pendingAgeDrops: 3, pendingCapacityDrops: 4, pendingRedundantDrops: 2,
  });
  expect(restored.rawCapture.stats.captureDiagnostics).toMatchObject({ attempts: 10,
    decisions: { "moving-too-fast": 5 }, recent: [{ gateLinearSpeed: 1.2, sampledLinearSpeed: 0 }] });
  expect(restored.rawCapture.stats.captureDiagnostics.recent[0].camera).toBeUndefined();
  expect(restored.rawCapture.stats.adaptiveCapture.pending).toBeUndefined();
  expect(restored.rawCapture.stats.adaptiveCapture.coverage.target).toBeUndefined();
  expect(restored.captureQuality.captureAudit).toEqual(scan.captureQuality.captureAudit);
});

test.each(["xr-tracking", "depth-overlap"])("capture validation mode %s survives raw export and import", validationMode => {
  const scan = rawScan();
  scan.rawCapture.stats.adaptiveCapture = {
    version: 3, state: "tracking", reason: "connected", connected: true,
    validationMode, frameCount: 3,
  };
  const restored = parsePartialScan(serializePartialScan(scan));
  expect(restored.rawCapture.stats.adaptiveCapture).toMatchObject({ version: 3, validationMode });
});

test("planar reconstruction diagnostics survive export and import", () => {
  const scan = measuredScan();
  scan.captureQuality = { algorithmVersion: 36, planarConsolidation: { version: 1, removedOverlapArea: 0.9, planes: [{ normal: [0, 0, 1], offset: -2, retainedArea: 2.5 }] } };
  const restored = parsePartialScan(serializePartialScan(scan));
  expect(restored.captureQuality).toEqual(scan.captureQuality);
  expect(restored.mesh.positions).toEqual(scan.mesh.positions);
  expect(restored.mesh.indices).toEqual(scan.mesh.indices);
});

test("structural reconstruction and topology diagnostics survive raw-file round trips",()=>{
  const scan=rawScan();
  scan.captureQuality={algorithmVersion:42,structuralDepth:{correctedSamples:42},
    structuralRebuild:{reconstructedArea:1.2},topology:{boundaryEdges:8},
    recoveredCaptureGroups:{appliedFrameIds:[3,4,5]}};
  const restored=parsePartialScan(serializePartialScan(scan));
  expect(restored.captureQuality).toEqual(scan.captureQuality);
  expect(restored.rawCapture.keyframes[0].positions).toEqual(scan.rawCapture.keyframes[0].positions);
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

test('texture-free portable export preserves estimated linear colors multiplying the blank atlas tile', () => {
  const scan = measuredScan();
  const original = scan.mesh.colors.slice();
  // An atlas wider than the portable limit must fall back to baked colors.
  // Its white tile multiplies a blended repair rather than replacing its color.
  scan.mesh.texture = { width: 8193, height: 1, data: new Uint8Array(8193 * 4).fill(255) };
  scan.mesh.uvs = new Float32Array([.5, .5, .5, .5, .5, .5]);
  const restored = parsePartialScan(serializePartialScan(scan));
  expect(restored.mesh.texture).toBeNull();
  expect(restored.mesh.portableColors).toBe(true);
  expect(restored.mesh.colors).toEqual(original);
  expect(scan.mesh.colors).toEqual(original);
});
