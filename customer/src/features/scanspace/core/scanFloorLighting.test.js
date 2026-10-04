import * as THREE from "three";
import { createFloorLighting, estimateFloorLighting, floorFinishShader } from "./scanFloorLighting";

const srgb = linear => Math.round((linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055) * 255);
const surfaces = { labels: new Uint8Array([2, 2]), floorAxes: [[1, 0, 0], [0, 0, 1]] };
function photographedFloor(lightAt) {
  const width = 128, height = 128, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const light = lightAt((x + .5) / width * 2, (y + .5) / height * 2);
    data.set([.6, .4, .2].map(value => srgb(value * light)).concat(255), (y * width + x) * 4);
  }
  return { positions: new Float32Array([0,0,0, 2,0,0, 2,0,2, 0,0,2]),
    indices: new Uint32Array([0,1,2, 0,2,3]), colors: new Uint8Array(12).fill(255),
    uvs: new Float32Array([0,0, 1,0, 1,1, 0,1]), texture: { width, height, data } };
}
function lightAt(image, x, z, channel = 0) {
  const u = Math.max(0, Math.min(image.width - 1, Math.floor((x - image.origin[0]) / image.cellSize)));
  const v = Math.max(0, Math.min(image.height - 1, Math.floor((z - image.origin[1]) / image.cellSize)));
  return image.data[(v * image.width + u) * 4 + channel] / 127.5;
}

test("a replacement floor retains a broad captured shadow without the original warm floor tint", () => {
  const mesh = photographedFloor(x => x > .7 && x < 1.3 ? .18 : 1);
  const original = [mesh.positions.slice(), mesh.indices.slice(), mesh.texture.data.slice()];
  const image = estimateFloorLighting(mesh, surfaces);
  expect(lightAt(image, 1, 1)).toBeLessThan(lightAt(image, .25, 1) * .35);
  expect(lightAt(image, .25, 1)).toBeCloseTo(1, 1);
  for (const channel of [1, 2])
    expect(lightAt(image, 1, 1, channel)).toBeCloseTo(lightAt(image, 1, 1), 1);
  expect(mesh.positions).toEqual(original[0]);
  expect(mesh.indices).toEqual(original[1]);
  expect(mesh.texture.data).toEqual(original[2]);
});

test("narrow old plank grain and grout do not print through as a second floor pattern", () => {
  const image = estimateFloorLighting(photographedFloor(x => Math.floor(x / .04) % 2 ? 1 : .45), surfaces);
  const values = Array.from({ length: 16 }, (_, i) => lightAt(image, .55 + i * .04, 1));
  expect(Math.max(...values) - Math.min(...values)).toBeLessThan(.05);
});

test("foreground objects cannot contribute light or expand the floor's lighting bounds", () => {
  const mesh = photographedFloor(x => .3 + .7 * x / 2), baseline = estimateFloorLighting(mesh, surfaces);
  const extended = { ...mesh,
    positions: new Float32Array([...mesh.positions, 20,1,20, 21,1,20, 20,1,21]),
    indices: new Uint32Array([...mesh.indices, 4,5,6]), colors: new Uint8Array([...mesh.colors, ...new Uint8Array(9)]) };
  const image = estimateFloorLighting(extended, { ...surfaces, labels: new Uint8Array([2,2,0]) });
  expect(image.origin).toEqual(baseline.origin);
  expect(image.size).toEqual(baseline.size);
  expect(image.data).toEqual(baseline.data);
});

test("large portable triangles and reversed windings preserve the same room-space light field", () => {
  const mesh = photographedFloor(x => .25 + .75 * x / 2);
  const a = estimateFloorLighting(mesh, surfaces);
  const b = estimateFloorLighting({ ...mesh, indices: new Uint32Array([2,1,0, 3,2,0]) }, surfaces);
  for (const x of [.25, .75, 1.25, 1.75]) {
    expect(lightAt(a, x, 1)).toBeCloseTo(lightAt(b, x, 1), 2);
  }
  expect(lightAt(a, .25, 1)).toBeLessThan(lightAt(a, 1.75, 1) * .5);
});

test("linear portable vertex colors remain usable without camera photographs", () => {
  const mesh = photographedFloor(() => 1);
  delete mesh.texture; delete mesh.uvs;
  mesh.colors = new Uint8Array([64,64,64, 255,255,255, 255,255,255, 64,64,64]);
  const image = estimateFloorLighting(mesh, surfaces);
  expect(lightAt(image, .25, 1)).toBeLessThan(lightAt(image, 1.75, 1) * .5);
  const black = estimateFloorLighting({ ...mesh, colors: new Uint8Array(12) }, surfaces);
  expect(lightAt(black, 1, 1)).toBeCloseTo(1, 1);
  expect(estimateFloorLighting(mesh, { ...surfaces, labels: new Uint8Array([0,0]) })).toBeNull();
});

test("floor light uses an independent linear, nonrepeating UV channel", () => {
  const lighting = createFloorLighting(photographedFloor(() => 1), surfaces);
  expect(lighting.texture.channel).toBe(2);
  expect(lighting.texture.colorSpace).toBe(THREE.NoColorSpace);
  expect(lighting.texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
  expect(lighting.texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
  expect(lighting.texture.rotation).toBe(0);
  expect(lighting.width).toBeLessThanOrEqual(512);
  expect(lighting.height).toBeLessThanOrEqual(512);
  lighting.texture.dispose();
});

test("the shader combines the new floor pattern with captured light and preserves unobserved backs", () => {
  const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  floorFinishShader(true, .6)(shader);
  const floor = shader.fragmentShader.indexOf("outgoingLight = diffuseColor.rgb * scanFloorLight");
  const back = shader.fragmentShader.indexOf("if (!gl_FrontFacing)");
  expect(floor).toBeGreaterThan(0);
  expect(back).toBeGreaterThan(floor);
  expect(shader.fragmentShader).toContain("texture2D(lightMap, vLightMapUv)");
  expect(shader.fragmentShader).toContain("dot(nonPerturbedNormal, directionalLights[0].direction)");
  expect(shader.fragmentShader).toContain("roughnessFactor = clamp(roughnessFactor, scanFloorMinimumRoughness, 0.95)");
  expect(shader.uniforms.scanFloorMinimumRoughness.value).toBe(.6);
});
