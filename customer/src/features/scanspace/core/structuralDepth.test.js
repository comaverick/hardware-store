import { discoverStructuralPlanes, regularizeStructuralDepth,
  MAX_STRUCTURAL_DISPLACEMENT_METERS } from './structuralDepth';

function grid(frameId,height=()=>0) {
  const columns=36,rows=36,positions=[];
  for(let y=0;y<rows;y++) for(let x=0;x<columns;x++) positions.push(x*.07,height(x*.07,y*.07),y*.07);
  return {frameId,columns,rows,camera:new Float32Array([frameId*.12,1.4,3]),
    positions:new Float32Array(positions),measuredMask:new Uint8Array(columns*rows).fill(1),
    filteredDepth:new Float32Array(columns*rows).fill(2),depthConfidence:new Uint8Array(columns*rows).fill(255),
    freeSpaceMask:new Uint8Array(columns*rows).fill(1)};
}
const helpers={unproject:(f,i,depth)=>[0,1,2].map(k=>f.camera[k]+(f.positions[i*3+k]-f.camera[k])*depth/f.filteredDepth[i])};

function wall(frameId, shape = () => 0) {
  const frame = grid(frameId);
  for (let y = 0; y < frame.rows; y++) for (let x = 0; x < frame.columns; x++)
    frame.positions.set([x * .07, y * .07, shape(x * .07, y * .07)], (y * frame.columns + x) * 3);
  return frame;
}

test('raw wall support distinguishes repeatedly measured raised relief from flat footprint cells', () => {
  const frames = [0, 1, 2, 3].map(i => wall(i, (x, y) =>
    x > .8 && x < 1.6 && y > .8 && y < 1.6 ? .03 : 0));
  const planes = discoverStructuralPlanes(frames, { floorY: 0 });
  const plane = planes.find(p => p.kind === 'wall');
  expect(plane).toBeDefined();
  const keyAt = p => plane.axes.map(axis => Math.floor(axis.reduce((sum, v, i) => sum + v * p[i], 0) / plane.cellSize)).join(',');
  expect(plane.reliefCells.has(keyAt([1.12, 1.12, .03]))).toBe(true);
  expect(plane.reliefCells.has(keyAt([.42, 1.12, 0]))).toBe(false);
  expect(plane.cells.get(keyAt([.42, 1.12, 0])).size).toBeGreaterThanOrEqual(3);
});

test('raw wall seed evidence retains its measured angle and never snaps raw curtain depth', () => {
  const frames = [0, 1, 2, 3].map(i => wall(i, x => x * .21));
  const plane = discoverStructuralPlanes(frames, { floorY: 0 }).find(p => p.kind === 'wall');
  expect(plane).toBeDefined();
  expect(plane.normal[0] / plane.normal[2]).toBeCloseTo(-.21, 4);
  const curtain = wall(4, x => x * .21 + .028 * Math.cos(x * Math.PI * 4));
  const before = curtain.positions.slice();
  const result = regularizeStructuralDepth([curtain], [plane], helpers);
  expect(result.diagnostics.correctedSamples).toBe(0);
  expect(result.frames[0].positions).toEqual(before);
});

test('independent broad floor and ceiling measurements establish separate structural planes',()=>{
  const floor=[0,1,2,3].map(i=>grid(i)),ceiling=[4,5,6,7].map(i=>grid(i,()=>2.6));
  const planes=discoverStructuralPlanes([...floor,...ceiling],{floorY:0});
  expect(planes.filter(p=>p.kind==='floor')).toHaveLength(1);
  expect(planes.filter(p=>p.kind==='ceiling')).toHaveLength(1);
  expect(planes.find(p=>p.kind==='ceiling').offset).toBeCloseTo(2.6,4);
  expect(planes.every(p=>p.supportingFrameIds.length>=3)).toBe(true);
});

