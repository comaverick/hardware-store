import { fitTextureOffset, registerSurfaceTextures } from './textureRegistration';

function matches(du = 0.018, dv = -0.012) {
  return Array.from({ length: 30 }, (_, i) => ({ u: i % 6 * 0.1, v: Math.floor(i / 6) * 0.1, du, dv }));
}

test('registration fits a bounded shared photo offset and rejects minority mismatches', () => {
  const observations = matches();
  const result = fitTextureOffset([...observations, ...matches(-0.07, 0.06).slice(0, 5)]);
  expect(result.matches).toBe(30);
  expect(result.x[2]).toBeCloseTo(0.018, 5);
  expect(result.y[2]).toBeCloseTo(-0.012, 5);
  expect(result.residualMeters).toBeLessThan(0.001);
});

test('large, conflicting and insufficient image matches cannot warp a texture', () => {
  expect(fitTextureOffset(matches(0.1, 0.1))).toBeNull();
  expect(fitTextureOffset(matches().slice(0, 9))).toBeNull();
  expect(fitTextureOffset([...matches(-0.07, 0).slice(0, 15), ...matches(0.07, 0).slice(0, 15)])).toBeNull();
});

test('affine registration is regularized and bounded rather than a free mesh deformation', () => {
  const result = fitTextureOffset(matches().map(m => ({ ...m, du: 0.015 + m.u * 0.01, dv: -0.006 + m.v * 0.015 })));
  expect(result).not.toBeNull();
  expect(Math.hypot(...result.x.slice(0, 2), ...result.y.slice(0, 2))).toBeLessThan(0.09);
  expect(result.residualMeters).toBeLessThan(0.01);
});

test('photo registration recovers an image shift only inside measured, visible surface coverage', () => {
  const width = 128, pixels = new Uint8Array(width * width);
  let seed = 7;
  for (let i = 0; i < pixels.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    pixels[i] = 30 + seed % 196;
  }
  const frames = [0, 1].map(id => {
    const colorImage = new Uint8Array(width * width * 4);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      const value = pixels[y * width + Math.max(0, x - id)];
      colorImage.set([value, value, value, 255], (y * width + x) * 4);
    }
    return { textureId: id, frameId: id, colorWidth: width, colorHeight: width, colorChannels: 4, colorImage,
      projectionMatrix: [1,0,0,0,0,1,0,0,0,0,-1,-1,0,0,-0.2,0],
      transformMatrix: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] };
  });
  const records = [];
  for (let y = -1.8; y < 1.8; y += 0.06) for (let x = -1.8; x < 1.8; x += 0.06)
    records.push({ patch: 0, area: 0.0036, center: [x, y, -2], candidates: frames.map((frame, i) => ({ frame, score: 1 - i * 0.1 })) });
  const planes = [{ normal: [0, 0, 1], offset: -2 }];
  const project = (frame, x, y, z) => ({ u: (x / -z + 1) / 2, v: (1 - y / -z) / 2, depth: -z });
  const result = registerSurfaceTextures(records, planes, frames, project, { isVisible: () => true });
  expect(result.diagnostics).toHaveLength(1);
  expect(result.project(frames[1], 0, [0, 0, -2]).u).toBeCloseTo(0.5 + 1 / 127, 2);
  expect(registerSurfaceTextures(records, planes, frames, project, { isVisible: () => false }).diagnostics).toEqual([]);
});
