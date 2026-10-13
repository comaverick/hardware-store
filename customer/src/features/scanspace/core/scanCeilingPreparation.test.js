import { buildScanDesignSurfaces, validScanDesignSurfaces } from "./scanDesignSurfaces";
import { prepareScanCeiling } from "./scanCeilingPreparation";
import { alignFinishedScan } from "./scanCoordinates";
import { parsePartialScan, serializePartialScan } from "./partialScanFile";
import { surfaceTopologyDiagnostics } from "./surfaceTopology";
function fixture({
  stationary = false,
  fixtureDetail = false,
  alternateLevel = false,
  opening = false
} = {}) {
  const positions = [],
    normals = [],
    colors = [],
    indices = [],
    size = 1.2,
    cell = .04;
  for (let z = 0; z < 30; z++) for (let x = 0; x < 30; x++) {
    if (opening && x >= 12 && x < 18 && z >= 12 && z < 18) continue;
    const i = positions.length / 3;
    for (const [dx, dz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      positions.push((x + dx) * cell, 2.6 + .08 * Math.sin((x + dx) * .3), (z + dz) * cell);
      normals.push(0, -1, 0);
      colors.push(160, 160, 150);
    }
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  const frames = [0, 1, 2].map(frameId => {
    const camera = [stationary ? 0 : frameId * .12, 1, .6];
    const transformMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...camera, 1]);
    return {
      frameId,
      camera,
      transformMatrix,
      columns: 30,
      rows: 30,
      colorWidth: 8,
      colorHeight: 8,
      colorImage: new Uint8Array(8 * 8 * 4).fill(180),
      measuredMask: new Uint8Array(900).fill(1),
      filteredDepth: new Float32Array(900).fill(alternateLevel ? 1.85 : 1.6 + frameId * .025)
    };
  });
  const mesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    floorY: 0,
    bounds: {
      min: {
        x: 0,
        y: 2.5,
        z: 0
      },
      max: {
        x: size,
        y: 2.7,
        z: size
      }
    }
  };
  const helpers = {
    project: (f, x, y, z) => ({
      u: x / size,
      v: z / size,
      depth: y - 1
    }),
    unproject: (f, i, d) => [(i % 30 + .5) * cell, 1 + d, (Math.floor(i / 30) + .5) * cell],
    sampleColor: (f, uv) => fixtureDetail && uv.u > .4 && uv.u < .6 && uv.v > .4 && uv.v < .6 ? [15, 15, 15] : [180, 178, 170]
  };
  return {
    mesh,
    frames,
    helpers
  };
}

