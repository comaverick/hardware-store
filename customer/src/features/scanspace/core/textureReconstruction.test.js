import { Matrix4, PerspectiveCamera } from "three";
import { consolidatePlanarSurfaces } from "./planarSurface";
import { serializePartialScan, parsePartialScan } from "./partialScanFile";
import {
  constrainSurfaceDeformation,
  overlapTextureColorScales,
  projectWorld,
  texturedMesh,
  textureEdgeDifference,
} from "./fusion";

function cameraFrame(value = 140, x = 0) {
  const camera = new PerspectiveCamera(90, 1, 0.1, 20);
  const frame = {
    columns: 16, rows: 16,
    colorWidth: 8, colorHeight: 8, colorChannels: 4,
    colorImage: new Uint8Array(Array(64).fill([value, value, value, 255]).flat()),
    transformMatrix: new Float32Array(new Matrix4().makeTranslation(x, 0, 0).elements),
    projectionMatrix: new Float32Array(camera.projectionMatrix.elements),
    filteredDepth: new Float32Array(256).fill(2),
    measuredMask: new Uint8Array(256).fill(1),
    filteredCount: 256,
    positions: new Float32Array(256 * 3),
  };
  for (let y = 0; y < 16; y++) for (let column = 0; column < 16; column++) {
    const u = (column + 0.5) / 16, v = (y + 0.5) / 16;
    frame.positions.set([x + (u * 2 - 1) * 2, (1 - v * 2) * 2, -2], (y * 16 + column) * 3);
  }
  return frame;
}

const triangleMesh = () => ({
  positions: new Float32Array([-0.1, -0.1, -2, 0.1, -0.1, -2, -0.1, 0.1, -2]),
  indices: new Uint32Array([0, 1, 2]),
  colors: new Uint8Array(9).fill(30),
});

test("a locally sharp painting view wins over a globally sharper curtain view and round-trips unchanged", () => {
  const frames = [cameraFrame(), cameraFrame()];
  frames.forEach((frame, index) => {
    frame.colorWidth = frame.colorHeight = 64;
    frame.colorImage = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const painting = x >= 20 && x < 44 && y >= 20 && y < 44;
      const sharp = index ? painting : !painting;
      const c = sharp ? (x + y) % 2 ? 70 : 210 : 140;
      frame.colorImage.set([c, c, c, 255], (y * 64 + x) * 4);
    }
  });
  const original = triangleMesh();
  const result = texturedMesh(original, frames, { scales: [], pairCount: 0 });
  expect(result.positions).toEqual(original.positions);
  expect(result.indices).toEqual(original.indices);
  expect(result.rejectedSoftTextureCandidates).toBeGreaterThan(0);
  // Camera 1 is the second tile, despite its low whole-image sharpness.
  for (let i = 0; i < result.uvs.length; i += 2) expect(result.uvs[i]).toBeGreaterThan(0.5);
  const restored = parsePartialScan(serializePartialScan({ mesh: result }));
  expect(restored.mesh.texture).toEqual(result.texture);
  expect(restored.mesh.positions).toEqual(result.positions);
  expect(restored.mesh.uvs).toEqual(result.uvs);
  expect(restored.mesh.observedSideOriented).toBe(true);
});

test('photographed faces are oriented toward their actual capture and retain registered UVs', () => {
  const mesh = triangleMesh();
  mesh.indices = new Uint32Array([0, 2, 1]);
  const result = texturedMesh(mesh, [cameraFrame()]);
  expect(result.observedSideOriented).toBe(true);
  expect(result.positions).toEqual(triangleMesh().positions);
  expect(mesh.indices).toEqual(new Uint32Array([0, 2, 1]));
  result.surfaceRepair = { mode: 'bounded-planar-estimate', estimatedHoleCount: 2,
    estimatedTriangles: 8, estimatedArea: 0.03, maxDiameterMeters: 0.42 };
  const restored = parsePartialScan(serializePartialScan({ mesh: result }));
  expect(restored.mesh.surfaceRepair).toEqual(result.surfaceRepair);
});

