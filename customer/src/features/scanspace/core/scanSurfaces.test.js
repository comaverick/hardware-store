import { identifyScanSurfaces } from "./scanSurfaces";

function roomScan(diagnostics = true) {
  const positions = [], indices = [];
  function quad(a, b, c, d) {
    const start = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  quad([0, 0, 0], [2, 0, 0], [2, 0, 3], [0, 0, 3]);
  quad([0, 2.8, 0], [2, 2.8, 0], [2, 2.8, 3], [0, 2.8, 3]);
  quad([0, 0, 0], [2, 0, 0], [2, 2.8, 0], [0, 2.8, 0]);
  quad([.2, .2, .25], [1.2, .2, .25], [1.2, 1.2, .25], [.2, 1.2, .25]); // cabinet
  quad([.2, .8, .2], [1.2, .8, .2], [1.2, .8, 1.2], [.2, .8, 1.2]); // table top
  quad([.2, 1.2, .12], [1.2, 1.2, .12], [1.2, 2.2, .12], [.2, 2.2, .12]); // framed picture
  return {
    mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
    cloud: { floorY: 0 },
    captureQuality: diagnostics ? { structuralDepth: { planes: [
      { kind: "floor", normal: [0, 1, 0], offset: 0 },
      { kind: "ceiling", normal: [0, 1, 0], offset: 2.8 },
      { kind: "wall", normal: [0, 0, 1], offset: 0 },
    ] } } : null,
  };
}

test.each([true, false])("surface targeting preserves table tops, cabinets, and raised pictures (diagnostics: %s)", diagnostics => {
  const scan = roomScan(diagnostics), originalPositions = scan.mesh.positions.slice(), originalIndices = scan.mesh.indices.slice();
  const surfaces = identifyScanSurfaces(scan);
  expect(Array.from(surfaces.labels)).toEqual([2, 2, 3, 3, 1, 1, 0, 0, 0, 0, 0, 0]);
  expect(surfaces.counts).toEqual({ walls: 2, floor: 2, ceiling: 2 });
  expect(scan.mesh.positions).toEqual(originalPositions);
  expect(scan.mesh.indices).toEqual(originalIndices);
});

test("a tilted measured plane stays editable while a distant parallel sheet stays captured", () => {
  const scan = roomScan();
  const normal = [0, .9950371902, .099503719];
  for (let vertex = 0; vertex < 4; vertex++) scan.mesh.positions[vertex * 3 + 1] = -.1 * scan.mesh.positions[vertex * 3 + 2];
  scan.captureQuality.structuralDepth.planes[0].normal = normal;
  expect(Array.from(identifyScanSurfaces(scan).labels).slice(0, 2)).toEqual([2, 2]);
});

test("wall depth noise remains paintable while raised objects retain their captured finish", () => {
  const scan = roomScan();
  for (let vertex = 8; vertex < 12; vertex++) scan.mesh.positions[vertex * 3 + 2] = .055;
  expect(Array.from(identifyScanSurfaces(scan).labels).slice(4)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
});

test("nearby photo-textured wall layers receive paint while picture details stay captured", () => {
  const scan = roomScan();
  for (let vertex = 8; vertex < 12; vertex++) scan.mesh.positions[vertex * 3 + 2] = .12;
  scan.mesh.texture = { width: 2, height: 1, data: new Uint8Array([235, 230, 220, 255, 20, 35, 80, 255]) };
  scan.mesh.uvs = new Float32Array(scan.mesh.positions.length / 3 * 2);
  for (let vertex = 0; vertex < scan.mesh.positions.length / 3; vertex++) {
    scan.mesh.uvs[vertex * 2] = vertex >= 20 ? .75 : .25;
    scan.mesh.uvs[vertex * 2 + 1] = .5;
  }
  expect(Array.from(identifyScanSurfaces(scan).labels).slice(4)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
});

test("point-only results have no editable surfaces", () => {
  expect(identifyScanSurfaces({ cloud: { floorY: 0 } }).counts).toEqual({ walls: 0, floor: 0, ceiling: 0 });
});

test("invalid optional plane diagnostics do not prevent a portable mesh from opening", () => {
  const scan = roomScan(false);
  scan.captureQuality = { structuralDepth: { planes: { unknown: true } },
    planarConsolidation: { planes: [null, { kind: "wall", normal: [0, 0, 1], offset: "unknown" }] } };
  expect(identifyScanSurfaces(scan).counts).toEqual({ walls: 2, floor: 2, ceiling: 2 });
});

test.each([
  [[235, 230, 220], [20, 35, 80]],
  [[40, 80, 50], [220, 175, 100]],
])("a photo on a flush wall keeps its appearance without requiring a white wall (%s)", (wall, picture) => {
  const scan = roomScan();
  // This picture has no useful depth separation from the background wall.
  for (let vertex = 20; vertex < 24; vertex++) scan.mesh.positions[vertex * 3 + 2] = 0;
  scan.mesh.colors = new Uint8Array(scan.mesh.positions.length).fill(255);
  scan.mesh.texture = { width: 2, height: 1, data: new Uint8Array([...wall, 255, ...picture, 255]) };
  scan.mesh.uvs = new Float32Array(scan.mesh.positions.length / 3 * 2);
  for (let vertex = 0; vertex < scan.mesh.positions.length / 3; vertex++) {
    scan.mesh.uvs[vertex * 2] = vertex >= 20 ? .75 : .25;
    scan.mesh.uvs[vertex * 2 + 1] = .5;
  }
  const originalTexture = scan.mesh.texture.data.slice(), originalUVs = scan.mesh.uvs.slice();
  expect(Array.from(identifyScanSurfaces(scan).labels)).toEqual([2, 2, 3, 3, 1, 1, 0, 0, 0, 0, 0, 0]);
  expect(scan.mesh.texture.data).toEqual(originalTexture);
  expect(scan.mesh.uvs).toEqual(originalUVs);
});

test("pale highlights inside a detailed picture are preserved with the rest of the picture", () => {
  const positions = [], indices = [], uvs = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const start = positions.length / 3;
    positions.push(x / 10, y / 10, 0, (x + 1) / 10, y / 10, 0,
      (x + 1) / 10, (y + 1) / 10, 0, x / 10, (y + 1) / 10, 0);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    const picture = x >= 5 && x < 14 && y >= 5 && y < 14 && !(x === 9 && y === 9);
    for (let corner = 0; corner < 4; corner++) uvs.push(picture ? .75 : .25, .5);
  }
  const scan = {
    mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices), uvs: new Float32Array(uvs),
      texture: { width: 2, height: 1, data: new Uint8Array([235, 230, 220, 255, 20, 35, 80, 255]) } },
    captureQuality: { structuralDepth: { planes: [{ kind: "wall", normal: [0, 0, 1], offset: 0 }] } },
  };
  const surfaces = identifyScanSurfaces(scan);
  expect(surfaces.labels[(9 * 20 + 9) * 2]).toBe(0);
  expect(surfaces.labels[(1 * 20 + 1) * 2]).toBe(1);
});

