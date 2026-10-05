import { buildScanDesignSurfaces, getScanDesignSurfaces } from "./scanDesignSurfaces";
import { surfaceTopologyDiagnostics } from "./surfaceTopology";
import { estimateWallLighting } from "./scanWallLighting";

function fixture({ opening = false, foreground = false, gap = false, stationary = false } = {}) {
  const positions = [], indices = [], colors = [], normals = [];
  const size = 1.2, cell = .04, columns = 30, rows = 30;
  function quad(x, y, depth) {
    const start = positions.length / 3;
    for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      positions.push((x + dx) * cell, (y + dy) * cell, depth);
      normals.push(0, 0, 1); colors.push(220, 220, 210);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
    if (gap && x === 8 && y === 8) continue;
    quad(x, y, (x % 2 ? .075 : -.045));
    if (x % 4 === 0) quad(x, y, -.075); // competing wall sheet
  }
  const mesh = { positions: new Float32Array(positions), indices: new Uint32Array(indices),
    normals: new Float32Array(normals), colors: new Uint8Array(colors) };
  const frames = [0, 1, 2].map(frameId => ({ frameId, camera: [stationary ? 0 : frameId * .12, .6, 1],
    columns, rows, filteredDepth: new Float32Array(columns * rows).fill(1),
    measuredMask: new Uint8Array(columns * rows).fill(1),
    freeSpaceMask: new Uint8Array(columns * rows).fill(1),
    depthConfidence: new Uint8Array(columns * rows).fill(255) }));
  for (const frame of frames) for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    if (opening && x >= 10 && x < 16 && y >= 10 && y < 21) frame.filteredDepth[y * columns + x] = 1.6;
    if (foreground && x >= 10 && x < 16 && y >= 10 && y < 21) frame.filteredDepth[y * columns + x] = .94;
  }
  const helpers = {
    project: (frame, x, y, z) => ({ u: x / size, v: y / size, depth: 1 - z }),
    unproject: (frame, i, depth) => [(i % columns + .5) * cell, (Math.floor(i / columns) + .5) * cell, 1 - depth],
  };
  const plane = { kind: "wall", normal: [0, 0, 1], offset: 0, axes: [[1, 0, 0], [0, 1, 0]],
    cellSize: .12, cells: new Map(), supportingFrameIds: [0, 1, 2] };
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) plane.cells.set(`${x},${y}`, new Set([0, 1, 2]));
  return { mesh, plane, frames, helpers };
}

test("noisy overlapping wall sheets become one flat, connected design mesh without changing measured data", () => {
  const { mesh, plane, frames, helpers } = fixture();
  const positions = mesh.positions.slice(), indices = mesh.indices.slice();
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers);
  expect(design.walls).toHaveLength(1);
  const wall = design.walls[0], topology = surfaceTopologyDiagnostics(wall);
  expect(topology.componentCount).toBe(1);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.windingConflicts).toBe(0);
  for (let i = 2; i < wall.positions.length; i += 3) expect(wall.positions[i]).toBe(0);
  expect(design.diagnostics.removedTriangles).toBe(mesh.indices.length / 3);
  expect(mesh.positions).toEqual(positions); expect(mesh.indices).toEqual(indices);
  mesh.designSurfaces = design;
  expect(getScanDesignSurfaces(mesh)).toBe(design);
  expect(getScanDesignSurfaces({ ...mesh, positions: new Float32Array(positions).fill(.3) })).toBeNull();
});

test("white atlas fallback tiles retain the captured vertex color in prepared walls", () => {
  const { mesh } = fixture();
  for (let i=2;i<mesh.positions.length;i+=3) mesh.positions[i]=0;
  mesh.colors.fill(64);
  mesh.uvs=new Float32Array(mesh.positions.length/3*2).fill(.5);
  mesh.texture={width:1,height:1,data:new Uint8Array([255,255,255,255])};
  const design=buildScanDesignSurfaces(mesh,[{kind:"wall",normal:[0,0,1],offset:0}]);
  const rgb=Array.from(design.walls[0].texture.data.slice(0,3));
  expect(rgb).toEqual([137,137,137]);
  expect(mesh.colors.every(v=>v===64)).toBe(true);
  mesh.colors.fill(255);
  const photographed=buildScanDesignSurfaces(mesh,[{kind:"wall",normal:[0,0,1],offset:0}]);
  expect(Array.from(photographed.walls[0].texture.data.slice(0,3))).toEqual([255,255,255]);
});

