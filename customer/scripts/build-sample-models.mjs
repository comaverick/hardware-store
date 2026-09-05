// Original, locally generated sample models. These are design examples, not store stock.
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};
const folder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/scanspace/models",
);
await fs.mkdir(folder, { recursive: true });
function box(group, size, pos, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color, roughness: 0.82 }),
  );
  mesh.position.set(...pos);
  group.add(mesh);
  return mesh;
}
function legs(g, w, d, h, color) {
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      box(
        g,
        [0.055, h, 0.055],
        [x * (w / 2 - 0.1), h / 2, z * (d / 2 - 0.08)],
        color,
      );
}
const sofa = new THREE.Group();
legs(sofa, 2.3, 0.9, 0.14, "#543e2d");
box(sofa, [2.3, 0.23, 0.9], [0, 0.24, 0], "#b97550");
box(sofa, [2.3, 0.52, 0.15], [0, 0.59, -0.375], "#b97550");
for (const x of [-1, 1])
  box(sofa, [0.17, 0.44, 0.9], [x * 1.065, 0.4, 0], "#c28462");
for (const x of [-0.5, 0.5]) {
  box(sofa, [0.96, 0.16, 0.68], [x, 0.425, 0.055], "#ce9573");
  const cushion = box(sofa, [0.93, 0.36, 0.13], [x, 0.66, -0.23], "#c89070");
  cushion.rotation.x = -0.09;
}
const table = new THREE.Group();
legs(table, 1.15, 0.6, 0.37, "#584330");
box(table, [1.15, 0.05, 0.6], [0, 0.395, 0], "#9e7c53");
const cabinet = new THREE.Group();
legs(cabinet, 1.5, 0.45, 0.12, "#453c31");
box(cabinet, [1.5, 0.73, 0.45], [0, 0.485, 0], "#b99b72");
for (const x of [-0.5, 0, 0.5]) {
  box(cabinet, [0.48, 0.66, 0.02], [x, 0.49, 0.236], "#c7ad89");
  box(cabinet, [0.018, 0.15, 0.025], [x + 0.17, 0.56, 0.26], "#5b5142");
}
for (const [name, scene] of Object.entries({ sofa, table, cabinet })) {
  const binary = await new GLTFExporter().parseAsync(scene, { binary: true });
  await fs.writeFile(path.join(folder, `${name}.glb`), Buffer.from(binary));
}
