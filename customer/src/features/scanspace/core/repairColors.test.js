import { fillSmallMeshHoles } from './fusion';
import { blendRepairColors } from './repairColors';

function fixture() {
  const positions = [], indices = [];
  for (let y = 0; y <= 3; y++) for (let x = 0; x <= 3; x++) positions.push(x * .1, y * .1, -2);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (x === 1 && y === 1) continue;
    const a = y * 4 + x;
    indices.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
  }
  const source = { positions: new Float32Array(positions), indices: new Uint32Array(indices),
    colors: new Uint8Array(positions.length).fill(30) };
  const mesh = fillSmallMeshHoles(source, { maxDiameter: .2 });
  const records = [], edges = new Map();
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = Array.from(mesh.indices.subarray(index, index + 3));
    const p = triangle.map(id => Array.from(mesh.positions.subarray(id * 3, id * 3 + 3)));
    const estimated = !!mesh.estimatedTriangleMask[index / 3];
    const record = { triangle, estimated, faceNormal: { x: 0, y: 0, z: 1 }, area: .0025,
      center: [0, 1, 2].map(axis => p.reduce((sum, point) => sum + point[axis] / 3, 0)),
      candidates: estimated ? [] : [{ score: 1 }], selected: 0, neighbors: [] };
    const id = records.length;
    records.push(record);
    triangle.forEach((a, corner) => {
      const b = triangle[(corner + 1) % 3], key = [a, b].sort((u, v) => u - v).join(',');
      if (edges.has(key)) {
        const neighbor = edges.get(key);
        records[neighbor].neighbors.push(id);
        record.neighbors.push(neighbor);
      } else edges.set(key, id);
    });
  }
  const observed = (record, corner) => {
    const id = record.triangle[corner], x = mesh.positions[id * 3], y = mesh.positions[id * 3 + 1];
    return [40 + x / .3 * 100, 80 + y / .3 * 30, 20];
  };
  return { mesh, records, observed, center: source.positions.length / 3 };
}

test('a repaired hole blends its own observed rim with a smooth gradient and immutable inputs', () => {
  const { mesh, records, observed, center } = fixture(), original = mesh.colors.slice();
  const result = blendRepairColors(mesh, records, observed);
  expect(result.diagnostics.groups).toBe(1);
  expect(result.diagnostics.triangles).toBe(4);
  expect(result.diagnostics.interiorVertices).toBe(1);
  const color = Array.from(result.colors.subarray(center * 3, center * 3 + 3));
  expect(color).toEqual([90, 95, 20]);
  expect(mesh.colors).toEqual(original);
  for (const record of records.filter(record => record.estimated)) for (let corner = 0; corner < 3; corner++) {
    const id = record.triangle[corner];
    if (id === center) continue;
    expect(Array.from(result.colors.subarray(id * 3, id * 3 + 3)))
      .toEqual(observed(record, corner).map(Math.round));
  }
});

test('no photographed boundary leaves the estimate uncolored', () => {
  const { mesh, records } = fixture();
  const result = blendRepairColors(mesh, records, () => null);
  expect(result.diagnostics.triangles).toBe(0);
  expect(result.colors).toEqual(mesh.colors);
});

test('nearby colors across a perpendicular fold cannot color the repaired surface', () => {
  const { mesh, records, observed } = fixture();
  records.filter(record => !record.estimated).forEach(record => { record.faceNormal = { x: 1, y: 0, z: 0 }; });
  expect(blendRepairColors(mesh, records, observed).diagnostics.triangles).toBe(0);
});

test('a group of estimates larger than the repair bound cannot diffuse its appearance', () => {
  const { mesh, records, observed } = fixture();
  for (let index = 0; index < mesh.positions.length; index += 3) mesh.positions[index] *= 15;
  expect(blendRepairColors(mesh, records, observed).diagnostics.triangles).toBe(0);
});