test("independently observed openings remain holes and contradictory background fragments are removed", () => {
  const { mesh, plane, frames, helpers } = fixture({ opening: true });
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers), wall = design.walls[0];
  expect(wall.openingMask.reduce((sum, value) => sum + value, 0)).toBe(66);
  for (let face = 0; face < wall.indices.length / 3; face++) {
    const corners = [0, 1, 2].map(c => wall.indices[face * 3 + c] * 3);
    const x = corners.reduce((sum, id) => sum + wall.positions[id], 0) / 3;
    const y = corners.reduce((sum, id) => sum + wall.positions[id + 1], 0) / 3;
    expect(x >= .4 && x < .64 && y >= .4 && y < .84).toBe(false);
  }
  expect(design.diagnostics.removedTriangles).toBe(mesh.indices.length / 3);
});

test("foreground occlusion is preserved without cutting a window out of the design wall", () => {
  const { mesh, plane, frames, helpers } = fixture({ foreground: true });
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers);
  expect(design.walls[0].openingMask.some(Boolean)).toBe(false);
  expect(surfaceTopologyDiagnostics(design.walls[0]).componentCount).toBe(1);
  expect(design.diagnostics.removedTriangles).toBeLessThan(mesh.indices.length / 3);
});

test("stationary copies cannot authorize opening removal or foreground protection", () => {
  const { mesh, plane, frames, helpers } = fixture({ opening: true, stationary: true });
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers);
  expect(design.walls[0].openingMask.some(Boolean)).toBe(false);
});

test("a bounded interior meshing gap is estimated from its observed footprint", () => {
  const { mesh, plane, frames, helpers } = fixture({ gap: true });
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers);
  expect(design.walls[0].estimatedArea).toBeGreaterThan(0);
  expect(surfaceTopologyDiagnostics(design.walls[0]).componentCount).toBe(1);
});

function supportedSlopedFloor(offset=0) {
  const length=Math.hypot(1,.05),plane={kind:"floor",normal:[0,1/length,-.05/length],offset:offset/length,
    axes:[[1,0,0],[0,.05/length,1/length]],cellSize:.12,cells:new Map(),supportingFrameIds:[0,1,2]};
  for(let x=0;x<12;x++)for(let y=0;y<9;y++)plane.cells.set(`${x},${y}`,new Set([0,1,2]));
  return plane;
}

test("wall cleanup cannot consume an independently supported sloped floor near the wall",()=>{
  const {mesh,plane,frames,helpers}=fixture(),floor=supportedSlopedFloor(.2);
  const start=mesh.positions.length/3,first=mesh.indices.length/3;
  mesh.positions=new Float32Array([...mesh.positions,.3,.205,.1, .9,.205,.1, .9,.215,.3, .3,.215,.3]);
  mesh.normals=new Float32Array([...mesh.normals,0,1,0, 0,1,0, 0,1,0, 0,1,0]);
  mesh.colors=new Uint8Array([...mesh.colors,...new Array(12).fill(230)]);
  mesh.indices=new Uint32Array([...mesh.indices,start,start+1,start+2,start,start+2,start+3]);
  const textureFrames=[{...frames[0],colorImage:new Uint8Array(16).fill(255),colorWidth:2,colorHeight:2,
    transformMatrix:new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, .6,.6,1,1])}];
  const design=buildScanDesignSurfaces(mesh,[plane,floor],frames,{...helpers,textureFrames,sampleColor:()=>[235,230,220]});
  expect(Array.from(design.removedSourceFaces).slice(first)).toEqual([0,0]);
});

test("mesh-only fallback does not flatten a distinct raised object or invent a room rectangle", () => {
  const { mesh, plane } = fixture();
  expect(buildScanDesignSurfaces(mesh, [plane])).toBeNull(); // layers too far from the wall
  const flat = { ...mesh, positions: mesh.positions.slice() };
  for (let i = 2; i < flat.positions.length; i += 3) flat.positions[i] = .01;
  const design = buildScanDesignSurfaces(flat, [plane]);
  expect(design.walls[0].source).toBe("mesh-footprint");
  expect(design.walls[0].area).toBeCloseTo(1.44, 2);
});

test("no usable wall plane leaves the captured scan available", () => {
  const { mesh, frames, helpers } = fixture();
  expect(buildScanDesignSurfaces(mesh, [{ kind: "floor", normal: [0, 1, 0], offset: 0 }], frames, helpers)).toBeNull();
  expect(buildScanDesignSurfaces(mesh, [{ kind: "wall", normal: [NaN, 0, 1], offset: 0 }], frames, helpers)).toBeNull();
});

