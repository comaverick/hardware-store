import { rebuildStructuralSurfaces } from './structuralSurface';
import { conformSurfaceTopology, surfaceTopologyDiagnostics } from './surfaceTopology';
import { structuralRebuildRegression } from './fusion';

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

test('a partial ceiling passes every area gate while keeping a measured opening',()=>{
  const {mesh,plane,frames}=fixture({hole:true});
  plane.kind='ceiling'; plane.offset=2.6;
  for(let i=1;i<mesh.positions.length;i+=3) mesh.positions[i]+=2.6;
  for(const k of plane.cells.keys()) {
    const [x,y]=k.split(',').map(Number);
    if(x>=6 || y>=7) plane.cells.delete(k);
  }
  plane.area=plane.cells.size*.0144;
  const ceilingHelpers={...helpers,project:(f,x,y,z)=>({...helpers.project(f,x,y-2.6,z)})};
  const result=conformSurfaceTopology(rebuildStructuralSurfaces(mesh,[plane],frames,ceilingHelpers));
  expect(result.structuralRebuild.reconstructedArea).toBeLessThanOrEqual(plane.area);
  expect(result.structuralRebuild.planes[0].kind).toBe('ceiling');
  expect(result.structuralRebuild.reconstructedArea).toBeLessThan(.7);
  expect(result.structuralRebuild.reconstructedArea).toBeGreaterThan(.35);
  expect(result.structuralRebuild.estimatedArea).toBe(0);
  for(let i=0;i<result.indices.length;i+=3) {
    const p=Array.from(result.indices.subarray(i,i+3)).map(id=>
      [result.positions[id*3],-result.positions[id*3+2]]);
    const sides=p.map((a,j)=>{
      const b=p[(j+1)%3]; return (b[0]-a[0])*(.66-a[1])-(b[1]-a[1])*(.66-a[0]);
    });
    expect(sides.every(s=>s>1e-6)||sides.every(s=>s< -1e-6)).toBe(false);
  }
});

test('structural evidence uses three available translated views regardless of their input order',()=>{
  const {mesh,plane,frames}=fixture();
  const cameras=[[0,1,1],[.08,1,1],[.05,1,1.055],[.05,1,.945]];
  const views=cameras.map((camera,frameId)=>({...frames[0],camera,frameId}));
  const first=rebuildStructuralSurfaces(mesh,[plane],views,helpers);
  const reversed=rebuildStructuralSurfaces(mesh,[plane],views.slice().reverse(),helpers);
  expect(first.structuralRebuild.reconstructedArea).toBeCloseTo(1.44,5);
  expect(reversed.structuralRebuild.reconstructedArea).toBe(first.structuralRebuild.reconstructedArea);
});

test('an unreliable free-space ray cannot veto three measured structural observers',()=>{
  const {mesh,plane,frames}=fixture();
  for(let i=3;i<5;i++) frames.push({...frames[0],frameId:i,camera:[i*.12,1,1],
    filteredDepth:new Float32Array(400).fill(1.3),freeSpaceMask:new Uint8Array(400)});
  expect(rebuildStructuralSurfaces(mesh,[plane],frames,helpers).structuralRebuild.reconstructedArea)
    .toBeCloseTo(1.44,5);
});

test('stationary free-space repeats do not outweigh translated support, but a second translated veto does',()=>{
  const {mesh,plane,frames}=fixture();
  const veto={...frames[0],frameId:3,camera:[.5,1,1],
    filteredDepth:new Float32Array(400).fill(1.3),
    freeSpaceMask:new Uint8Array(400).fill(1),depthConfidence:new Uint8Array(400).fill(255)};
  const first=rebuildStructuralSurfaces(mesh,[plane],[...frames,veto],helpers);
  const duplicate={...veto,frameId:4,camera:veto.camera.slice()};
  const repeated=rebuildStructuralSurfaces(mesh,[plane],[...frames,veto,duplicate],helpers);
  expect(first.structuralRebuild.reconstructedArea).toBeCloseTo(1.44,5);
  expect(repeated.structuralRebuild.reconstructedArea).toBe(first.structuralRebuild.reconstructedArea);
  const translated={...veto,frameId:5,camera:[.62,1,1]};
  const contradicted=rebuildStructuralSurfaces(mesh,[plane],[...frames,veto,duplicate,translated],helpers);
  expect(contradicted.structuralRebuild.reconstructedArea).toBe(0);
  expect(contradicted.indices).toBe(mesh.indices);
});

