import { consolidatePlanarSurfaces } from './planarSurface';

function sheet({ z = () => 0, origin = [0, 0, 0], rotate = false, hole = false, size = 2, step = 0.1 } = {}) {
  const positions = [], indices = [], colors = [], n = Math.round(size / step);
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
    const p = [x * step, y * step, z(x * step, y * step)];
    if (rotate) [p[0], p[2]] = [p[2], p[0]];
    positions.push(...p.map((v, i) => v + origin[i])); colors.push(120, 90, 60);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (hole && x >= n * 0.3 && x < n * 0.7 && y >= n * 0.3 && y < n * 0.7) continue;
    const a = y * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), colors: new Uint8Array(colors) };
}
function join(...meshes) {
  const positions = [], indices = [], colors = [];
  for (const m of meshes) { const offset = positions.length / 3; indices.push(...Array.from(m.indices, (i) => i + offset)); positions.push(...m.positions); colors.push(...m.colors); }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), colors: new Uint8Array(colors) };
}
function area(mesh) {
  let value = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const p = Array.from(mesh.indices.slice(i, i + 3), (id) => Array.from(mesh.positions.slice(id * 3, id * 3 + 3)));
    const a = p[1].map((v, j) => v - p[0][j]), b = p[2].map((v, j) => v - p[0][j]);
    value += Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) / 2;
  }
  return value;
}
test('bowed, overlapping wall sheets become one exact plane without losing their unique extent', () => {
  const source = join(sheet({ z: (x) => 0.025 * Math.sin(x * Math.PI) }), sheet({ origin: [0.04, 0, 0.035], z: (x) => 0.02 * Math.sin(x * Math.PI) }));
  const before = new Float32Array(source.positions);
  const result = consolidatePlanarSurfaces(source);
  expect(result.planarConsolidation.planes).toHaveLength(1);
  const plane = result.planarConsolidation.planes[0];
  expect(result.planarConsolidation.removedOverlapArea).toBeGreaterThan(3.8);
  expect(area(result)).toBeGreaterThan(4);
  expect(area(result)).toBeLessThan(4.15);
  for (let i = 0; i < result.positions.length; i += 3) {
    const residual = plane.normal.reduce((sum, n, axis) => sum + n * result.positions[i + axis], -plane.offset);
    expect(Math.abs(residual)).toBeLessThan(1e-6);
  }
  expect(source.positions).toEqual(before);
  expect(result.colors.length).toBe(result.positions.length);
});
test('deduplication does not fill an unscanned opening', () => {
  const result = consolidatePlanarSurfaces(join(sheet({ hole: true }), sheet({ hole: true, origin: [0, 0, 0.04] })));
  expect(result.planarConsolidation.planes).toHaveLength(1);
  expect(area(result)).toBeCloseTo(4 - 0.8 * 0.8, 4);
  for (let i = 0; i < result.indices.length; i += 3) {
    const ids = Array.from(result.indices.slice(i, i + 3));
    const x = ids.reduce((s, id) => s + result.positions[id * 3], 0) / 3;
    const y = ids.reduce((s, id) => s + result.positions[id * 3 + 1], 0) / 3;
    expect(x > 0.60001 && x < 1.39999 && y > 0.60001 && y < 1.39999).toBe(false);
  }
});
test('real curtain folds and narrow curved strips are not treated as flat walls', () => {
  const source = sheet({ z: (x) => 0.11 * Math.sin(x * Math.PI * 5) });
  const result = consolidatePlanarSurfaces(source);
  expect(result.planarConsolidation.planes).toHaveLength(0);
  expect(result.positions).toBe(source.positions);
});
test('separate parallel surfaces and perpendicular corners retain their geometry', () => {
  const source = join(sheet(), sheet({ origin: [0, 0, 0.25] }), sheet({ rotate: true, origin: [2, 0, 0] }));
  const result = consolidatePlanarSurfaces(source);
  expect(result.planarConsolidation.planes.length).toBeGreaterThanOrEqual(3);
  expect(area(result)).toBeCloseTo(12, 3);
  expect(result.planarConsolidation.removedOverlapArea).toBeLessThan(0.0001);
});
test('a measured non-axis-aligned straight wall retains its actual angle', () => {
  const source = sheet({ z: (x, y) => x * 0.24 + y * 0.04 });
  const result = consolidatePlanarSurfaces(source);
  expect(result.planarConsolidation.planes).toHaveLength(1);
  expect(area(result)).toBeCloseTo(area(source), 4);
  for (let i = 0; i < result.positions.length; i += 3)
    expect(result.positions[i + 2]).toBeCloseTo(result.positions[i] * 0.24 + result.positions[i + 1] * 0.04, 5);
});
test('small partial scans can still finish unchanged', () => {
  const source = sheet({ size: 0.4 });
  const result = consolidatePlanarSurfaces(source);
  expect(result.indices).toBe(source.indices);
});
test('a thin solid with measured side faces is not mistaken for duplicate wall layers', () => {
  const back = sheet(), front = sheet({ origin: [0, 0, 0.04] });
  const side = { positions: new Float32Array([0, 0, 0, 0, 2, 0, 0, 0, 0.04, 0, 2, 0.04]), indices: new Uint32Array([0, 1, 2, 1, 3, 2]), colors: new Uint8Array(12) };
  const source = join(back, front, side);
  const result = consolidatePlanarSurfaces(source);
  expect(result.planarConsolidation.planes).toHaveLength(0);
  expect(result.positions).toBe(source.positions);
});
test('planar output retains shared edges for camera seam voting', () => {
  const result = consolidatePlanarSurfaces(sheet());
  expect(result.positions.length / 3).toBeLessThan(result.indices.length / 2);
  expect(result.normals).toBeUndefined();
});
test('oppositely wound duplicate sheets become one consistently oriented surface', () => {
  const other = sheet({ origin: [0.025, 0, 0.035] });
  for (let i = 0; i < other.indices.length; i += 3) [other.indices[i], other.indices[i + 1]] = [other.indices[i + 1], other.indices[i]];
  const result = consolidatePlanarSurfaces(join(sheet(), other));
  const signs = new Set();
  for (let i = 0; i < result.indices.length; i += 3) {
    const [a, b, c] = Array.from(result.indices.slice(i, i + 3), (id) => id * 3);
    signs.add(Math.sign((result.positions[b] - result.positions[a]) * (result.positions[c + 1] - result.positions[a + 1]) - (result.positions[b + 1] - result.positions[a + 1]) * (result.positions[c] - result.positions[a])));
  }
  expect(signs.size).toBe(1);
  expect(signs.has(0)).toBe(false);
});