test.each([1,-1])("an upper vertical distortion cannot extend a prepared wall above measured wall ownership (height axis %s)",heightDirection=>{
  const {mesh,plane,frames,helpers}=fixture();
  if (heightDirection < 0) {
    plane.axes[1] = [0,-1,0];
    plane.cells = new Map([...plane.cells].map(([k,ids]) => {
      const [x,y] = k.split(",").map(Number);
      return [`${x},${-y-1}`,ids];
    }));
  }
  const first=mesh.indices.length/3, n=mesh.positions.length/3;
  mesh.positions=new Float32Array([...mesh.positions,0,1.4,-.1, 1,1.4,-.1, 1,1.9,-.1, 0,1.9,-.1]);
  mesh.colors=new Uint8Array([...mesh.colors,...new Array(12).fill(200)]);
  mesh.normals=new Float32Array([...mesh.normals,0,0,1, 0,0,1, 0,0,1, 0,0,1]);
  mesh.indices=new Uint32Array([...mesh.indices,n,n+1,n+2, n,n+2,n+3]);
  const before=mesh.positions.slice();
  const design=buildScanDesignSurfaces(mesh,[plane],frames,helpers);
  const wallTop = Math.max(...Array.from(design.walls[0].positions).filter((_,i)=>i%3===1));
  expect(wallTop).toBeLessThanOrEqual(1.24+.001);
  expect(wallTop).toBeGreaterThanOrEqual(1.2-.001);
  expect(Array.from(design.removedSourceFaces).slice(first)).toEqual([0,0]);
  expect(mesh.positions).toEqual(before);
});

test("mixed wall/object triangles are clipped with their original photograph coordinates", () => {
  const { plane, frames, helpers } = fixture({ foreground: true });
  const mesh = { positions: new Float32Array([0, 0, .06, 1.2, 0, .06, 1.2, 1.2, .06, 0, 1.2, .06]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    colors: new Uint8Array(12).fill(230), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]) };
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers), fragments = design.fragments;
  expect(fragments.indices.length).toBeGreaterThan(0);
  expect(Array.from(design.removedSourceFaces)).toEqual([1, 1]);
  for (let i = 0; i < fragments.positions.length / 3; i++) {
    const x = fragments.positions[i * 3], y = fragments.positions[i * 3 + 1];
    expect(x).toBeGreaterThanOrEqual(.4 - 1e-6); expect(x).toBeLessThanOrEqual(.64 + 1e-6);
    expect(y).toBeGreaterThanOrEqual(.4 - 1e-6); expect(y).toBeLessThanOrEqual(.84 + 1e-6);
    expect(fragments.uvs[i * 2]).toBeCloseTo(x / 1.2, 6);
    expect(fragments.uvs[i * 2 + 1]).toBeCloseTo(y / 1.2, 6);
    expect(fragments.positions[i * 3 + 2]).toBeCloseTo(.06);
  }
});

test("separate camera snapshots supply fine photo detail without becoming depth observers", () => {
  const { mesh, plane, frames, helpers } = fixture({ opening: true, stationary: true });
  const textureFrames = [0, 1].map(i => ({ ...frames[0], frameId: 100 + i, textureOnly: true,
    camera: [i * .4, .6, 1], colorImage: new Uint8Array(16).fill(255), colorWidth: 2, colorHeight: 2,
    transformMatrix: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, i*.4,.6,1,1]) }));
  const design = buildScanDesignSurfaces(mesh, [plane], frames, { ...helpers, textureFrames,
    sampleColor: () => [180, 60, 40] });
  const wall = design.walls[0], offset = (Math.floor(wall.texture.height / 4) * wall.texture.width + Math.floor(wall.texture.width / 4)) * 4;
  expect(Array.from(wall.texture.data.subarray(offset, offset + 4))).toEqual([180, 60, 40, 255]);
  expect(wall.openingMask.some(Boolean)).toBe(false);
});

test("a clipped wall photo yields to an observed properly exposed alternative", () => {
  const {mesh,plane,frames,helpers}=fixture();
  const textureFrames=[0,1].map(i=>({...frames[i],frameId:100+i,textureOnly:true,
    colorImage:new Uint8Array(16).fill(255),colorWidth:2,colorHeight:2,
    transformMatrix:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,.6,.6,1,1])}));
  const sampleColor=frame=>frame.frameId===100 ? [255,255,255] : [185,180,170];
  const design=buildScanDesignSurfaces(mesh,[plane],frames,{...helpers,textureFrames,sampleColor});
  expect(Array.from(design.walls[0].texture.data.slice(0,3))).toEqual([185,180,170]);
  const only=buildScanDesignSurfaces(mesh,[plane],frames,{...helpers,textureFrames:[textureFrames[0]],sampleColor});
  expect(Array.from(only.walls[0].texture.data.slice(0,3))).toEqual([255,255,255]);
});