test("consolidated wall topology is textured at its corrected positions", () => {
  const positions = [], indices = [];
  for (const depth of [-2, -2.04]) {
    const base = positions.length / 3;
    for (let y = 0; y <= 12; y++) for (let x = 0; x <= 12; x++)
      positions.push(x * 0.1 - 0.6, y * 0.1 - 0.6, depth);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      const a = base + y * 13 + x;
      indices.push(a, a + 1, a + 13, a + 1, a + 14, a + 13);
    }
  }
  const corrected = consolidatePlanarSurfaces({ positions: new Float32Array(positions), indices: new Uint32Array(indices), colors: new Uint8Array(positions.length).fill(120) });
  expect(corrected.planarConsolidation.removedOverlapArea).toBeGreaterThan(1.4);
  const frame = cameraFrame(), result = texturedMesh(corrected, [frame]);
  expect(result.textureProjectionMode).toBe("final-mesh-positions");
  expect(result.textureCoverage).toBeGreaterThan(95);
  expect(result.texturePatchSummary[0].sources[0].tile).toBe(0);
  for (let vertex = 0; vertex < result.positions.length / 3; vertex++) {
    expect(result.positions[vertex * 3 + 2]).toBeCloseTo(-2.02, 4);
    const projected = projectWorld(frame, ...result.positions.slice(vertex * 3, vertex * 3 + 3));
    expect(result.uvs[vertex * 2]).toBeCloseTo((4 + projected.u * 7 + 0.5) / result.texture.width, 6);
    expect(result.uvs[vertex * 2 + 1]).toBeCloseTo((4 + (1 - projected.v) * 7 + 0.5) / result.texture.height, 6);
  }
});

test("UVs project the final mesh, even when an obsolete pre-correction copy is supplied", () => {
  const mesh = triangleMesh();
  mesh.textureProjectionPositions = mesh.positions.slice();
  for (let i = 0; i < mesh.positions.length; i += 3) mesh.positions[i] += 0.035;
  const frame = cameraFrame();
  const result = texturedMesh(mesh, [frame]);
  expect(result.textureCoverage).toBe(100);
  expect(result.positions).toEqual(mesh.positions);
  for (let vertex = 0; vertex < 3; vertex++) {
    const projected = projectWorld(frame, ...mesh.positions.slice(vertex * 3, vertex * 3 + 3));
    const expectedU = (4 + projected.u * 7 + 0.5) / result.texture.width;
    const expectedV = (4 + (1 - projected.v) * 7 + 0.5) / result.texture.height;
    expect(result.uvs[vertex * 2]).toBeCloseTo(expectedU, 6);
    expect(result.uvs[vertex * 2 + 1]).toBeCloseTo(expectedV, 6);
  }
});

test("direct depth samples tolerate fused relief without crossing a deeper occlusion", () => {
  const relief = triangleMesh();
  for (let index = 2; index < relief.positions.length; index += 3)
    relief.positions[index] -= 0.075;
  expect(texturedMesh(relief, [cameraFrame()]).textureCoverage).toBe(100);

  const occluded = triangleMesh();
  for (let index = 2; index < occluded.positions.length; index += 3)
    occluded.positions[index] -= 0.12;
  expect(texturedMesh(occluded, [cameraFrame()]).textureCoverage).toBe(0);
});

test("unrelated dark and bright camera views do not recolor one another", () => {
  const frames = [cameraFrame(60), cameraFrame(210, 20)];
  const result = texturedMesh(triangleMesh(), frames);
  expect(result.photometricNormalization).toBe("original-camera-colors");
  frames.forEach((frame) => expect(frame.textureChannelScales).toEqual([1, 1, 1]));
  expect(result.texture.data[(4 * result.texture.width + 4) * 4]).toBe(60);
});

test("two-view exposure correction converges instead of oscillating", () => {
  const frames = [cameraFrame(100), cameraFrame(150, 0.06)];
  const result = overlapTextureColorScales(frames);
  expect(result.pairCount).toBe(1);
  expect(Math.abs(100 * result.scales[0][0] - 150 * result.scales[1][0])).toBeLessThan(2);
});

