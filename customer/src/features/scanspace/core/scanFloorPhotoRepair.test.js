import { repairFloorPhotos } from "./scanFloorPhotoRepair";

function fixture(fragment = false) {
  const mesh = {
    positions: new Float32Array([.12, 0, .12, .12, 0, .2, .2, 0, .12]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Uint8Array(9).fill(120), uvs: new Float32Array(6).fill(.005),
    indices: new Uint32Array([0, 1, 2]),
  };
  const fragments = Object.fromEntries(Object.entries(mesh).map(([k, values]) => [k, fragment ? Array.from(values) : []]));
  fragments.sourceFaces = fragment ? [0] : [];
  fragments.estimatedTriangleMask = fragment ? [1] : [];
  const floor = { kind: "floor", normal: [0, 1, 0], offset: 0, axes: [[1, 0, 0], [0, 0, 1]], cellSize: .12,
    cells: new Map([["1,1", new Set([0, 1, 2])]]) };
  const frame = { columns: 10, rows: 10, measuredMask: new Uint8Array(100).fill(1),
    filteredDepth: new Float32Array(100).fill(1.85), colorWidth: 512, colorHeight: 1024,
    atlasUVTransform: [.1, .2, .3, .4], transformMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, .6, 1, .6, 1] };
  const helpers = { textureFrames: [frame], projectColor: (f, x, y, z) => ({ u: x, v: z }),
    project: (f, x, y, z) => ({ u: x, v: z, depth: 2 }), unproject: () => [.15, .03, .15] };
  return { mesh, fragments, planes: [floor], helpers, removed: new Uint8Array([fragment ? 1 : 0]) };
}

test.each([false, true])("a native floor photo restores constant-color %s display faces without moving measured geometry", fragment => {
  const { mesh, planes, helpers, fragments, removed } = fixture(fragment);
  const before = Object.fromEntries(Object.entries(mesh).map(([k, a]) => [k, a.slice()]));
  const result = repairFloorPhotos(mesh, planes, helpers, fragments, removed);
  expect(result.repairedFloorPhotoTriangles).toBe(1);
  expect(mesh).toEqual(before);
  expect(fragments.positions).toEqual(Array.from(mesh.positions));
  expect(fragments.colors.every(v => v === 255)).toBe(true);
  expect(fragments.sourceFaces).toEqual([0]);
  expect(fragments.estimatedTriangleMask).toEqual([1]);
  for (let c = 0; c < 3; c++) {
    expect(fragments.uvs[c * 2]).toBeCloseTo(.1 + mesh.positions[c * 3] * .3, 6);
    expect(fragments.uvs[c * 2 + 1]).toBeCloseTo(.2 + (1 - mesh.positions[c * 3 + 2]) * .4, 6);
  }
});

test.each(["foreground", "missingNativeDepth", "unsupportedFloor", "alreadyPhotographed"])("%s cannot supply a replacement floor photograph", kind => {
  const { mesh, planes, helpers, fragments, removed } = fixture();
  if (kind === "foreground") helpers.unproject = () => [.15, .3, .15];
  if (kind === "missingNativeDepth") helpers.textureFrames[0].measuredMask.fill(0);
  if (kind === "unsupportedFloor") planes[0].cells.clear();
  if (kind === "alreadyPhotographed") mesh.uvs[2] = .02;
  expect(repairFloorPhotos(mesh, planes, helpers, fragments, removed).repairedFloorPhotoTriangles).toBe(0);
  expect(removed[0]).toBe(0);
  expect(fragments.indices).toHaveLength(0);
});