test("pale highlights in a flush picture are protected on the continuous wall without a broad halo", () => {
  const { mesh, plane, frames, helpers } = fixture();
  const textureFrames = [{ ...frames[0], colorImage: new Uint8Array(16).fill(255), colorWidth: 2, colorHeight: 2,
    transformMatrix: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, .6,.6,1,1]) }];
  const design = buildScanDesignSurfaces(mesh, [plane], frames, { ...helpers, textureFrames,
    sampleColor: (frame, uv) => uv.u > .3 && uv.u < .7 && uv.v > .3 && uv.v < .7 &&
      !(uv.u > .45 && uv.u < .55 && uv.v > .45 && uv.v < .55) ? [20, 35, 80] : [235, 230, 220] });
  const wall = design.walls[0], at = (u, v) => Math.floor(v * wall.texture.height) * wall.texture.width + Math.floor(u * wall.texture.width);
  expect(wall.detailMask[at(.5, .5)]).toBe(255);
  expect(wall.detailMask[at(.2, .5)]).toBe(0);
  expect(surfaceTopologyDiagnostics(wall).componentCount).toBe(1);
});

test("photographed plain-wall depth bias does not leave white foreground blocks over paint", () => {
  const { mesh, plane, frames, helpers } = fixture({ foreground: true });
  const textureFrames = [{ ...frames[0], colorImage: new Uint8Array(16).fill(255), colorWidth: 2, colorHeight: 2,
    transformMatrix: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, .6,.6,1,1]) }];
  const design = buildScanDesignSurfaces(mesh, [plane], frames, { ...helpers, textureFrames,
    sampleColor: () => [235, 230, 220] });
  expect(design.diagnostics.removedTriangles).toBe(mesh.indices.length / 3);
  expect(design.fragments.indices).toHaveLength(0);
  expect(design.walls[0].detailMask.some(Boolean)).toBe(false);
});

test("scattered photographed wall depth bumps are flattened instead of being preserved as objects", () => {
  const { mesh, plane, frames, helpers } = fixture();
  for (let i = 2; i < mesh.positions.length; i += 3) mesh.positions[i] = .12;
  const before = mesh.positions.slice();
  for (const frame of frames) for (let y = 8; y < 20; y++) for (let x = 8; x < 20; x++)
    if ((x + y) % 2 === 0) frame.filteredDepth[y * frame.columns + x] = .87;
  const textureFrames = [{ ...frames[0], colorImage: new Uint8Array(16).fill(255), colorWidth: 2, colorHeight: 2,
    transformMatrix: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, .6,.6,1,1]) }];
  const design = buildScanDesignSurfaces(mesh, [plane], frames, { ...helpers, textureFrames,
    sampleColor: () => [235, 230, 220] });
  expect(design.removedSourceFaces.every(Boolean)).toBe(true);
  expect(design.fragments.indices).toHaveLength(0);
  expect(design.walls[0].detailMask.some(Boolean)).toBe(false);
  expect(mesh.positions).toEqual(before);
});

test("a shadow on a noisy wall is flattened with the wall and remains in its paint lighting", () => {
  const { mesh, plane, frames, helpers } = fixture({ foreground: true });
  const before = mesh.positions.slice();
  const textureFrames = [{ ...frames[0], colorImage: new Uint8Array(16).fill(255), colorWidth: 2, colorHeight: 2,
    transformMatrix: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, .6,.6,1,1]) }];
  const design = buildScanDesignSurfaces(mesh, [plane], frames, { ...helpers, textureFrames,
    sampleColor: (frame, uv) => uv.u > .3 && uv.u < .7 && uv.v > .3 && uv.v < .7
      ? [110, 108, 103] : [235, 230, 220] });
  const wall = design.walls[0], at = (u, v) => Math.floor(v * wall.texture.height) * wall.texture.width + Math.floor(u * wall.texture.width);
  expect(wall.detailMask[at(.5, .5)]).toBe(0);
  expect(design.fragments.indices).toHaveLength(0);
  expect(design.removedSourceFaces.every(Boolean)).toBe(true);
  expect(surfaceTopologyDiagnostics(wall).componentCount).toBe(1);
  const light = estimateWallLighting(wall);
  expect(light.data[at(.5, .5) * 4]).toBeLessThan(light.data[at(.2, .5) * 4] * .3);
  expect(wall.texture.data[at(.5, .5) * 4]).toBe(110);
  expect(mesh.positions).toEqual(before);
});

test("monochrome photographic texture stays protected even when its mean resembles wall shadow", () => {
  const { mesh, plane, frames, helpers } = fixture();
  const textureFrames = [{ ...frames[0], colorImage: new Uint8Array(16).fill(255), colorWidth: 2, colorHeight: 2,
    transformMatrix: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, .6,.6,1,1]) }];
  const design = buildScanDesignSurfaces(mesh, [plane], frames, { ...helpers, textureFrames,
    sampleColor: (frame, uv) => {
      if (!(uv.u > .3 && uv.u < .7 && uv.v > .3 && uv.v < .7)) return [235, 230, 220];
      const value = Math.round(130 + 100 * Math.cos(uv.u * Math.PI * 60));
      return [value, value, value];
    } });
  const wall = design.walls[0];
  expect(wall.detailMask.some(Boolean)).toBe(true);
  expect(surfaceTopologyDiagnostics(wall).componentCount).toBe(1);
});

