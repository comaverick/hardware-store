import { conformSurfaceTopology, orientManifoldFaces, pruneUnsupportedFragments, surfaceConnectivityDiagnostics, surfaceTopologyDiagnostics, triangulatePlanarLoop } from './surfaceTopology';

const mesh = (p,i) => ({positions:new Float32Array(p),indices:new Uint32Array(i),colors:new Uint8Array(p.length).fill(125)});

test('a T junction becomes a shared edge without moving the surface or adding area', () => {
  const source=mesh([0,0,0, 2,0,0, 0,1,0, 0,-1,0, 1,0,0, 2,-1,0], [0,1,2, 0,3,4, 4,3,5, 4,5,1]);
  const before=source.positions.slice(),result=conformSurfaceTopology(source);
  expect(result.topologyRepair.splitFaces).toBe(1);
  expect(result.surfaceArea).toBeCloseTo(3,6);
  expect(surfaceTopologyDiagnostics(result).boundaryLengthMeters).toBeLessThan(surfaceTopologyDiagnostics(source).boundaryLengthMeters-3.9);
  expect(surfaceTopologyDiagnostics(result).nonManifoldEdges).toBe(0);
  expect(source.positions).toEqual(before);
  expect(result.surfacePatchIds.length).toBe(result.indices.length/3);
});

test('nearby parallel sheets and real gaps are not welded by screen-space proximity', () => {
  const source=mesh([0,0,0, 1,0,0, 0,1,0, 0,0,.02, 1,0,.02, 0,1,.02],[0,1,2,3,4,5]);
  const result=conformSurfaceTopology(source);
  expect(result.indices.length).toBe(6);
  expect(result.positions.length).toBe(18);
  expect(surfaceTopologyDiagnostics(result).boundaryEdges).toBe(6);
});

test('an isolated crossing point is not mistaken for a shared boundary edge',()=>{
  const source=mesh([0,0,0,2,0,0,0,1,0,1,0,0,1,-1,.2,1,-1,-.2],[0,1,2,3,4,5]);
  const result=conformSurfaceTopology(source);
  expect(result.topologyRepair.splitFaces).toBe(0);
  expect(result.indices.length).toBe(6);
});

test('exact duplicate faces are removed and attribute seams are preserved', () => {
  const source=mesh([0,0,0,1,0,0,0,1,0],[0,1,2,2,1,0]);
  expect(conformSurfaceTopology(source).indices.length).toBe(3);
  const separate=mesh([0,0,0,1,0,0,0,1,0,0,0,0,-1,0,0,0,-1,0],[0,1,2,3,4,5]);
  separate.uvs=new Float32Array([0,0,1,0,0,1,1,1,0,0,0,1]);
  const result=conformSurfaceTopology(separate);
  expect(result.positions.length).toBe(18);
  expect(result.uvs.length).toBe(12);
});

test('concave loops triangulate inside their boundary with coherent winding', () => {
  const p=[[0,0,0],[3,0,0],[3,3,0],[2,3,0],[2,1,0],[1,1,0],[1,3,0],[0,3,0]];
  const triangles=triangulatePlanarLoop(p,[0,0,1]);
  let area=0;
  for(const [a,b,c] of triangles.map(t=>t.map(i=>p[i]))) {
    const cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    expect(cross).toBeGreaterThan(0);area+=cross/2;
    const x=(a[0]+b[0]+c[0])/3,y=(a[1]+b[1]+c[1])/3;
    expect(x>1&&x<2&&y>1).toBe(false);
  }
  expect(area).toBeCloseTo(7,6);
});

test('connectivity diagnostics expose detached mesh patches',()=>{
  const source=mesh([0,0,0,1,0,0,0,1,0, 2,0,0,3,0,0,2,1,0],[0,1,2,3,4,5]);
  const result=surfaceConnectivityDiagnostics(source);
  expect(result.componentCount).toBe(2);
  expect(result.disconnectedComponentCount).toBe(1);
  expect(result.dominantComponentAreaRatio).toBeCloseTo(.5,6);
  expect(result.largestDisconnectedArea).toBeCloseTo(.5,6);
  expect(result.tinyDisconnectedCount).toBe(0);
});

test('manifold face orientation removes an inverted seam without moving geometry or UVs',()=>{
  const source=mesh([0,0,0, 1,0,0, 0,1,0, 1,1,0],[0,1,2, 1,2,3]);
  source.uvs=new Float32Array([0,0,1,0,0,1,1,1]);
  const before=source.positions.slice();
  expect(surfaceTopologyDiagnostics(source).windingConflicts).toBe(1);
  const result=orientManifoldFaces(source);
  expect(result.faceOrientation.flippedFaces).toBe(1);
  expect(surfaceTopologyDiagnostics(result).windingConflicts).toBe(0);
  expect(result.positions).toEqual(before);
  expect(result.uvs).toEqual(source.uvs);
  expect(source.indices).toEqual(new Uint32Array([0,1,2,1,2,3]));
});

test('face orientation does not weld a gap or infer a missing surface',()=>{
  const source=mesh([0,0,0,1,0,0,0,1,0, 0,0,.02,1,0,.02,0,1,.02],[0,1,2,3,4,5]);
  const result=orientManifoldFaces(source);
  expect(result.indices).toEqual(source.indices);
  expect(surfaceTopologyDiagnostics(result).disconnectedComponentCount).toBe(1);
});

test('ambiguous non-manifold junctions do not force face flips',()=>{
  const source=mesh([0,0,0,1,0,0,0,1,0,0,-1,0,0,0,1],[0,1,2,0,1,3,0,1,4]);
  const result=orientManifoldFaces(source);
  expect(result.indices).toEqual(source.indices);
  expect(result.faceOrientation.flippedFaces).toBe(0);
  expect(surfaceTopologyDiagnostics(result).nonManifoldEdges).toBe(1);
});

test('tiny detached fragments need repeat depth; independently observed details survive',()=>{
  const source=mesh([.1,.1,-1,.12,.1,-1,.1,.12,-1,.8,.1,-1,.82,.1,-1,.8,.12,-1],[0,1,2,3,4,5]);
  source.surfacePatchIds=new Int32Array([2,3]);
  const frames=[0,.1].map(x=>({camera:[x,0,0],columns:4,rows:4,
    measuredMask:new Uint8Array(16),filteredDepth:new Float32Array(16).fill(1)}));
  frames.forEach(frame=>{frame.measuredMask[0]=1;});
  const result=pruneUnsupportedFragments(source,frames,(_frame,x,y)=>({u:x,v:y,depth:1}));
  expect(result.fragmentPruning.removedComponents).toBe(1);
  expect(result.indices).toEqual(new Uint32Array([0,1,2]));
  expect(result.surfacePatchIds).toEqual(new Int32Array([2]));
  expect(source.indices).toEqual(new Uint32Array([0,1,2,3,4,5]));
  expect(surfaceTopologyDiagnostics(result).disconnectedComponentCount).toBe(0);
});

test('a separate object larger than the speck limit is preserved without repeat depth',()=>{
  const source=mesh([0,0,-1,.1,0,-1,0,.1,-1],[0,1,2]);
  const frame={camera:[0,0,0],columns:4,rows:4,
    measuredMask:new Uint8Array(16),filteredDepth:new Float32Array(16)};
  const result=pruneUnsupportedFragments(source,[frame],()=>({u:.5,v:.5,depth:1}));
  expect(result.fragmentPruning.removedComponents).toBe(0);
  expect(result.indices).toEqual(source.indices);
});
