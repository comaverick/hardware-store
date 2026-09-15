import * as THREE from "three";
import { createScanMeshResources } from "./renderMesh";

test.each([false, true])("rendering preserves finished positions, topology and colors (texture=%s)", (textured) => {
  // Duplicated vertices are intentional at camera seams. They must not trigger
  // a second plane fit or boundary smoothing in the live/import renderer.
  const mesh = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0.04, 0, 1, 0, 1, 0, 0.04, 1, 1, 0.02, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    colors: new Uint8Array(18).fill(128),
    normals: new Float32Array(Array(6).fill([0, 0, 1]).flat()),
    uvs: new Float32Array([0, 0, 0.5, 0, 0, 1, 0.5, 0, 1, 1, 0, 1]),
    texture: textured ? { width: 2, height: 1, data: new Uint8Array([128, 64, 32, 255, 255, 255, 255, 255]) } : null,
  };
  const before = mesh.positions.slice();
  const resources = createScanMeshResources(mesh);
  expect(resources.geometry.attributes.position.array).toBe(mesh.positions);
  expect(resources.geometry.index.array).toBe(mesh.indices);
  expect(resources.geometry.attributes.normal.array).toBe(mesh.normals);
  expect(resources.geometry.attributes.uv.array).toBe(mesh.uvs);
  expect(resources.geometry.attributes.color.array).toBe(mesh.colors);
  expect(resources.geometry.attributes.color.normalized).toBe(true);
  expect(mesh.positions).toEqual(before);
  expect(resources.texture?.image.data).toBe(mesh.texture?.data);
  expect(resources.texture?.colorSpace).toBe(textured ? THREE.SRGBColorSpace : undefined);
  expect(resources.texture?.flipY).toBe(textured ? false : undefined);
  expect(resources.texture?.generateMipmaps).toBe(textured ? false : undefined);
  resources.texture?.dispose();
  resources.geometry.dispose();
});