test("substantial foreground relief remains captured even when its photograph resembles white paint", () => {
  const { plane, frames, helpers } = fixture({ foreground: true });
  for (const frame of frames) for (let i = 0; i < frame.filteredDepth.length; i++)
    if (frame.filteredDepth[i] < 1) frame.filteredDepth[i] = .88;
  const mesh = { positions: new Float32Array([0,0,.12, 1.2,0,.12, 1.2,1.2,.12, 0,1.2,.12]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]), colors: new Uint8Array(12).fill(230),
    uvs: new Float32Array([0,0, 1,0, 1,1, 0,1]), indices: new Uint32Array([0,1,2, 0,2,3]) };
  const textureFrames = [{ ...frames[0], colorImage: new Uint8Array(16).fill(255), colorWidth: 2, colorHeight: 2,
    transformMatrix: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, .6,.6,1,1]) }];
  const design = buildScanDesignSurfaces(mesh, [plane], frames, { ...helpers, textureFrames,
    sampleColor: () => [235, 230, 220] });
  expect(design.fragments.indices.length).toBeGreaterThan(0);
  expect(design.walls[0].estimatedArea).toBeGreaterThan(0);
  expect(design.walls[0].openingMask.some(Boolean)).toBe(false);
});

test("only nearby independently supported junctions adjust wall boundaries", () => {
  const { mesh, plane, frames, helpers } = fixture();
  const floor = { kind: "floor", normal: [0,1,0], offset: .011, axes: [[1,0,0], [0,0,1]],
    cellSize: .12, cells: new Map() };
  for (let x = 0; x < 10; x++) floor.cells.set(`${x},0`, new Set([0,1,2]));
  const ceiling = { ...floor, kind: "ceiling", offset: .9, cells: new Map() };
  const design = buildScanDesignSurfaces(mesh, [plane, floor, ceiling], frames, helpers), wall = design.walls[0];
  expect(wall.junctionVertexCount).toBeGreaterThan(0);
  expect(wall.positions[1]).toBeCloseTo(.011);
  expect(Math.max(...Array.from(wall.positions).filter((_, i) => i % 3 === 1))).toBeCloseTo(1.2);
  expect(surfaceTopologyDiagnostics(wall).nonManifoldEdges).toBe(0);
  expect(surfaceTopologyDiagnostics(wall).windingConflicts).toBe(0);
});

test("a genuinely angled wall keeps its fitted angle instead of snapping to the room axes", () => {
  const { mesh, plane } = fixture();
  const angle = Math.PI / 6, c = Math.cos(angle), s = Math.sin(angle);
  const rotated = { ...mesh, positions: mesh.positions.slice() };
  for (let i = 0; i < rotated.positions.length; i += 3) {
    const x = mesh.positions[i];
    rotated.positions[i] = x*c + .21*s;
    rotated.positions[i+2] = -x*s + .21*c;
  }
  const design = buildScanDesignSurfaces(rotated, [{ ...plane, normal: [s,0,c], offset: .2 }]);
  const wall = design.walls[0];
  for (let i = 0; i < wall.positions.length; i += 3)
    expect(s*wall.positions[i]+c*wall.positions[i+2]).toBeCloseTo(.2, 6);
  expect(wall.normal).toEqual([s,0,c]);
});

function wallFloorJunction({ disconnected = false, opening = false } = {}) {
  const { plane, frames, helpers } = fixture();
  if (opening) for (const frame of frames) frame.filteredDepth.fill(1.6, 0, frame.columns * 4);
  const x = disconnected ? .005 : 0;
  const mesh = {
    positions: new Float32Array([0,0,.12, 1.2,0,.12, 1.2,1.2,.12, 0,1.2,.12,
      x,0,.12, 1.2+x,0,.12, 1.2+x,0,.8, x,0,.8]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1,
      0,1,0, 0,1,0, 0,1,0, 0,1,0]),
    colors: new Uint8Array(24).fill(230),
    uvs: new Float32Array([0,0, 1,0, 1,1, 0,1, 0,0, 1,0, 1,1, 0,1]),
    indices: new Uint32Array([0,1,2, 0,2,3, 4,6,5, 4,7,6]),
  };
  return { mesh, plane, frames, helpers };
}