test("shadowed parts of a portable wall remain paintable without changing the captured photo", () => {
  const positions = [], indices = [], uvs = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const start = positions.length / 3;
    positions.push(x / 10, y / 10, 0, (x + 1) / 10, y / 10, 0,
      (x + 1) / 10, (y + 1) / 10, 0, x / 10, (y + 1) / 10, 0);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    for (let corner = 0; corner < 4; corner++) uvs.push(x >= 5 && x < 12 && y >= 5 && y < 12 ? .75 : .25, .5);
  }
  const scan = {
    mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices), uvs: new Float32Array(uvs),
      texture: { width: 2, height: 1, data: new Uint8Array([235, 230, 220, 255, 110, 108, 103, 255]) } },
    captureQuality: { structuralDepth: { planes: [{ kind: "wall", normal: [0, 0, 1], offset: 0 }] } },
  };
  const before = scan.mesh.texture.data.slice();
  expect(identifyScanSurfaces(scan).labels.every(label => label === 1)).toBe(true);
  expect(scan.mesh.texture.data).toEqual(before);
});

test("portable monochrome pictures retain their photographed texture on a flush wall", () => {
  const scan = roomScan();
  for (let vertex = 20; vertex < 24; vertex++) scan.mesh.positions[vertex * 3 + 2] = 0;
  const width = 32, height = 32, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = x === 0 ? 235 : (x + y) % 8 < 4 ? 230 : 30;
    data.set([value, value, value, 255], (y * width + x) * 4);
  }
  scan.mesh.texture = { width, height, data };
  scan.mesh.uvs = new Float32Array(scan.mesh.positions.length / 3 * 2).fill(.01);
  scan.mesh.uvs.set([.1, .1, .95, .1, .95, .95, .1, .95], 20 * 2);
  expect(Array.from(identifyScanSurfaces(scan).labels).slice(-2)).toEqual([0, 0]);
});
