import * as THREE from "three";

export function createScanFinishGeometry(original, mesh, surfaces, removedSourceFaces, floorLighting) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(original.attributes))
    geometry.setAttribute(name, attribute);
  const counts = new Uint32Array(4);
  for (let face = 0; face < surfaces.labels.length; face++)
    if (!removedSourceFaces?.[face]) counts[surfaces.labels[face]] += 3;
  const offsets = new Uint32Array(4);
  for (let label = 1; label < 4; label++) offsets[label] = offsets[label - 1] + counts[label - 1];
  const cursor = offsets.slice(), indices = new Uint32Array(counts.reduce((sum, count) => sum + count, 0));
  for (let face = 0; face < surfaces.labels.length; face++) {
    if (removedSourceFaces?.[face]) continue;
    const label = surfaces.labels[face];
    for (let corner = 0; corner < 3; corner++) indices[cursor[label]++] = mesh.indices[face * 3 + corner];
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  for (let label = 0; label < 4; label++) if (counts[label])
    geometry.addGroup(offsets[label], counts[label], label);
  // Flooring has its own UV channel in metres. Captured camera-atlas UVs stay
  // untouched, so changing the floor cannot stretch photographs on objects.
  const uv = new Float32Array(mesh.positions.length / 3 * 2);
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++)
    for (let axis = 0; axis < 2; axis++) {
      const basis = surfaces.floorAxes[axis];
      uv[vertex * 2 + axis] = basis[0] * mesh.positions[vertex * 3] +
        basis[1] * mesh.positions[vertex * 3 + 1] + basis[2] * mesh.positions[vertex * 3 + 2];
    }
  geometry.setAttribute("uv1", new THREE.BufferAttribute(uv, 2));
  if (floorLighting) {
    // Captured light uses a separate, nonrepeating channel. Rotating a plank
    // pattern must not move a shadow, including on the adjusted floor edges.
    const lightingUv = Float32Array.from(uv, (value, index) =>
      (value - floorLighting.origin[index % 2]) / floorLighting.size[index % 2]);
    geometry.setAttribute("uv2", new THREE.BufferAttribute(lightingUv, 2));
  }
  geometry.boundingSphere = original.boundingSphere?.clone() || null;
  return geometry;
}