test("flattening a connected wall keeps its captured floor junction closed in side view", () => {
  const { mesh, plane, frames, helpers } = wallFloorJunction();
  const positions = mesh.positions.slice(), indices = mesh.indices.slice();
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers);
  expect(Array.from(design.removedSourceFaces)).toEqual([1,1,1,1]);
  expect(design.diagnostics.boundaryAdjustedSourceTriangles).toBe(2);
  expect(Array.from(new Set(design.fragments.sourceFaces))).toEqual([2,3]);
  expect(design.fragments.estimatedTriangleMask.every(x => x === 1)).toBe(true);
  expect(Math.min(...Array.from(design.fragments.positions).filter((_, i) => i % 3 === 2))).toBe(0);
  expect(Math.max(...Array.from(design.fragments.positions).filter((_, i) => i % 3 === 2))).toBeCloseTo(.8);
  for (let i = 0; i < design.fragments.positions.length / 3; i++) {
    expect(design.fragments.uvs[i*2]).toBeCloseTo(design.fragments.positions[i*3] / 1.2, 6);
    if (design.fragments.uvs[i*2+1] === 0) expect(design.fragments.positions[i*3+2]).toBe(0);
    if (design.fragments.uvs[i*2+1] === 1) expect(design.fragments.positions[i*3+2]).toBeCloseTo(.8);
  }
  for (let i = 1; i < design.fragments.positions.length; i += 3) expect(design.fragments.positions[i]).toBe(0);
  expect(mesh.positions).toEqual(positions); expect(mesh.indices).toEqual(indices);
  expect(Array.from(design.walls[0].positions).filter((_, i) => i % 3 === 2).every(z => z === 0)).toBe(true);
});

test("joining a supported sloped floor to the wall keeps all of its deformed vertices on that floor",()=>{
  const {mesh,plane,frames,helpers}=wallFloorJunction(),floor=supportedSlopedFloor();
  for(let i=0;i<mesh.positions.length;i+=3) if(i>=12 || mesh.positions[i+1]===0)
    mesh.positions[i+1]=.05*mesh.positions[i+2];
  const before=mesh.positions.slice(),design=buildScanDesignSurfaces(mesh,[plane,floor],frames,helpers);
  const fragments=design.fragments;
  expect(fragments.indices.length).toBeGreaterThan(0);
  for(let f=0;f<fragments.indices.length;f+=3) if(fragments.sourceFaces[f/3]>=2)
    for(let c=0;c<3;c++) {
      const i=fragments.indices[f+c]*3;
      expect(fragments.positions[i+1]).toBeCloseTo(.05*fragments.positions[i+2],6);
    }
  expect(mesh.positions).toEqual(before);
});

test("boundary adjustment does not reach across a disconnected nearby surface", () => {
  const { mesh, plane, frames, helpers } = wallFloorJunction({ disconnected: true });
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers);
  expect(design.diagnostics.boundaryAdjustedSourceTriangles).toBe(0);
  expect(Array.from(design.removedSourceFaces)).toEqual([1,1,0,0]);
});

test("adjusted captured edges meet the actual wall boundary after a supported junction snap", () => {
  const { mesh, plane, frames, helpers } = wallFloorJunction();
  const floor = { kind: "floor", normal: [0,1,0], offset: .011, axes: [[1,0,0], [0,0,1]],
    cellSize: .12, cells: new Map() };
  for (let x = 0; x < 10; x++) floor.cells.set(`${x},0`, new Set([0,1,2]));
  const design = buildScanDesignSurfaces(mesh, [plane, floor], frames, helpers);
  const joins = design.fragments.positions;
  expect(design.walls[0].junctionVertexCount).toBeGreaterThan(0);
  for (let i = 0; i < joins.length; i += 3) if (joins[i+2] === 0) expect(joins[i+1]).toBeCloseTo(.011);
});

test("a depth-supported opening at a captured junction is not capped by boundary repair", () => {
  const { mesh, plane, frames, helpers } = wallFloorJunction({ opening: true });
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers);
  expect(design.diagnostics.boundaryAdjustedSourceTriangles).toBe(0);
  expect(Math.min(...Array.from(design.walls[0].positions).filter((_, i) => i % 3 === 1))).toBeCloseTo(.16);
});

test("a retained foreground object at the junction is not stretched onto the wall", () => {
  const { mesh, plane, frames, helpers } = wallFloorJunction();
  for (const frame of frames) frame.filteredDepth.fill(.88, 0, frame.columns * 4);
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers);
  expect(design.fragments.indices.length).toBeGreaterThan(0);
  expect(design.diagnostics.boundaryAdjustedSourceTriangles).toBe(0);
  expect(design.fragments.estimatedTriangleMask.some(Boolean)).toBe(false);
});

