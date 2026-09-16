import { textureAtlasLayout, buildTextureDetailGrid, projectedPatchDetail,
  detailPreservingCandidates, MAX_SCAN_ARRAY_BYTES, MAX_SCAN_MESH_BYTES } from './textureDetail';

test.each([4, 12, 15])('a %i-photo high-resolution atlas fits portable mesh and GPU budgets', (count) => {
  const triangles = 162562;
  const images = Array.from({ length: count }, () => ({ colorWidth: 512, colorHeight: 1024 }));
  const layout = textureAtlasLayout(images, triangles);
  const bytes = layout.width * layout.height * 4;
  expect(bytes).toBeLessThanOrEqual(MAX_SCAN_ARRAY_BYTES);
  expect(bytes + triangles * 117).toBeLessThan(MAX_SCAN_MESH_BYTES);
  expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(4096);
  if (count === 4) expect(layout.tileHeight).toBe(1024);
});
test('atlas sizing respects a smaller device limit and reserves geometry space', () => {
  const images = Array.from({ length: 15 }, () => ({ colorWidth: 1024, colorHeight: 1024 }));
  const layout = textureAtlasLayout(images, 250000, 2048);
  expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(2048);
  expect(layout.width * layout.height * 4 + 250000 * 117).toBeLessThan(MAX_SCAN_MESH_BYTES);
});
test('a sharper valid local view cannot lose to seam voting, without banning flat or sole-source photos', () => {
  const sharp = { localFocus: 12, localDetail: 20, pixelDensity: 160 };
  const blurred = { localFocus: 2, localDetail: 12, pixelDensity: 170 };
  expect(detailPreservingCandidates([blurred, sharp])).toEqual([sharp]);
  expect(detailPreservingCandidates([blurred])).toEqual([blurred]);
  const flat = { localFocus: 0, localDetail: 0, pixelDensity: 170 };
  expect(detailPreservingCandidates([flat, { ...flat }])).toHaveLength(2);
});
test('local focus ignores sharp detail elsewhere in the image', () => {
  const frame = { colorWidth: 64, colorHeight: 64, colorChannels: 4,
    colorImage: new Uint8Array(64 * 64 * 4) };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const c = x < 32 ? 140 : (x + y) % 2 ? 60 : 220;
    frame.colorImage.set([c, c, c, 255], (y * 64 + x) * 4);
  }
  frame.textureDetailGrid = buildTextureDetailGrid(frame);
  expect(projectedPatchDetail(frame, { u: 0.2, v: 0.5 }).focus).toBe(0);
  expect(projectedPatchDetail(frame, { u: 0.8, v: 0.5 }).focus).toBeGreaterThan(50);
});
