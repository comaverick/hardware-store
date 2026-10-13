import { identifyScanSurfaces } from "./scanSurfaces";
import { SCAN_DESIGN_SURFACE_VERSION, SCAN_DESIGN_ALGORITHM_VERSION, scanDesignSourceKey } from "./scanDesignSurfaces";

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

test("a prepared ceiling keeps captured walls editable and counts its replacement once", () => {
  const scan = roomScan(), removed = new Uint8Array(scan.mesh.indices.length / 3);
  removed[2] = removed[3] = 1;
  scan.mesh.designSurfaces = {
    version: SCAN_DESIGN_SURFACE_VERSION, sourceAlgorithmVersion: SCAN_DESIGN_ALGORITHM_VERSION,
    sourceKey: scanDesignSourceKey(scan.mesh), removedSourceFaces: removed, walls: [],
    ceilings: [{ indices: new Uint32Array([0, 1, 2, 0, 2, 3]), area: 6 }],
  };
  const surfaces = identifyScanSurfaces(scan);
  expect(Array.from(surfaces.labels)).toEqual([2, 2, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
  expect(surfaces.counts).toEqual({ walls: 2, floor: 2, ceiling: 2 });
  expect(surfaces.areas.ceiling).toBe(6);
  expect(surfaces.areas.walls).toBeCloseTo(5.6);
});

function withPreparedFloor(scan, removed = new Uint8Array(scan.mesh.indices.length / 3), fragments) {
  scan.mesh.designSurfaces = {
    version: SCAN_DESIGN_SURFACE_VERSION, sourceAlgorithmVersion: SCAN_DESIGN_ALGORITHM_VERSION,
    sourceKey: scanDesignSourceKey(scan.mesh), removedSourceFaces: removed, walls: [], ceilings: [],
    floor: { normal: [0, 1, 0], offset: 0, axes: [[1, 0, 0], [0, 0, 1]], area: 3, triangleCount: 2 },
    fragments,
  };
  return scan;
}

test("a prepared floor leaves an uncovered native rim editable and counts each visible sheet once", () => {
  const scan = roomScan(), removed = new Uint8Array(scan.mesh.indices.length / 3);
  removed[0] = 1;
  withPreparedFloor(scan, removed);
  const originalPositions = scan.mesh.positions.slice(), surfaces = identifyScanSurfaces(scan);
  expect(Array.from(surfaces.labels).slice(0, 2)).toEqual([0, 2]);
  expect(surfaces.counts.floor).toBe(3);
  expect(surfaces.areas.floor).toBeCloseTo(6);
  expect(surfaces.floorAxes).toEqual(scan.mesh.designSurfaces.floor.axes);
  expect(scan.mesh.positions).toEqual(originalPositions);
});

test('floor finish axes follow the main room wall while staying on the tilted floor',()=>{
  const scan=withPreparedFloor(roomScan()),angle=.23,n=[-.02,Math.sqrt(1-.02**2-.04**2),-.04];
  scan.mesh.designSurfaces.floor.normal=n;
  scan.mesh.designSurfaces.walls=[{normal:[-Math.sin(angle),0,Math.cos(angle)],area:4,indices:new Uint32Array()}];
  const before=scan.mesh.positions.slice(),axes=identifyScanSurfaces(scan).floorAxes;
  const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  for(const axis of axes) {
    expect(Math.hypot(...axis)).toBeCloseTo(1,7);
    expect(dot(axis,n)).toBeCloseTo(0,7);
  }
  expect(dot(axes[0],axes[1])).toBeCloseTo(0,7);
  expect(Math.atan2(axes[0][2],axes[0][0])).toBeCloseTo(angle,2);
  expect(scan.mesh.positions).toEqual(before);
});

test("prepared floor ownership rejects upright trim, bent curtain geometry and raised noisy sheets", () => {
  const positions = new Float32Array([
    .2, 0, .2, .4, 0, .2, .4, 0, .4, // genuine floor
    .2, 0, .01, .4, 0, .01, .4, .05, .01, // upright skirting
    .2, 0, .2, .4, .05, .2, .4, 0, .4, // curled curtain, tilted .94
    .2, .06, .2, .4, .06, .2, .4, .06, .4, // loose near-floor sheet
  ]);
  const scan = withPreparedFloor({ mesh: { positions, indices: new Uint32Array(Array.from({ length: 12 }, (_, i) => i)),
    texture: { width: 1, height: 1, data: new Uint8Array([160, 150, 140, 255]) }, uvs: new Float32Array(24) },
    captureQuality: { structuralDepth: { planes: [{ kind: "floor", normal: [0, 1, 0], offset: 0 }] } } });
  // The curled triangle was used by an actual reconstructed upright curtain.
  scan.mesh.designSurfaces.fragments = {
    positions: new Float32Array([.2, 0, .2, .4, 0, .2, .4, 1, .2]),
    indices: new Uint32Array([0, 1, 2]), sourceFaces: new Uint32Array([2]),
    finishLabels: new Uint8Array([0]), estimatedTriangleMask: new Uint8Array([1]),
  };
  const surfaces = identifyScanSurfaces(scan);
  expect(Array.from(surfaces.labels)).toEqual([2, 0, 0, 0]);
  expect(surfaces.counts.floor).toBe(3);
});

test("a low native skirting cap matching the upright wall photograph keeps its captured finish", () => {
  const scan = withPreparedFloor({
    mesh: { positions: new Float32Array([.2, 0, .02, .4, 0, .02, .4, 0, .04]),
      indices: new Uint32Array([0, 1, 2]), uvs: new Float32Array(6),
      texture: { width: 1, height: 1, data: new Uint8Array([30, 25, 20, 255]) } },
    captureQuality: { structuralDepth: { planes: [{ kind: "floor", normal: [0, 1, 0], offset: 0 }] } },
  });
  const data = new Uint8Array(8 * 4);
  for (let y = 0; y < 8; y++) data.set(y < 2 ? [30, 25, 20, 255] : [230, 225, 220, 255], y * 4);
  scan.mesh.designSurfaces.walls.push({ normal: [0, 0, 1], offset: 0, axes: [[1, 0, 0], [0, 1, 0]],
    cellSize: .04, extent: [[0, 0], [30, 8]], footprint: new Uint8Array(30 * 8).fill(1),
    texture: { width: 1, height: 8, data }, indices: new Uint32Array(), area: 0 });
  expect(Array.from(identifyScanSurfaces(scan).labels)).toEqual([0]);
});

test("folded native floor undersides receive flooring inside its bounds while objects and wall details stay protected", () => {
  const curl = (x, z) => [x, -.068, z, x + .02, -.081, z, x + .02, -.098, z + .02];
  const positions = new Float32Array([
    ...curl(.2, .2), // orientation fails ordinary floor classification
    .2, .06, .2, .24, .06, .2, .24, .06, .24, // above-floor object
    ...curl(.3, .3), // source of a reconstructed upright curtain
    ...curl(.8, .2), // outside the prepared floor bounds
    .2, -.13, .2, .24, -.13, .2, .24, -.13, .24, // too far below the floor
    ...curl(.2, .1), // under a wall edge, where skirting/curtains must stay captured
    .2, 0, .2, .24, 0, .2, .24, 0, .24, // already replaced native floor
  ]);
  const removed = new Uint8Array(7); removed[6] = 1;
  const scan = withPreparedFloor({ mesh: { positions, indices: new Uint32Array(Array.from({ length: 21 }, (_, i) => i)) },
    captureQuality: { structuralDepth: { planes: [{ kind: "floor", normal: [0, 1, 0], offset: 0 }] } } }, removed, {
    positions: new Float32Array([
      .1, 0, .1, .6, 0, .1, .6, 0, .6,
      .3, 0, .3, .4, 0, .3, .4, 1, .3,
    ]), indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    finishLabels: new Uint8Array([2, 0]), estimatedTriangleMask: new Uint8Array([1, 1]), sourceFaces: new Uint32Array([6, 2]),
  });
  scan.mesh.designSurfaces.walls.push({ normal: [0, 0, 1], offset: 0, indices: new Uint32Array(), area: 0 });
  const originalPositions = positions.slice(), surfaces = identifyScanSurfaces(scan);
  expect(Array.from(surfaces.labels)).toEqual([2, 0, 0, 0, 0, 0, 0]);
  expect(surfaces.counts.floor).toBe(3);
  expect(scan.mesh.positions).toEqual(originalPositions);
});

test("matching photographed floor seeds carry their finish across bent atlas seam edges while distinct objects stay captured", () => {
  const seed = [.2, .06, .2, .3, .07, .2, .3, .06, .3];
  const positions = new Float32Array([
    ...seed,
    .2, .06, .2, .3, .07, .2, .25, 0, .2, // bent side sharing two positions through an atlas seam
    .2, .06, .2, .3, .07, .2, .3, .075, .25, // differently photographed raised object
    .35, .03, .29, .37, .04, .29, .36, 0, .29, // matching color alone cannot authorize a disconnected side
    .26, .07, .3, .3, .075, .3, .3, .07, .34, // matching photographed foreground curtain source
  ]);
  const floorUv = [.05, .1, .35, .1, .35, .8], objectUv = [.65, .1, .85, .1, .85, .8];
  const scan = withPreparedFloor({ mesh: { positions,
    indices: new Uint32Array(Array.from({ length: 15 }, (_, i) => i)),
    uvs: new Float32Array([...floorUv, ...floorUv, ...objectUv, ...floorUv, ...floorUv]),
    texture: { width: 4, height: 1, data: new Uint8Array([
      160, 150, 135, 255, 160, 150, 135, 255, 250, 250, 250, 255, 250, 250, 250, 255,
    ]) } }, captureQuality: { structuralDepth: { planes: [{ kind: "floor", normal: [0, 1, 0], offset: 0 }] } } },
  new Uint8Array(5), {
    positions: new Float32Array([.1, 0, .1, .5, 0, .1, .5, 0, .5, .26, 0, .3, .3, 0, .3, .3, 1, .3]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]), uvs: new Float32Array([...floorUv, ...floorUv]),
    finishLabels: new Uint8Array([2, 0]), estimatedTriangleMask: new Uint8Array([1, 1]), sourceFaces: new Uint32Array([0, 4]),
  });
  const originalPositions = positions.slice(), originalUvs = scan.mesh.uvs.slice(), surfaces = identifyScanSurfaces(scan);
  expect(Array.from(surfaces.labels)).toEqual([2, 2, 0, 0, 0]);
  expect(surfaces.counts.floor).toBe(4);
  expect(scan.mesh.positions).toEqual(originalPositions);
  expect(scan.mesh.uvs).toEqual(originalUvs);
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

test("a photographed floor's bounded depth noise remains finishable while furniture and tall spikes stay captured",()=>{
  const scan=roomScan();
  for(let v=0;v<4;v++) scan.mesh.positions[v*3+1]=.1;
  scan.mesh.texture={width:1,height:1,data:new Uint8Array([200,180,160,255])};
  scan.mesh.uvs=new Float32Array(scan.mesh.positions.length/3*2);
  expect(Array.from(identifyScanSurfaces(scan).labels).slice(0,10)).toEqual([2,2,3,3,1,1,0,0,0,0]);
  scan.mesh.positions[1]=.25;
  expect(identifyScanSurfaces(scan).labels[0]).toBe(0);
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
