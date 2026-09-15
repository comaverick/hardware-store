import { Matrix4, PerspectiveCamera } from "three";
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