test("sampled-RGB fallback frames share the atlas exposure solution", () => {
  const frames = [cameraFrame(100), cameraFrame(150, 0.06)];
  frames[1].colorImage = null;
  frames[1].colors = new Uint8Array(256 * 3).fill(150);
  frames[1].colorMask = new Uint8Array(256).fill(1);
  const result = overlapTextureColorScales(frames);
  expect(result.pairCount).toBe(1);
  expect(Math.abs(100 * result.scales[0][0] - 150 * result.scales[1][0])).toBeLessThan(2);
  frames[1].colorMask.fill(0);
  expect(overlapTextureColorScales(frames).pairCount).toBe(0);
});

test("disconnected exposure groups are calibrated independently", () => {
  const pair = [cameraFrame(100), cameraFrame(150, 0.06)];
  const expected = overlapTextureColorScales(pair);
  const result = overlapTextureColorScales([...pair, cameraFrame(80, 20), cameraFrame(100, 20.06), cameraFrame(125, 19.94)]);
  expect(result.scales[0][0]).toBeCloseTo(expected.scales[0][0], 5);
  expect(result.scales[1][0]).toBeCloseTo(expected.scales[1][0], 5);
});

test("a caller disabling calibration is respected by the atlas as well as fusion", () => {
  const frames = [cameraFrame(100), cameraFrame(150, 0.06)];
  texturedMesh(triangleMesh(), frames, { scales: [], pairCount: 0 });
  frames.forEach((frame) => expect(frame.textureChannelScales).toEqual([1, 1, 1]));
});

test("camera seam cost compares corresponding edge pixels, including a narrow stripe", () => {
  const first = { frame: cameraFrame(140), projections: [{ u: 0.1, v: 0.5 }, { u: 0.9, v: 0.5 }] };
  const second = { frame: cameraFrame(140), projections: [{ u: 0.9, v: 0.5 }, { u: 0.1, v: 0.5 }] };
  expect(textureEdgeDifference(first, [0, 1], second, [1, 0])).toBe(0);
  for (let y = 0; y < 8; y++) second.frame.colorImage.set([20, 20, 20], (y * 8 + 4) * 4);
  expect(textureEdgeDifference(first, [0, 1], second, [1, 0])).toBeGreaterThan(0.15);
});

test("fallback boundary colors use the adjacent valid camera without deleting the untextured surface", () => {
  const mesh = {
    positions: new Float32Array([0, -0.1, -2, 0.1, -0.1, -2, 0, 0.1, -2, 2.5, 0.1, -2]),
    indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    colors: new Uint8Array(12).fill(30),
  };
  const result = texturedMesh(mesh, [cameraFrame(140)]);
  expect(result.indices).toHaveLength(6);
  expect(result.textureCoverage).toBe(50);
  const linear = Math.round(255 * ((140 / 255 + 0.055) / 1.055) ** 2.4);
  expect(Array.from(result.colors.slice(9, 12))).toEqual([linear, linear, linear]);
  expect(Array.from(result.colors.slice(12, 15))).toEqual([30, 30, 30]);
  expect(Array.from(result.colors.slice(15, 18))).toEqual([linear, linear, linear]);
  expect(mesh.colors.every((value) => value === 30)).toBe(true);
});

test.each(["flip", "collapse", "stretch"])("surface correction cannot %s a measured triangle", (kind) => {
  const mesh = triangleMesh();
  const proposed = mesh.positions.slice();
  if (kind === "flip") proposed[7] = -0.2;
  if (kind === "collapse") proposed[7] = -0.09;
  if (kind === "stretch") proposed[7] = 2;
  const result = constrainSurfaceDeformation(mesh, proposed);
  expect(result.positions).toEqual(mesh.positions);
  expect(result.revertedVertices).toBe(1);
  expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
});

test("safe surface smoothing is retained", () => {
  const mesh = triangleMesh();
  const proposed = mesh.positions.slice();
  proposed[2] -= 0.003;
  const result = constrainSurfaceDeformation(mesh, proposed);
  expect(result.positions).toEqual(proposed);
  expect(result.revertedVertices).toBe(0);
});