test('opposing height bias through one photographed wall produces one gravity-aligned plane',()=>{
  const frames=[0,1,2,3,4,5].map(i=>wall(i, (x,y)=>x*.21+(i<3?.065:-.065)*(y-1.2)));
  const originals=frames.map(f=>f.positions.slice());
  const planes=discoverStructuralPlanes(frames,{floorY:0,minimumCellViews:2}).filter(p=>p.kind==='wall');
  expect(planes).toHaveLength(1);
  expect(planes[0].normal[1]).toBe(0);
  expect(planes[0].normal[0]/planes[0].normal[2]).toBeCloseTo(-.21,2);
  frames.forEach((f,i)=>expect(f.positions).toEqual(originals[i]));
});

test('close parallel recesses with separate footprints are not collapsed',()=>{
  const first=[0,1,2].map(i=>wall(i));
  const second=[3,4,5].map(i=>wall(i,()=>.14));
  for(const f of second) for(let i=0;i<f.positions.length;i+=3) f.positions[i]+=3;
  const planes=discoverStructuralPlanes([...first,...second],{floorY:0,minimumCellViews:2}).filter(p=>p.kind==='wall');
  expect(planes).toHaveLength(2);
  expect(planes.map(p=>p.offset).sort((a,b)=>a-b)[1]).toBeCloseTo(.14);
});

test('independently observed opposite sides of a thin partition remain separate',()=>{
  const first=[0,1,2].map(i=>wall(i)), second=[3,4,5].map(i=>wall(i,()=>.14));
  for(const f of second) f.camera[2]=-1;
  const planes=discoverStructuralPlanes([...first,...second],{floorY:0,minimumCellViews:2}).filter(p=>p.kind==='wall');
  expect(planes).toHaveLength(2);
});

test('a supported warped depth sample moves along its original ray without mutating the capture',()=>{
  const frames=[0,1,2,3].map(i=>grid(i));
  const warped=grid(4,()=>.03),before=warped.positions.slice();
  const planes=discoverStructuralPlanes(frames,{floorY:0});
  const result=regularizeStructuralDepth([warped],planes,helpers);
  expect(result.diagnostics.correctedSamples).toBeGreaterThan(100);
  const frame=result.frames[0];
  const i=Array.from({length:frame.columns*frame.rows},(_,index)=>index)
    .find(index=>Math.abs(frame.positions[index*3+1])<1e-5);
  expect(i).toBeDefined();
  expect(frame.positions[i*3+1]).toBeCloseTo(0,5);
  expect(frame.originalFilteredDepth).toBe(warped.filteredDepth);
  expect(frame.freeSpaceMask[i]).toBe(0);
  expect(warped.positions).toEqual(before);
  expect(warped.filteredDepth[i]).toBe(2);
  expect(result.diagnostics.maxDisplacementMeters).toBeLessThanOrEqual(MAX_STRUCTURAL_DISPLACEMENT_METERS);
});

test('large ceiling or floor displacement is left as measured instead of snapped to a plane',()=>{
  const frames=[0,1,2,3].map(i=>grid(i));
  const warped=grid(4,()=>.12),before=warped.positions.slice();
  const planes=discoverStructuralPlanes(frames,{floorY:0});
  const result=regularizeStructuralDepth([warped],planes,helpers);
  expect(result.diagnostics.correctedSamples).toBe(0);
  expect(result.frames[0].positions).toEqual(before);
});

test('two translated views do not authorize a structural footprint',()=>{
  expect(discoverStructuralPlanes([grid(0),grid(1)],{floorY:0})).toHaveLength(0);
});

test('repeated stationary observations and desk tops cannot establish structural repairs',()=>{
  const stationary=[grid(0),grid(0),grid(0),grid(0)];
  expect(discoverStructuralPlanes(stationary,{floorY:0})).toHaveLength(0);
  expect(discoverStructuralPlanes([0,1,2,3].map(i=>grid(i,()=>.8)),{floorY:0})).toHaveLength(0);
  expect(discoverStructuralPlanes([0,1,2].map(i=>grid(i)),{})).toHaveLength(0);
});

