import { discoverStructuralPlanes, regularizeStructuralDepth } from './structuralDepth';

function grid(frameId,height=()=>0) {
  const columns=36,rows=36,positions=[];
  for(let y=0;y<rows;y++) for(let x=0;x<columns;x++) positions.push(x*.07,height(x*.07,y*.07),y*.07);
  return {frameId,columns,rows,camera:new Float32Array([frameId*.12,1.4,3]),
    positions:new Float32Array(positions),measuredMask:new Uint8Array(columns*rows).fill(1),
    filteredDepth:new Float32Array(columns*rows).fill(2),depthConfidence:new Uint8Array(columns*rows).fill(255),
    freeSpaceMask:new Uint8Array(columns*rows).fill(1)};
}
const helpers={unproject:(f,i,depth)=>[0,1,2].map(k=>f.camera[k]+(f.positions[i*3+k]-f.camera[k])*depth/f.filteredDepth[i])};

test('independent broad floor and ceiling measurements establish separate structural planes',()=>{
  const floor=[0,1,2,3].map(i=>grid(i)),ceiling=[4,5,6,7].map(i=>grid(i,()=>2.6));
  const planes=discoverStructuralPlanes([...floor,...ceiling],{floorY:0});
  expect(planes.filter(p=>p.kind==='floor')).toHaveLength(1);
  expect(planes.filter(p=>p.kind==='ceiling')).toHaveLength(1);
  expect(planes.find(p=>p.kind==='ceiling').offset).toBeCloseTo(2.6,4);
  expect(planes.every(p=>p.supportingFrameIds.length>=3)).toBe(true);
});

test('a supported warped depth sample moves along its original ray without mutating the capture',()=>{
  const frames=[0,1,2,3].map(i=>grid(i));
  const warped=grid(4,()=>.07),before=warped.positions.slice();
  const planes=discoverStructuralPlanes(frames,{floorY:0});
  const result=regularizeStructuralDepth([warped],planes,helpers);
  expect(result.diagnostics.correctedSamples).toBeGreaterThan(100);
  const frame=result.frames[0],i=18*36+18;
  expect(frame.positions[i*3+1]).toBeCloseTo(0,5);
  expect(frame.originalFilteredDepth).toBe(warped.filteredDepth);
  expect(frame.freeSpaceMask[i]).toBe(0);
  expect(warped.positions).toEqual(before);
  expect(warped.filteredDepth[i]).toBe(2);
});

test('repeated stationary observations and desk tops cannot establish structural repairs',()=>{
  const stationary=[grid(0),grid(0),grid(0),grid(0)];
  expect(discoverStructuralPlanes(stationary,{floorY:0})).toHaveLength(0);
  expect(discoverStructuralPlanes([0,1,2,3].map(i=>grid(i,()=>.8)),{floorY:0})).toHaveLength(0);
  expect(discoverStructuralPlanes([0,1,2].map(i=>grid(i)),{})).toHaveLength(0);
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
