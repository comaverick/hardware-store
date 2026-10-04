import * as THREE from "three";
import { capturedWallLightReference, createWallLightingTexture, estimateWallLighting, wallPaintShader } from "./scanWallLighting";

const srgb = linear => Math.round((linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055) * 255);
const wallPhoto = (pixels, details) => ({
  texture: { width: pixels.length, height: 1, data: Uint8Array.from(pixels.flatMap(rgb => [...rgb, 255])) },
  detailMask: Uint8Array.from(details || pixels.map(() => 0)),
});

test("new paint retains linear shadow contrast while removing the original warm paint tint", () => {
  const albedo = [.65, .46, .3], bright = albedo.map(srgb), shadow = albedo.map(value => srgb(value * .25));
  const wall = wallPhoto([bright, bright, shadow, bright, bright]);
  const original = wall.texture.data.slice();
  const lighting = estimateWallLighting(wall);
  for (let channel = 0; channel < 3; channel++) {
    expect(lighting.data[channel] / 127.5).toBeCloseTo(1, 1);
    expect(Math.abs(lighting.data[8 + channel] / lighting.data[channel] - .25)).toBeLessThan(.012);
  }
  expect(wall.texture.data).toEqual(original);
  expect(Math.abs(lighting.data[8] - lighting.data[9])).toBeLessThanOrEqual(1);
  expect(Math.abs(lighting.data[9] - lighting.data[10])).toBeLessThanOrEqual(1);
});

test("protected artwork cannot darken the paint or normalize away surrounding shadows", () => {
  const lit = [220, 220, 220], shadow = [140, 140, 140];
  const wall = wallPhoto([lit, shadow, [0, 0, 0], [255, 0, 0], [255, 255, 255], shadow, lit], [0, 0, 255, 255, 255, 0, 0]);
  const result = estimateWallLighting(wall);
  expect(result.data[4]).toBeLessThan(result.data[0] * .5);
  // Illumination extended beneath the protected image has no red artwork tint.
  expect(result.data[12]).toBe(result.data[13]);
  expect(result.data[13]).toBe(result.data[14]);
  expect(result.data[12]).toBeGreaterThan(0);
  const changedArtwork = wallPhoto([lit, shadow, [255, 255, 255], [0, 255, 0], [0, 0, 0], shadow, lit], wall.detailMask);
  expect(estimateWallLighting(changedArtwork).data).toEqual(result.data);
});

test("uncaptured background pixels do not affect the exposure of the supported wall", () => {
  const wall = wallPhoto([[150, 150, 150], [80, 80, 80], [255, 255, 255], [255, 255, 255]]);
  wall.extent = [[0, 0], [4, 1]]; wall.footprint = new Uint8Array([1, 1, 0, 0]);
  const lighting = estimateWallLighting(wall);
  expect(lighting.data[0] / 127.5).toBeCloseTo(1, 1);
  expect(lighting.data[4]).toBeLessThan(lighting.data[0] * .3);
});

test("unusable photo evidence falls back to neutral illumination with finite samples", () => {
  expect(estimateWallLighting({})).toBeNull();
  for (const wall of [wallPhoto([[0, 0, 0], [0, 0, 0]]), wallPhoto([[220, 220, 220]], [255])]) {
    expect(Array.from(estimateWallLighting(wall).data)).toEqual(Array(wall.texture.width).fill([128, 128, 128, 255]).flat());
  }
  const texture = createWallLightingTexture(wallPhoto([[180, 180, 180], [100, 100, 100]]));
  expect(texture.colorSpace).toBe(THREE.NoColorSpace);
  expect(texture.flipY).toBe(false);
  expect(texture.channel).toBe(0);
  texture.dispose();
});

test("portable vertex colors use only identified walls to estimate their captured exposure", () => {
  const mesh = { indices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    colors: new Uint8Array([128, 128, 128, 128, 128, 128, 128, 128, 128,
      32, 32, 32, 32, 32, 32, 32, 32, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255]) };
  const reference = capturedWallLightReference(mesh, { labels: new Uint8Array([1, 1, 2]) });
  expect(reference[0]).toBeCloseTo(128 / 255);
  expect(reference[1]).toBeCloseTo(reference[0]);
});

test("wall lighting replaces diffuse room lamps but retains finish reflection and neutral unobserved backs", () => {
  const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  wallPaintShader([.6, .5, .4], true)(shader);
  expect(shader.uniforms.scanPaintReference.value.toArray()).toEqual([.6, .5, .4]);
  const paint = shader.fragmentShader.indexOf("outgoingLight = diffuse * scanLight");
  const back = shader.fragmentShader.indexOf("if (!gl_FrontFacing)");
  expect(paint).toBeGreaterThan(0);
  expect(back).toBeGreaterThan(paint);
  expect(shader.fragmentShader).toContain("min(totalSpecular, vec3(0.12))");
});
