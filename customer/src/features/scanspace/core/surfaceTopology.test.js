import { conformSurfaceTopology, surfaceTopologyDiagnostics, triangulatePlanarLoop } from './surfaceTopology';

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