test('a verified ceiling uses only its own tagged repaired rays, retaining original depths for audit',()=>{
  const {mesh,plane,frames}=fixture();
  plane.kind='ceiling'; plane.ceilingRecoveryId=1;
  for(const frame of frames) {
    frame.originalFilteredDepth=new Float32Array(400).fill(1.3);
    frame.ceilingRepairMask=new Uint8Array(400).fill(1);
    frame.freeSpaceMask=new Uint8Array(400);
  }
  expect(rebuildStructuralSurfaces(mesh,[plane],frames,helpers).structuralRebuild.reconstructedArea)
    .toBeCloseTo(1.44,5);
  plane.ceilingRecoveryId=2;
  expect(rebuildStructuralSurfaces(mesh,[plane],frames,helpers).structuralRebuild.reconstructedArea).toBe(0);
  expect(frames[0].originalFilteredDepth[0]).toBeCloseTo(1.3,5);
});

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

test('a bounded floor correction carries its shared baseboard boundary onto the same plane',()=>{
  const {mesh,plane,frames}=fixture({wall:true});
  for(let i=1;i<mesh.positions.length;i+=3) mesh.positions[i]+=.02;
  const original=mesh.positions.slice(), before=conformSurfaceTopology(mesh);
  const result=conformSurfaceTopology(rebuildStructuralSurfaces(mesh,[plane],frames,helpers));
  expect(result.structuralRebuild.reconstructedArea).toBeCloseTo(1.44,4);
  expect(result.structuralRebuild.correctedBoundaryVertices).toBeGreaterThan(0);
  expect(result.structuralRebuild.maxBoundaryDisplacementMeters).toBeCloseTo(.02,5);
  expect(surfaceTopologyDiagnostics(result).componentCount).toBe(1);
  expect(surfaceTopologyDiagnostics(result).nonManifoldEdges).toBe(0);
  expect(structuralRebuildRegression(before,result).accepted).toBe(true);
  expect(mesh.positions).toEqual(original);
  // The upper baseboard is still measured; only its shared lower seam moves.
  expect(Math.max(...Array.from(result.positions).filter((_,i)=>i%3===1))).toBeCloseTo(.22,5);
});

test('partial replacement clips and joins an offset perimeter without moving the unsupported remainder',()=>{
  const {mesh,plane,frames}=fixture();
  for(let y=7;y<10;y++) for(let x=0;x<10;x++) plane.cells.delete(`${x},${y}`);
  mesh.positions=new Float32Array([
    0,.02,0, 1.2,.02,0, 0,.02,-1.2, 1.2,.02,-1.2,
    0,.02,0, 0,.02,-1.2, 0,.22,0, 0,.22,-1.2,
  ]);
  mesh.indices=new Uint32Array([0,1,2,1,3,2,4,5,6,5,7,6]);
  mesh.colors=new Uint8Array(mesh.positions.length).fill(90);
  mesh.surfacePatchIds=new Int32Array([0,0,-1,-1]);
  const original=mesh.positions.slice(), before=conformSurfaceTopology(mesh);
  const result=conformSurfaceTopology(rebuildStructuralSurfaces(mesh,[plane],frames,helpers));
  expect(result.structuralRebuild.reconstructedArea).toBeCloseTo(1.008,4);
  expect(result.structuralRebuild.splitBoundaryEdges).toBeGreaterThan(0);
  expect(surfaceTopologyDiagnostics(result).componentCount).toBe(1);
  expect(surfaceTopologyDiagnostics(result).nonManifoldEdges).toBe(0);
  expect(structuralRebuildRegression(before,result).accepted).toBe(true);
  const retainedFarEdge=[];
  for(let i=0;i<result.positions.length;i+=3)
    if(result.positions[i+2]<-1.19 && result.positions[i+1]<.05) retainedFarEdge.push(result.positions[i+1]);
  expect(retainedFarEdge.length).toBeGreaterThan(0);
  expect(retainedFarEdge.every(y=>Math.abs(y-.02)<1e-6)).toBe(true);
  expect(result.structuralRebuild.maxBoundaryDisplacementMeters).toBeLessThanOrEqual(.05);
  expect(mesh.positions).toEqual(original);
});

