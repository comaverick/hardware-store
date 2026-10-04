import { createScanMeshResources } from "./renderMesh";
import { createScanFinishGeometry } from "./scanFinishRendering";

test("finish grouping retains each triangle and leaves camera colors and UVs unchanged", () => {
  const mesh = {
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 0, 3, 2, 0, 3]),
    indices: new Uint32Array([0, 1, 2, 2, 1, 3]), colors: new Uint8Array(12).fill(255),
    uvs: new Float32Array([.1, .2, .3, .4, .5, .6, .7, .8]),
  };
  const original = createScanMeshResources(mesh);
  const geometry = createScanFinishGeometry(original.geometry, mesh,
    { labels: new Uint8Array([2, 0]), floorAxes: [[1, 0, 0], [0, 0, 1]] }, null,
    { origin: [-.4, -.4], size: [4, 4] });
  expect(geometry.attributes.position).toBe(original.geometry.attributes.position);
  expect(geometry.attributes.color.array).toBe(mesh.colors);
  expect(geometry.attributes.uv.array).toBe(mesh.uvs);
  expect(Array.from(geometry.index.array)).toEqual([2, 1, 3, 0, 1, 2]);
  expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 2, 1, 3]);
  expect(geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 2 }]);
  expect(Array.from(geometry.attributes.uv1.array)).toEqual([0, 0, 2, 0, 0, 3, 2, 3]);
  expect(Array.from(geometry.attributes.uv2.array)).toEqual(Array.from(new Float32Array([.1,.1, .6,.1, .1,.85, .6,.85])));
  expect(original.geometry.attributes.uv2).toBeUndefined();
  geometry.dispose(); original.geometry.dispose();
});
