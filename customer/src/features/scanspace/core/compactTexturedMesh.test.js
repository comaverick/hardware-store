import { compactTexturedMesh } from './compactTexturedMesh';

function fixture() {
  return { positions: new Float32Array([0,0,0,1,0,0,0,1,0,1,0,0,1,1,0,0,1,0]),
    normals: new Float32Array(Array(6).fill([0,0,1]).flat()), colors: new Uint8Array(18).fill(255),
    uvs: new Float32Array([0,0,1,0,0,1,1,0,1,1,0,1]), indices: new Uint32Array([0,1,2,3,4,5]),
    estimatedTriangleMask: new Uint8Array([0,1]), texture: { data: new Uint8Array(4) } };
}
test('compaction preserves every rendered corner and estimate while reducing duplicate storage', () => {
  const original = fixture(), result = compactTexturedMesh(original);
  expect(result.positions.length).toBe(12);
  for (let i = 0; i < original.indices.length; i++) for (const [name,size] of [['positions',3],['normals',3],['colors',3],['uvs',2]]) {
    expect(result[name].subarray(result.indices[i]*size,(result.indices[i]+1)*size))
      .toEqual(original[name].subarray(original.indices[i]*size,(original.indices[i]+1)*size));
  }
  expect(result.estimatedTriangleMask).toBe(original.estimatedTriangleMask);
  expect(result.texture).toBe(original.texture);
  expect(original.positions.length).toBe(18);
});
test.each(['uvs','normals','colors'])('a %s seam retains its own corners', attribute => {
  const original = fixture(), size = attribute === 'uvs' ? 2 : 3;
  original[attribute][3*size] = .5;
  expect(compactTexturedMesh(original).positions.length).toBe(15);
});
