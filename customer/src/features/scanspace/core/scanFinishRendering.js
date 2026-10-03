import * as THREE from "three";
import { floorFinishes } from "./scanCustomization";

export function createScanFinishGeometry(original, mesh, surfaces, removedSourceFaces) {
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
  geometry.boundingSphere = original.boundingSphere?.clone() || null;
  return geometry;
}

export function createFloorFinishTexture(selection) {
  const finish = floorFinishes.find(value => value.id === selection?.finishId);
  if (!finish) return null;
  const size = 256, pixels = new Uint8Array(size * size * 4);
  const rgb = [1, 3, 5].map(offset => parseInt(finish.color.slice(offset, offset + 2), 16));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = ((Math.imul(x + 19, 374761393) ^ Math.imul(y + 31, 668265263)) >>> 0) % 17 / 17 - .5;
    const grain = finish.pattern === "plank"
      ? Math.sin(y * .38 + Math.sin(x * .025) * 1.8) * 8 + Math.sin(y * 1.9) * 3 + noise * 6
      : Math.sin(x * .027 + y * .021) * 4 + noise * 4;
    const seam = finish.pattern === "tile" ? x < 2 || y < 2 : x < 1 || y < 4;
    const pixel = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++)
      pixels[pixel + channel] = Math.max(0, Math.min(255,
        seam ? rgb[channel] * (finish.pattern === "tile" ? .8 : .68) : rgb[channel] + grain));
    pixels[pixel + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.channel = 1;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.repeat.set(finish.pattern === "tile" ? 1 / .6 : 1 / 1.2,
    finish.pattern === "tile" ? 1 / .6 : 1 / .18);
  texture.rotation = selection.direction === "crosswise" ? Math.PI / 2 : 0;
  texture.needsUpdate = true;
  return texture;
}
