import { smoothPositions } from './fusion';

function surface(depth) {
  const positions = [], indices = [], n = 60;
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++)
    positions.push(x * 0.02, y * 0.02, depth(x, y));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x;
    indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

test('normal denoising reduces small ripples without changing topology or boundary', () => {
  const mesh = surface((x, y) => 0.002 * Math.sin(x * 2.2 + y * 1.7));
  const before = mesh.positions.slice();
  const result = smoothPositions(mesh, 2, 0.022);
  const rms = (values) => Math.sqrt(values.reduce((sum, v, i) => sum + (i % 3 === 2 ? v * v : 0), 0));
  expect(rms(result.positions)).toBeLessThan(rms(before) * 0.85);
  expect(result.indices).toBe(mesh.indices);
  expect(mesh.positions).toEqual(before);
  expect(result.positions.slice(0, 61 * 3)).toEqual(before.slice(0, 61 * 3));
  expect(result.denoising.maxDisplacementMeters).toBeLessThanOrEqual(0.003001);
});

test('repeated smoothing cannot erase curtain relief or a raised picture edge', () => {
  const shape = (x, y) => x < 30 ? 0.035 * Math.cos(x * 0.32) : x > 36 && x < 53 && y > 16 && y < 43 ? 0.035 : 0;
  const mesh = surface(shape);
  const result = smoothPositions(mesh, 12, 0.022);
  const folds = [], picture = [];
  for (let y = 8; y < 52; y++) for (let x = 2; x < 58; x++) {
    const z = result.positions[(y * 61 + x) * 3 + 2];
    if (x < 28) folds.push(z);
    if (x > 39 && x < 50 && y > 19 && y < 40) picture.push(z);
  }
  expect(Math.max(...folds) - Math.min(...folds)).toBeGreaterThan(0.06);
  expect(Math.min(...picture)).toBeGreaterThan(0.033);
  expect(result.denoising.maxDisplacementMeters).toBeLessThanOrEqual(0.003001);
  expect(result.indices).toBe(mesh.indices);
});