test('overlapping ceiling photos balance exposure without averaging away photographed detail',()=>{
  const {mesh,frames,helpers}=fixture();
  helpers.textureFrames=frames.slice(0,2);
  helpers.projectColor=(f,x,y,z)=>({u:(f.frameId===0 && x<.5 || f.frameId===1 && x>.7)?1.5:x/1.2,v:z/1.2,depth:y-1});
  helpers.sampleColor=(f,uv)=>Array(3).fill((f.frameId===0?160:200)+(uv.v>.5?4:0));
  const result=prepareScanCeiling(mesh,frames,helpers,new Uint8Array(mesh.indices.length/3));
  expect(result.diagnostics.exposureBalancedFrames).toBe(2);
  const t=result.surface.texture;
  const sample=(u,v)=>t.data[(Math.floor(v*t.height)*t.width+Math.floor(u*t.width))*4];
  expect(Math.abs(sample(.25,.25)-sample(.8,.25))).toBeLessThan(3);
  expect(sample(.25,.75)).toBeGreaterThan(sample(.25,.25));
});
test("bent photographed ceiling has a connected flat preview while captured geometry stays intact", () => {
  const {
      mesh,
      frames,
      helpers
    } = fixture(),
    original = mesh.positions.slice(),
    indices = mesh.indices.slice();
  const design = buildScanDesignSurfaces(mesh, [], frames, helpers);
  expect(design.walls).toHaveLength(0);
  expect(design.ceilings).toHaveLength(1);
  const ceiling = design.ceilings[0],
    topology = surfaceTopologyDiagnostics(ceiling);
  expect(topology.componentCount).toBe(1);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.windingConflicts).toBe(0);
  const ys = Array.from(ceiling.positions).filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(0);
  expect(ceiling.estimatedTriangleMask.every(Boolean)).toBe(true);
  expect(ceiling.estimatedArea).toBe(ceiling.area);
  expect(design.removedSourceFaces.some(Boolean)).toBe(true);
  expect(mesh.positions).toEqual(original);
  expect(mesh.indices).toEqual(indices);
});
test("photographed fixtures and observed ceiling openings keep their captured footprint", () => {
  const {
    mesh,
    frames,
    helpers
  } = fixture({
    fixtureDetail: true,
    opening: true
  });
  const removed = new Uint8Array(mesh.indices.length / 3),
    result = prepareScanCeiling(mesh, frames, helpers, removed);
  expect(result).not.toBeNull();
  const ceiling = result.surface;
  for (let f = 0; f < ceiling.indices.length / 3; f++) {
    const points = [0, 1, 2].map(c => ceiling.indices[f * 3 + c] * 3);
    const x = points.reduce((s, i) => s + ceiling.positions[i] / 3, 0),
      z = points.reduce((s, i) => s + ceiling.positions[i + 2] / 3, 0);
    expect(x > .48 && x < .72 && z > .48 && z < .72).toBe(false);
  }
  expect(removed.some(v => !v)).toBe(true);
});
test.each(["stationary", "alternateLevel"])("%s observations do not authorize a ceiling replacement", kind => {
  const {
      mesh,
      frames,
      helpers
    } = fixture({
      [kind]: true
    }),
    removed = new Uint8Array(mesh.indices.length / 3);
  expect(prepareScanCeiling(mesh, frames, helpers, removed)).toBeNull();
  expect(removed.some(Boolean)).toBe(false);
});
test("missing photographs leave the measured ceiling available", () => {
  const {
    mesh,
    frames,
    helpers
  } = fixture();
  frames.forEach(f => {
    f.colorImage = null;
  });
  expect(prepareScanCeiling(mesh, frames, helpers, new Uint8Array(mesh.indices.length / 3))).toBeNull();
});
test("prepared ceiling and its estimate survive floor alignment and portable export", () => {
  const {
    mesh,
    frames,
    helpers
  } = fixture();
  mesh.designSurfaces = buildScanDesignSurfaces(mesh, [], frames, helpers);
  const finished = alignFinishedScan(mesh, {}, -.27).mesh;
  expect(validScanDesignSurfaces(finished.designSurfaces, finished)).toBe(true);
  const restored = parsePartialScan(serializePartialScan({
    mesh: finished
  })).mesh;
  expect(restored.designSurfaces.ceilings[0].positions).toEqual(finished.designSurfaces.ceilings[0].positions);
  expect(restored.designSurfaces.ceilings[0].texture).toEqual(finished.designSurfaces.ceilings[0].texture);
  expect(restored.designSurfaces.ceilings[0].estimatedTriangleMask.every(Boolean)).toBe(true);
});
function addFin(mesh, x = .3, z = .3) {
  const id = mesh.positions.length / 3;
  mesh.positions = new Float32Array([...mesh.positions, x, 2.55, z, x + .02, 2.85, z, x, 2.55, z + .02]);
  mesh.normals = new Float32Array([...mesh.normals, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  mesh.colors = new Uint8Array([...mesh.colors, ...new Uint8Array(9).fill(160)]);
  mesh.indices = new Uint32Array([...mesh.indices, id, id + 1, id + 2]);
  mesh.uvs = Float32Array.from({
    length: mesh.positions.length / 3 * 2
  }, (_, i) => mesh.positions[Math.floor(i / 2) * 3 + (i % 2 ? 2 : 0)] / 1.2);
  return mesh.indices.length / 3 - 1;
}
test("the local ceiling cutaway interpolates photographed boundaries without clipping stable higher levels", () => {
  const {
      mesh,
      frames,
      helpers
    } = fixture(),
    fin = addFin(mesh),
    original = mesh.positions.slice();
  const removed = new Uint8Array(mesh.indices.length / 3),
    result = prepareScanCeiling(mesh, frames, helpers, removed);
  const clipped = result.fragments.filter(fragment => fragment.face === fin);
  expect(removed[fin]).toBe(1);
  expect(clipped.length).toBeGreaterThan(0);
  for (const fragment of clipped) for (const p of fragment.points) {
    expect(p.p[1]).toBeLessThanOrEqual(result.diagnostics.height + .025 + 1e-7);
    expect(p.uv[0]).toBeCloseTo(p.p[0] / 1.2, 6);
    expect(p.uv[1]).toBeCloseTo(p.p[2] / 1.2, 6);
  }
  expect(mesh.positions).toEqual(original);
  const other = fixture(),
    stable = addFin(other.mesh, .55, .55);
  for (const f of other.frames) for (let z = 12; z < 18; z++) for (let x = 12; x < 18; x++) f.filteredDepth[z * 30 + x] = 1.85;
  const protectedFaces = new Uint8Array(other.mesh.indices.length / 3);
  expect(prepareScanCeiling(other.mesh, other.frames, other.helpers, protectedFaces)).not.toBeNull();
  expect(protectedFaces[stable]).toBe(0);
});

test("a ceiling silhouette cannot cut a source face where the replacement has no photograph", () => {
  const { mesh, frames, helpers } = fixture(), fin = addFin(mesh, .52, .52);
  helpers.sampleColor = (f, uv) => uv.u > .4 && uv.u < .6 && uv.v > .4 && uv.v < .6 ? null : [180, 178, 170];
  const removed = new Uint8Array(mesh.indices.length / 3);
  const result = prepareScanCeiling(mesh, frames, helpers, removed);
  expect(result).not.toBeNull();
  expect(removed[fin]).toBe(0);
  expect(result.fragments.some(f => f.face === fin)).toBe(false);
});
test("independently observed free space cannot be filled by a ceiling color match", () => {
  const {
    mesh,
    frames,
    helpers
  } = fixture();
  for (const f of frames) {
    f.freeSpaceMask = new Uint8Array(900).fill(1);
    for (let z = 14; z < 16; z++) for (let x = 14; x < 16; x++) f.filteredDepth[z * 30 + x] = 2.6;
  }
  const result = prepareScanCeiling(mesh, frames, helpers, new Uint8Array(mesh.indices.length / 3));
  expect(result).not.toBeNull();
  for (let face = 0; face < result.surface.indices.length / 3; face++) {
    const points = [0, 1, 2].map(c => result.surface.indices[face * 3 + c] * 3);
    const x = points.reduce((s, i) => s + result.surface.positions[i] / 3, 0),
      z = points.reduce((s, i) => s + result.surface.positions[i + 2] / 3, 0);
    expect(x > .56 && x < .64 && z > .56 && z < .64).toBe(false);
  }
});

test('an enclosed missing mesh patch uses two translated photos while exterior gaps stay open', () => {
  const {mesh,frames,helpers}=fixture({opening:true});
  const result=prepareScanCeiling(mesh,frames,helpers,new Uint8Array(mesh.indices.length/3));
  expect(result.diagnostics.repairedGapCells).toBeGreaterThanOrEqual(36);
  const s=result.surface,[min,max]=s.extent;
  const index=(x,z)=>(z-min[1])*(max[0]-min[0])+x-min[0];
  expect(s.footprint[index(15,15)]).toBe(2);
  expect(s.positions.every(Number.isFinite)).toBe(true);
  // A camera rotation without translation cannot provide a second photo vote
  // or a native three-view witness for the single-photo fallback.
  for(const f of frames)f.viewTransformMatrix=frames[0].transformMatrix.slice();
  for (const f of frames.slice(1)) for (let z=12;z<18;z++) for(let x=12;x<18;x++) f.measuredMask[z*30+x]=0;
  const stationary=prepareScanCeiling(mesh,frames,helpers,new Uint8Array(mesh.indices.length/3));
  expect(stationary.surface.footprint[index(15,15)]).toBe(0);
});

test("three native ceiling observations can texture a meshing gap from one visible photograph", () => {
  const { mesh, frames, helpers } = fixture({ opening: true });
  frames[1].colorImage = null;
  frames[2].colorImage = null;
  const result = prepareScanCeiling(mesh, frames, helpers, new Uint8Array(mesh.indices.length / 3));
  expect(result.diagnostics.nativePhotoGapCells).toBeGreaterThanOrEqual(36);
  const s = result.surface, [min, max] = s.extent;
  expect(s.footprint[(15 - min[1]) * (max[0] - min[0]) + 15 - min[0]]).toBe(2);
  // The same color cannot bridge a fixture that is below the ceiling.
  for (const f of frames) for (let z = 12; z < 18; z++) for (let x = 12; x < 18; x++) f.filteredDepth[z * 30 + x] = 1.25;
  const hidden = prepareScanCeiling(mesh, frames, helpers, new Uint8Array(mesh.indices.length / 3));
  expect(hidden.surface.footprint[(15 - min[1]) * (max[0] - min[0]) + 15 - min[0]]).toBe(0);
});

test("an RGB-only color pose uses native ceiling witnesses when its borrowed depth view looks elsewhere", () => {
  const { mesh, frames, helpers } = fixture({ opening: true });
  const photo = { ...frames[0], frameId: 20, textureOnly: true };
  frames.forEach(f=>{f.colorImage=null;});
  const project=helpers.project;
  helpers.projectColor=project;
  helpers.project=(f,...p)=>f.textureOnly?null:project(f,...p);
  helpers.textureFrames=[photo];
  const result=prepareScanCeiling(mesh,frames,helpers,new Uint8Array(mesh.indices.length/3));
  expect(result.diagnostics.nativePhotoGapCells).toBeGreaterThanOrEqual(36);
  expect(result.surface.area).toBeGreaterThan(1);
  // A dark fixture in that photograph still cannot become plain ceiling.
  helpers.sampleColor=(f,uv)=>uv.u>.4&&uv.u<.6&&uv.v>.4&&uv.v<.6?[15,15,15]:[180,178,170];
  const protectedResult=prepareScanCeiling(mesh,frames,helpers,new Uint8Array(mesh.indices.length/3));
  const s=protectedResult.surface,[min,max]=s.extent;
  expect(s.footprint[(15-min[1])*(max[0]-min[0])+15-min[0]]).toBe(0);
});

test("a broad raised ceiling section keeps a separate height and survives portable export", () => {
  const { mesh, frames, helpers } = fixture();
  const originalCount = mesh.positions.length / 3;
  const raised = mesh.positions.slice();
  for (let i=0;i<raised.length;i+=3) { raised[i]+=1.2;raised[i+1]+=.28; }
  mesh.positions = new Float32Array([...mesh.positions,...raised]);
  mesh.normals = new Float32Array([...mesh.normals,...mesh.normals]);
  mesh.colors = new Uint8Array([...mesh.colors,...mesh.colors]);
  mesh.indices = new Uint32Array([...mesh.indices,...Array.from(mesh.indices,i=>i+originalCount)]);
  mesh.bounds.max.x=2.4;mesh.bounds.max.y=3;
  for(const f of frames){
    f.columns=60;f.filteredDepth=new Float32Array(1800);f.measuredMask=new Uint8Array(1800).fill(1);
    for(let y=0;y<30;y++)for(let x=0;x<60;x++)f.filteredDepth[y*60+x]=x<30?1.6:1.88;
  }
  helpers.project=(f,x,y,z)=>({u:x/2.4,v:z/1.2,depth:y-1});
  helpers.unproject=(f,i,d)=>[(i%60+.5)*.04,1+d,(Math.floor(i/60)+.5)*.04];
  const original=mesh.positions.slice(), design=buildScanDesignSurfaces(mesh,[],frames,helpers);
  expect(design.ceilings).toHaveLength(2);
  expect(Math.abs(design.ceilings[0].offset-design.ceilings[1].offset)).toBeGreaterThan(.2);
  const first=design.ceilings[0],second=design.ceilings[1];
  const occupied=s=>new Set(Array.from(s.footprint,(v,i)=>v?`${i%(s.extent[1][0]-s.extent[0][0])+s.extent[0][0]},${Math.floor(i/(s.extent[1][0]-s.extent[0][0]))+s.extent[0][1]}`:null).filter(Boolean));
  const cells=occupied(first);
  expect([...occupied(second)].some(k=>cells.has(k))).toBe(false);
  expect(mesh.positions).toEqual(original);
  mesh.designSurfaces=design;
  const restored=parsePartialScan(serializePartialScan({mesh})).mesh;
  expect(restored.designSurfaces.ceilings).toHaveLength(2);
  expect(restored.designSurfaces.ceilings.map(s=>s.positions)).toEqual(design.ceilings.map(s=>s.positions));
});