test('camera order cannot hide three mutually translated structural observations', () => {
  const cameras = [
    [.19113266, 1.44091988, -.11932269],
    [.17643759, 1.37360799, -.15738606],
    [.16198438, 1.31719267, -.15217741],
    [.15754895, 1.37150550, -.10084696],
  ];
  const frames = cameras.map((camera, id) => ({ ...grid(id), camera: new Float32Array(camera) }));
  const orders = [frames, frames.slice().reverse(), [frames[1], frames[3], frames[0], frames[2]]];
  for (const ordered of orders) {
    const plane = discoverStructuralPlanes(ordered, { floorY: 0 }).find(p => p.kind === 'floor');
    expect(plane).toBeDefined();
    expect(plane.supportingFrameIds.slice().sort()).toEqual([0, 2, 3]);
    expect([...plane.cells.values()].some(ids => ids.size === 3)).toBe(true);
  }
});

test('three-view fallback avoids a central camera that blocks a valid structural footprint', () => {
  // Farthest-first chooses 0 then 1, but camera 1 lies within six centimetres
  // of 2, 3 and 4. Cameras 0, 2, 3 and 4 are mutually independent.
  const cameras = [[-.6, 1.4, 3], [0, 1.4, 3], [-.012, 1.4, 3.054],
    [-.057, 1.4, 3], [-.012, 1.4, 2.946]];
  const frames = cameras.map((camera, id) => ({ ...grid(id), camera: new Float32Array(camera) }));
  const plane = discoverStructuralPlanes(frames, { floorY: 0 }).find(p => p.kind === 'floor');
  expect(plane).toBeDefined();
  expect(plane.supportingFrameIds.slice().sort()).toEqual([0, 2, 3, 4]);
  expect([...plane.cells.values()].some(ids => ids.size === 4)).toBe(true);
});

test('stationary repeats cannot conceal a stable raised step when extending floor support', () => {
  const translated = [0, 1, 2].map(i => grid(i, x => x > 1.7 ? .12 : 0));
  const repeats = Array.from({ length: 16 }, (_, i) => ({ ...grid(i + 3),
    camera: translated[0].camera.slice() }));
  const plane = discoverStructuralPlanes([...translated, ...repeats], { floorY: 0 })
    .find(p => p.kind === 'floor');
  expect(plane).toBeDefined();
  const keyAt = p => plane.axes.map(axis => Math.floor(axis.reduce((sum, v, i) => sum + v * p[i], 0)
    / plane.cellSize)).join(',');
  expect(plane.cells.get(keyAt([2.1, .12, 1.12]))?.size || 0).toBeLessThan(3);
  expect(plane.cells.get(keyAt([1.12, 0, 1.12])).size).toBeGreaterThanOrEqual(3);
});

test('genuine raised steps outside the consensus footprint are not flattened',()=>{
  const frames=[0,1,2,3].map(i=>grid(i,x=>x>1.7?.16:0));
  const planes=discoverStructuralPlanes(frames,{floorY:0});
  const result=regularizeStructuralDepth(frames,planes,helpers);
  for(const f of result.frames) expect(f.positions[(18*36+32)*3+1]).toBeCloseTo(.16,5);
});

test('missing measurements remain missing and cannot become independent support',()=>{
  const frames=[0,1,2,3].map(i=>grid(i)),planes=discoverStructuralPlanes(frames,{floorY:0});
  const target=grid(4,()=>.04),index=18*36+18;
  target.measuredMask[index]=0;target.filteredDepth[index]=0;
  const result=regularizeStructuralDepth([target],planes,helpers).frames[0];
  expect(result.filteredDepth[index]).toBe(0);
  expect(result.measuredMask[index]).toBe(0);
});
