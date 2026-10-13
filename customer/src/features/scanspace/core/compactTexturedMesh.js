// Share only byte-identical finished corners. Photo seams, opposite normals,
// repaired colors and every triangle remain unchanged. The saved scan can keep
// its photographs at higher resolution instead of spending its budget on copies
// of the same vertex at every adjacent triangle.
export function compactTexturedMesh(mesh) {
  if (!mesh.uvs || !mesh.normals || !mesh.colors) return mesh;
  const positions = new Uint32Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.length);
  const normals = new Uint32Array(mesh.normals.buffer, mesh.normals.byteOffset, mesh.normals.length);
  const uvs = new Uint32Array(mesh.uvs.buffer, mesh.uvs.byteOffset, mesh.uvs.length);
  const count = mesh.positions.length / 3, mapping = new Uint32Array(count), retained = [], buckets = new Map();
  const equal = (a, b) => [0,1,2].every(i => positions[a*3+i] === positions[b*3+i] &&
    normals[a*3+i] === normals[b*3+i] && mesh.colors[a*3+i] === mesh.colors[b*3+i]) &&
    uvs[a*2] === uvs[b*2] && uvs[a*2+1] === uvs[b*2+1];
  for (let v = 0; v < count; v++) {
    let hash = 2166136261;
    for (let i = 0; i < 3; i++) {
      hash = Math.imul(hash ^ positions[v*3+i],16777619);
      hash = Math.imul(hash ^ normals[v*3+i],16777619);
      hash = Math.imul(hash ^ mesh.colors[v*3+i],16777619);
    }
    hash = Math.imul(hash ^ uvs[v*2],16777619); hash = Math.imul(hash ^ uvs[v*2+1],16777619);
    const bucket = buckets.get(hash), previous = bucket?.find(i => equal(v, retained[i]));
    if (previous !== undefined) { mapping[v] = previous; continue; }
    mapping[v] = retained.length;
    if (bucket) bucket.push(retained.length); else buckets.set(hash,[retained.length]);
    retained.push(v);
  }
  if (retained.length === count) return mesh;
  const copy = (array, size) => {
    const output = new array.constructor(retained.length * size);
    retained.forEach((v, i) => output.set(array.subarray(v*size,v*size+size),i*size));
    return output;
  };
  return { ...mesh, positions: copy(mesh.positions,3), normals: copy(mesh.normals,3), colors: copy(mesh.colors,3),
    uvs: copy(mesh.uvs,2), indices: Uint32Array.from(mesh.indices,v => mapping[v]) };
}