test("depth-supported duplicate wall sheets behind the wall are replaced without flattening foreground objects", () => {
  const { mesh, plane, frames, helpers } = fixture();
  const duplicate = { ...mesh, positions: mesh.positions.slice() };
  for (let i = 2; i < duplicate.positions.length; i += 3) duplicate.positions[i] = -.28;
  const design = buildScanDesignSurfaces(duplicate, [plane], frames, helpers);
  expect(design.removedSourceFaces.every(Boolean)).toBe(true);
  expect(design.fragments.indices).toHaveLength(0);
  expect(design.walls[0].positions.filter((_, i) => i % 3 === 2).every(z => z === 0)).toBe(true);
  const foreground = { ...mesh, positions: mesh.positions.slice() };
  for (let i = 2; i < foreground.positions.length; i += 3) foreground.positions[i] = .28;
  expect(buildScanDesignSurfaces(foreground, [plane], frames, helpers).removedSourceFaces.some(Boolean)).toBe(false);
  expect(buildScanDesignSurfaces(duplicate, [plane])).toBeNull();
});

test.each([true,false])("a curled wall crossing the normal cleanup band needs photographed native wall normals (%s)",normalSupport=>{
  const {mesh,plane,frames,helpers}=fixture();
  const start=mesh.positions.length/3, first=mesh.indices.length/3;
  mesh.positions=new Float32Array([...mesh.positions,.4,.4,.16, .8,.4,.29, .8,.8,.29, .4,.8,.16]);
  mesh.normals=new Float32Array([...mesh.normals,0,0,1, 0,0,1, 0,0,1, 0,0,1]);
  mesh.colors=new Uint8Array([...mesh.colors,...new Array(12).fill(230)]);
  mesh.indices=new Uint32Array([...mesh.indices,start,start+1,start+2,start,start+2,start+3]);
  if(!normalSupport) for(const f of frames) {
    f.originalPositions=new Float32Array(f.columns*f.rows*3);
    for(let y=0;y<f.rows;y++)for(let x=0;x<f.columns;x++)
      f.originalPositions.set([(x+.5)*.04,0,(y+.5)*.04],(y*f.columns+x)*3);
  }
  const textureFrames=[{...frames[0],colorImage:new Uint8Array(16).fill(255),colorWidth:2,colorHeight:2,
    transformMatrix:new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, .6,.6,1,1])}];
  const before=mesh.positions.slice(),design=buildScanDesignSurfaces(mesh,[plane],frames,
    {...helpers,textureFrames,sampleColor:()=>[235,230,220]});
  expect(Array.from(design.removedSourceFaces).slice(first)).toEqual(normalSupport?[1,1]:[0,0]);
  if(normalSupport) expect(design.fragments.sourceFaces.some(f=>f>=first)).toBe(false);
  expect(mesh.positions).toEqual(before);
});

test.each([false, true])("background clipping preserves photo UVs and does not cap an opening (opening: %s)", opening => {
  const { mesh, plane, frames, helpers } = wallFloorJunction({ opening });
  const y = opening ? .02 : .3, height = opening ? .08 : .6;
  mesh.positions = new Float32Array([...mesh.positions, .6,y,.12, .6,y+height,.12, .8,y+height/2,-.55]);
  mesh.normals = new Float32Array([...mesh.normals, 0,0,1, 0,0,1, 0,0,1]);
  mesh.indices = new Uint32Array([...mesh.indices, 8,9,10]);
  mesh.colors = new Uint8Array([...mesh.colors, 120,130,140, 120,130,140, 120,130,140]);
  mesh.uvs = new Float32Array([...mesh.uvs, .6/1.2,y/1.2, .6/1.2,(y+height)/1.2, .8/1.2,(y+height/2)/1.2]);
  const positions = mesh.positions.slice(), uvs = mesh.uvs.slice();
  const design = buildScanDesignSurfaces(mesh, [plane], frames, helpers);
  expect(design.removedSourceFaces[4]).toBe(opening ? 0 : 1);
  if (!opening) {
    expect(design.diagnostics.clippedBackgroundTriangles).toBeGreaterThan(0);
    const f = design.fragments;
    for (let t = 0; t < f.sourceFaces.length; t++) if (f.sourceFaces[t] === 4) for (let c = 0; c < 3; c++) {
      const i = f.indices[t*3+c];
      expect(f.positions[i*3+2]).toBeGreaterThanOrEqual(-1e-6);
      expect(f.uvs[i*2]).toBeCloseTo(f.positions[i*3]/1.2, 6);
      expect(f.uvs[i*2+1]).toBeCloseTo(f.positions[i*3+1]/1.2, 6);
    }
  }
  expect(mesh.positions).toEqual(positions); expect(mesh.uvs).toEqual(uvs);
});

