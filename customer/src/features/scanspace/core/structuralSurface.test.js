import { rebuildStructuralSurfaces } from './structuralSurface';
import { conformSurfaceTopology, surfaceTopologyDiagnostics } from './surfaceTopology';

function fixture({hole=false, wall=false}={}) {
  const plane={normal:[0,1,0],offset:0,kind:'floor',axes:[[1,0,0],[0,0,-1]],cellSize:.12,
    cells:new Map(),supportingFrameIds:[0,1,2],area:1.44};
  const positions=[],indices=[],patches=[];
  for(let y=0;y<10;y++) for(let x=0;x<10;x++) {
    if(hole&&x===5&&y===5) continue;
    plane.cells.set(`${x},${y}`,new Set([0,1,2]));
    const base=positions.length/3;
    positions.push(x*.12,0,-y*.12,(x+1)*.12,0,-y*.12,x*.12,0,-(y+1)*.12,(x+1)*.12,0,-(y+1)*.12);
    indices.push(base,base+1,base+2,base+1,base+3,base+2);patches.push(0,0);
  }
  if(wall) {
    const base=positions.length/3;
    positions.push(0,0,0,0,0,-1.2,0,.2,0,0,.2,-1.2);
    indices.push(base,base+1,base+2,base+1,base+3,base+2);patches.push(-1,-1);
  }
  const mesh={positions:new Float32Array(positions),indices:new Uint32Array(indices),
    colors:new Uint8Array(positions.length).fill(90),surfacePatchIds:new Int32Array(patches),
    planarConsolidation:{planes:[plane]}};
  const frames=[0,1,2].map(i=>({frameId:i,camera:[i*.12,1,1],columns:20,rows:20,
    measuredMask:new Uint8Array(400).fill(1),filteredDepth:new Float32Array(400).fill(1)}));
  return {mesh,plane,frames};
}
const helpers={project:(f,x,y,z)=>({u:x/1.2,v:-z/1.2,depth:1-y}),linearByte:v=>v};

test('rebuilding a floor preserves its perpendicular baseboard and shares the junction',()=>{
  const {mesh,plane,frames}=fixture({wall:true}),before=mesh.positions.slice();
  const result=conformSurfaceTopology(rebuildStructuralSurfaces(mesh,[plane],frames,helpers));
  expect(result.structuralRebuild.reconstructedArea).toBeCloseTo(1.44,4);
  expect(result.surfaceArea).toBeCloseTo(1.44+.24,4);
  expect(surfaceTopologyDiagnostics(result).nonManifoldEdges).toBe(0);
  expect(surfaceTopologyDiagnostics(result).boundaryLengthMeters).toBeCloseTo(5.2,4);
  expect(mesh.positions).toEqual(before);
  expect(result.colors.length).toBe(result.positions.length);
});

test('enclosed measured gaps may be repaired, but an unmeasured gap is left open',()=>{
  const {mesh,plane,frames}=fixture({hole:true});
  const repaired=rebuildStructuralSurfaces(mesh,[plane],frames,helpers,{repairPlanarGaps:true});
  expect(repaired.structuralRebuild.estimatedHoleCount).toBe(1);
  expect(repaired.structuralRebuild.estimatedArea).toBeCloseTo(.0144,6);
  for(const f of frames) for(let y=10;y<12;y++) for(let x=10;x<12;x++) f.measuredMask[y*20+x]=0;
  const missing=rebuildStructuralSurfaces(mesh,[plane],frames,helpers,{repairPlanarGaps:true});
  expect(missing.structuralRebuild.estimatedHoleCount).toBe(0);
  expect(missing.structuralRebuild.reconstructedArea).toBeLessThan(1.44);
});

test('observed empty space vetoes an estimated patch, including views outside the plane fit',()=>{
  const {mesh,plane,frames}=fixture({hole:true});
  for(let i=3;i<5;i++) frames.push({...frames[0],frameId:i,camera:[i*.12,1,1],filteredDepth:new Float32Array(400).fill(1.3)});
  const result=rebuildStructuralSurfaces(mesh,[plane],frames,helpers,{repairPlanarGaps:true});
  expect(result.structuralRebuild.reconstructedTriangles).toBe(0);
  expect(result.indices).toBe(mesh.indices);
});

test('nearby offset sheets and furniture faces are not cut out by the flat grid',()=>{
  const {mesh,plane,frames}=fixture();
  for(let i=1;i<mesh.positions.length;i+=3) mesh.positions[i]=.15;
  const result=rebuildStructuralSurfaces(mesh,[plane],frames,helpers);
  expect(result.structuralRebuild.removedTriangles).toBe(0);
  expect(Array.from(result.positions.slice(0,mesh.positions.length))).toEqual(Array.from(mesh.positions));
});

test('two stationary repeats cannot authorize a rebuilt footprint',()=>{
  const {mesh,plane,frames}=fixture();
  for(const f of frames) f.camera=[0,1,1];
  const result=rebuildStructuralSurfaces(mesh,[plane],frames,helpers);
  expect(result.structuralRebuild.reconstructedArea).toBe(0);
});

test('short evidence-supported runs reconnect neighboring planar patches',()=>{
  const {mesh,plane,frames}=fixture();
  for(let y=0;y<10;y++) plane.cells.delete(`5,${y}`);
  const result=rebuildStructuralSurfaces(mesh,[plane],frames,helpers,{repairPlanarGaps:true});
  expect(result.structuralRebuild.bridgedCells).toBeGreaterThan(0);
  expect(result.structuralRebuild.bridgedArea).toBeGreaterThan(0);
  expect(result.structuralRebuild.estimatedHoleCount).toBeGreaterThan(0);
});

test('a measured foreground or opening vetoes a planar bridge',()=>{
  const {mesh,plane,frames}=fixture();
  for(let y=0;y<10;y++) plane.cells.delete(`5,${y}`);
  const veto={...frames[0],frameId:9,camera:[2,1,1],filteredDepth:new Float32Array(400).fill(1.3)};
  const result=rebuildStructuralSurfaces(mesh,[plane],[...frames,veto],helpers,{repairPlanarGaps:true});
  expect(result.structuralRebuild.bridgedCells).toBe(0);
});