test('a separate object touching a corrected junction at one point keeps its measured corner',()=>{
  const {mesh,plane,frames}=fixture({wall:true});
  for(let i=1;i<mesh.positions.length;i+=3) mesh.positions[i]+=.02;
  const base=mesh.positions.length/3, object=[0,.02,0, -.2,.18,.1, -.1,.24,.2];
  mesh.positions=new Float32Array([...mesh.positions,...object]);
  mesh.indices=new Uint32Array([...mesh.indices,base,base+1,base+2]);
  mesh.colors=new Uint8Array(mesh.positions.length).fill(90);
  mesh.surfacePatchIds=new Int32Array([...mesh.surfacePatchIds,-1]);
  const result=conformSurfaceTopology(rebuildStructuralSurfaces(mesh,[plane],frames,helpers));
  const objectFaces=[];
  for(let t=0;t<result.indices.length;t+=3) {
    const p=[0,1,2].map(k=>Array.from(result.positions.subarray(result.indices[t+k]*3,result.indices[t+k]*3+3)));
    if(p.some(q=>q[0]<-.05)) objectFaces.push(p);
  }
  expect(objectFaces).toHaveLength(1);
  expect(objectFaces[0].find(p=>Math.abs(p[0])<1e-6&&Math.abs(p[2])<1e-6)[1]).toBeCloseTo(.02,5);
  expect(surfaceTopologyDiagnostics(result).componentCount).toBe(2);
});

test('a finer retained baseboard edge shares the corrected coarse floor boundary',()=>{
  const {mesh,plane,frames}=fixture();
  for(let i=1;i<mesh.positions.length;i+=3) mesh.positions[i]+=.02;
  const positions=Array.from(mesh.positions), indices=Array.from(mesh.indices), patches=Array.from(mesh.surfacePatchIds);
  for(let z=0;z<40;z++) {
    const base=positions.length/3, a=-z*.03, b=-(z+1)*.03;
    positions.push(0,.02,a, 0,.02,b, 0,.22,a, 0,.22,b);
    indices.push(base,base+1,base+2,base+1,base+3,base+2); patches.push(-1,-1);
  }
  mesh.positions=new Float32Array(positions);mesh.indices=new Uint32Array(indices);
  mesh.colors=new Uint8Array(positions.length).fill(90);mesh.surfacePatchIds=new Int32Array(patches);
  const before=conformSurfaceTopology(mesh);
  const result=conformSurfaceTopology(rebuildStructuralSurfaces(mesh,[plane],frames,helpers));
  expect(surfaceTopologyDiagnostics(result).componentCount).toBe(1);
  expect(surfaceTopologyDiagnostics(result).nonManifoldEdges).toBe(0);
  expect(structuralRebuildRegression(before,result).accepted).toBe(true);
});

test('a wider replacement option never raises the independent five-centimeter seam correction cap',()=>{
  const {mesh,plane,frames}=fixture({wall:true});
  for(let i=1;i<mesh.positions.length;i+=3) mesh.positions[i]+=.07;
  const before=conformSurfaceTopology(mesh);
  const result=conformSurfaceTopology(rebuildStructuralSurfaces(mesh,[plane],frames,helpers,{replacementBandMeters:.1}));
  expect(result.structuralRebuild.boundaryCorrectionLimitMeters).toBe(.05);
  expect(result.structuralRebuild.rejectedBoundaryCorrections).toBeGreaterThan(0);
  expect(result.structuralRebuild.maxBoundaryDisplacementMeters).toBe(0);
  expect(structuralRebuildRegression(before,result).accepted).toBe(false);
});

test('a retained curled patch keeps its original shared attachment edge when the grid subdivides it',()=>{
  const {mesh,plane,frames}=fixture();
  const base=mesh.positions.length/3;
  mesh.positions=new Float32Array([...mesh.positions,.72,0,-.6, .6,0,-.72, .7,-.12,-.75]);
  mesh.indices=new Uint32Array([...mesh.indices,base,base+1,base+2]);
  mesh.colors=new Uint8Array(mesh.positions.length).fill(90);
  mesh.surfacePatchIds=new Int32Array([...mesh.surfacePatchIds,-1]);
  const before=conformSurfaceTopology(mesh);
  const result=conformSurfaceTopology(rebuildStructuralSurfaces(mesh,[plane],frames,helpers));
  expect(surfaceTopologyDiagnostics(before).componentCount).toBe(1);
  expect(surfaceTopologyDiagnostics(result).componentCount).toBe(1);
  expect(result.structuralRebuild.preservedBoundaryCells).toBeGreaterThan(0);
  expect(result.structuralRebuild.reconstructedArea).toBeGreaterThan(1.2);
  expect(Math.min(...Array.from(result.positions).filter((_,i)=>i%3===1))).toBeCloseTo(-.12,5);
  expect(structuralRebuildRegression(before,result).accepted).toBe(true);
});

