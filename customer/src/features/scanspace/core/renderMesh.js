import * as THREE from "three";

// Live, saved and imported scans display the exact same finished geometry.
// Moving vertices here folds small triangles and stretches already-baked UVs.
// All geometry correction belongs in fusion, BEFORE camera projection.
export function createScanMeshResources(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3, true));
  if (mesh.uvs)
    geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  if (mesh.normals)
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  if (!mesh.normals) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  let texture = null;
  if (mesh.texture?.data) {
    texture = new THREE.DataTexture(
      mesh.texture.data, mesh.texture.width, mesh.texture.height, THREE.RGBAFormat,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    // Independently exposed atlas tiles must never bleed into one another.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }
  return { geometry, texture };
}