test("a captured vertical wall joins the prepared wall with shared geometry and its original photo", () => {
  const { mesh, plane, frames, helpers } = fixture();
  const positions = Array.from(mesh.positions), indices = Array.from(mesh.indices), colors = Array.from(mesh.colors), normals = Array.from(mesh.normals);
  const uvs = [];
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i]/1.2, positions[i+1]/1.2);
  const firstWingFace = indices.length/3;
  for (let y = 0; y < 30; y++) for (let z = 0; z < 25; z++) {
    const start = positions.length/3;
    for (const [dy,dz] of [[0,0],[0,1],[1,1],[1,0]]) {
      positions.push(0,(y+dy)*.04,-.045+(z+dz)*.04); normals.push(1,0,0);
      colors.push(170,180,190); uvs.push((z+dz)/25,(y+dy)/30);
    }
    indices.push(start,start+2,start+1,start,start+3,start+2);
  }
  Object.assign(mesh, { positions: new Float32Array(positions), indices: new Uint32Array(indices),
    normals: new Float32Array(normals), colors: new Uint8Array(colors), uvs: new Float32Array(uvs) });
  const originalPositions = mesh.positions.slice(), originalUVs = mesh.uvs.slice();
  const design = buildScanDesignSurfaces(mesh,[plane],frames,helpers), f = design.fragments;
  expect(f.sourceFaces.every(face => face >= firstWingFace)).toBe(true);
  expect(design.diagnostics.boundarySeamVertices).toBeGreaterThan(0);
  let hasInteriorCorrection = false;
  for (let i = 0; i < f.positions.length/3; i++) {
    expect(f.positions[i*3]).toBe(0);
    if (f.uvs[i*2] === 0) expect(f.positions[i*3+2]).toBeCloseTo(0,6);
    else if (f.uvs[i*2] < .3 && f.positions[i*3+2] > -.045 + f.uvs[i*2] + .0001) hasInteriorCorrection = true;
    expect(f.uvs[i*2+1]).toBeCloseTo(f.positions[i*3+1]/1.2,6);
  }
  expect(hasInteriorCorrection).toBe(true);
  const visiblePositions = [], visibleIndices = [];
  function include(source, mask) {
    for (let face = 0; face < source.indices.length/3; face++) if (!mask?.[face]) for (let c = 0; c < 3; c++) {
      const id = source.indices[face*3+c]*3;
      visibleIndices.push(visiblePositions.length/3); visiblePositions.push(...source.positions.subarray(id,id+3));
    }
  }
  include(mesh,design.removedSourceFaces); include(f); include(design.walls[0]);
  const topology = surfaceTopologyDiagnostics({ positions: new Float32Array(visiblePositions), indices: new Uint32Array(visibleIndices) });
  expect(topology.componentCount).toBe(1);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.windingConflicts).toBe(0);
  expect(mesh.positions).toEqual(originalPositions); expect(mesh.uvs).toEqual(originalUVs);
});

function rearWallCapture({ stationary = false, residual = -.035, outlier = false } = {}) {
  const value = wallFloorJunction();
  value.frames = [0,1,2,3].map(frameId => {
    const frame = { ...value.frames[0], frameId, camera: [stationary ? 0 : frameId*.12,.6,1] };
    const depth = outlier && frameId === 3 ? .11 : residual;
    frame.filteredDepth = new Float32Array(frame.columns*frame.rows).fill(1-depth);
    frame.positions = new Float32Array(frame.columns*frame.rows*3);
    for (let i = 0; i < frame.columns*frame.rows; i++)
      frame.positions.set([(i%frame.columns+.5)*.04,(Math.floor(i/frame.columns)+.5)*.04,depth],i*3);
    return frame;
  });
  return value;
}

test("a repeatedly captured rear wall seats the prepared wall back while retaining its photographed floor join", () => {
  const { mesh, plane, frames, helpers } = rearWallCapture({ outlier: true });
  const positions = mesh.positions.slice();
  const design = buildScanDesignSurfaces(mesh,[plane],frames,helpers), wall = design.walls[0];
  expect(wall.offset).toBeCloseTo(-.035,6);
  expect(wall.setbackMeters).toBeCloseTo(.035,6);
  for (let i = 2; i < wall.positions.length; i += 3) expect(wall.positions[i]).toBeCloseTo(-.035,6);
  const joins = design.fragments;
  expect(design.diagnostics.boundarySeamVertices).toBeGreaterThan(0);
  for (let i = 0; i < joins.positions.length/3; i++)
    if (joins.uvs[i*2+1] === 0) expect(joins.positions[i*3+2]).toBeCloseTo(wall.offset,6);
  expect(mesh.positions).toEqual(positions);
});

test("repeated stationary copies cannot move the prepared wall farther back", () => {
  const { mesh, plane, frames, helpers } = rearWallCapture({ stationary: true });
  const wall = buildScanDesignSurfaces(mesh,[plane],frames,helpers).walls[0];
  expect(wall.setbackMeters).toBe(0);
  expect(wall.offset).toBe(0);
});

test("rear wall placement is bounded even when translated depths consistently disagree", () => {
  const { mesh, plane, frames, helpers } = rearWallCapture({ residual: -.11 });
  const wall = buildScanDesignSurfaces(mesh,[plane],frames,helpers).walls[0];
  expect(wall.offset).toBeCloseTo(-.06,6);
});