test('when attachment collars consume every cell the measured mesh returns unchanged',()=>{
  const {mesh,plane,frames}=fixture(), positions=Array.from(mesh.positions), indices=Array.from(mesh.indices), patches=Array.from(mesh.surfacePatchIds);
  for(let y=0;y<10;y++) for(let x=0;x<10;x++) {
    const base=positions.length/3;
    positions.push((x+1)*.12,0,-y*.12, x*.12,0,-(y+1)*.12, (x+.75)*.12,-.08,-(y+1.25)*.12);
    indices.push(base,base+1,base+2);patches.push(-1);
  }
  mesh.positions=new Float32Array(positions);mesh.indices=new Uint32Array(indices);
  mesh.colors=new Uint8Array(positions.length).fill(90);mesh.surfacePatchIds=new Int32Array(patches);
  const result=rebuildStructuralSurfaces(mesh,[plane],frames,helpers);
  expect(result.positions).toBe(mesh.positions);
  expect(result.indices).toBe(mesh.indices);
  expect(result.structuralRebuild.preservedBoundaryCells).toBe(100);
  expect(result.structuralRebuild.reconstructedTriangles).toBe(0);
});

test('bridge diagnostics count only estimated cells that survive the measured attachment collar',()=>{
  const {mesh,plane,frames}=fixture();
  for(let y=0;y<10;y++) plane.cells.delete(`5,${y}`);
  const base=mesh.positions.length/3;
  mesh.positions=new Float32Array([...mesh.positions,.72,0,-.6, .6,0,-.72, .7,-.12,-.75]);
  mesh.indices=new Uint32Array([...mesh.indices,base,base+1,base+2]);
  mesh.colors=new Uint8Array(mesh.positions.length).fill(90);mesh.surfacePatchIds=new Int32Array([...mesh.surfacePatchIds,-1]);
  const result=rebuildStructuralSurfaces(mesh,[plane],frames,helpers,{repairPlanarGaps:true});
  expect(result.structuralRebuild.proposedBridgedCells).toBeGreaterThan(result.structuralRebuild.bridgedCells);
  expect(result.structuralRebuild.bridgedCells).toBeGreaterThan(0);
  expect(result.structuralRebuild.bridgedArea).toBeCloseTo(result.structuralRebuild.bridgedCells*.0144,6);
  expect(result.structuralRebuild.estimatedArea).toBeCloseTo(result.structuralRebuild.bridgedArea,6);
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

test('a plane cell needs three independent observations before rebuilding',()=>{
  const {mesh,plane,frames}=fixture();
  for(const key of plane.cells.keys()) plane.cells.set(key,new Set([0,1]));
  const result=rebuildStructuralSurfaces(mesh,[plane],frames,helpers);
  expect(result.structuralRebuild.reconstructedArea).toBe(0);
  expect(result.indices).toBe(mesh.indices);
});

test('rebuilt cells replace nearby owned fragments while preserving separate foreground geometry',()=>{
  const {mesh,plane,frames}=fixture();
  const base=mesh.positions.length/3;
  mesh.positions=new Float32Array([...mesh.positions,
    .3,.025,-.3, .42,.025,-.3, .3,.025,-.42,
    .6,.15,-.6, .72,.15,-.6, .6,.15,-.72]);
  mesh.indices=new Uint32Array([...mesh.indices,base,base+1,base+2,base+3,base+4,base+5]);
  mesh.colors=new Uint8Array(mesh.positions.length).fill(90);
  mesh.surfacePatchIds=new Int32Array([...mesh.surfacePatchIds,0,0]);
  const result=rebuildStructuralSurfaces(mesh,[plane],frames,helpers);
  expect(result.structuralRebuild.removedCompetingTriangles).toBeGreaterThan(0);
  const trianglePositions=[];
  for(let i=0;i<result.indices.length;i+=3)
    trianglePositions.push([0,1,2].map(k=>result.positions[result.indices[i+k]*3+1]));
  expect(trianglePositions.some(y=>y.every(value=>Math.abs(value-.15)<.001))).toBe(true);
  expect(trianglePositions.some(y=>y.every(value=>Math.abs(value-.025)<.001))).toBe(false);
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
