import { fillSmallMeshHoles } from './fusion';

function grid(missing, horizontal = false, height = 0) {
  const positions = [], indices = [];
  for (let y = 0; y <= 10; y++) for (let x = 0; x <= 10; x++)
    positions.push(...(horizontal ? [x * 0.05, height, y * 0.05] : [x * 0.05, y * 0.05, height]));
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    if (missing(x, y)) continue;
    const a = y * 11 + x;
    indices.push(a, a + 11, a + 1, a + 1, a + 11, a + 12);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices),
    colors: new Uint8Array(positions.length).fill(120), surfacePatchIds: new Int32Array(indices.length / 3) };
}
const options = { maxDiameter: 0.3, maxPlanarity: 0.018,
  supportedPlanes: [{ normal: [0, 0, 1], offset: 0 }] };

test('bounded estimated repair closes only a supported enclosed wall hole', () => {
  const mesh = grid((x, y) => x === 4 && y === 5), original = mesh.positions.slice();
  const repaired = fillSmallMeshHoles(mesh, options);
  expect(repaired.filledHoleCount).toBe(1);
  expect(repaired.filledHoleArea).toBeCloseTo(0.0025, 5);
  expect(repaired.surfacePatchIds.length).toBe(repaired.indices.length / 3);
  expect(mesh.positions).toEqual(original);
  expect(fillSmallMeshHoles(mesh, { ...options, supportedPlanes: [] }).filledHoleCount).toBe(0);
  expect(fillSmallMeshHoles(mesh, { ...options, allowRepair: () => false }).filledHoleCount).toBe(0);
});

test('outer boundaries, oversized gaps and non-star-shaped holes stay open', () => {
  expect(fillSmallMeshHoles(grid((x, y) => x === 0 && y === 5), options).filledHoleCount).toBe(0);
  expect(fillSmallMeshHoles(grid((x, y) => x >= 2 && x <= 7 && y >= 2 && y <= 7), options).filledHoleCount).toBe(0);
  const concave = grid((x, y) => (y === 3 && x >= 3 && x <= 5) || ((x === 3 || x === 5) && y >= 3 && y <= 5));
  expect(fillSmallMeshHoles(concave, options).filledHoleCount).toBe(0);
});

test('horizontal repair is limited to the floor, not shelf tops or ceilings', () => {
  const missing = (x, y) => x === 4 && y === 5;
  expect(fillSmallMeshHoles(grid(missing, true), { ...options,
    supportedPlanes: [{ normal: [0, 1, 0], offset: 0 }] }).filledHoleCount).toBe(1);
  for (const height of [0.8, 2.8]) expect(fillSmallMeshHoles(grid(missing, true, height), { ...options,
    supportedPlanes: [{ normal: [0, 1, 0], offset: height }] }).filledHoleCount).toBe(0);
});

test('a ceiling gap requires explicit independent raw-depth support', () => {
  const source=grid((x,y)=>x===4&&y===5,true,2.8);
  const plane={normal:[0,1,0],offset:2.8,kind:'ceiling',supportingFrameIds:[1,2,3]};
  expect(fillSmallMeshHoles(source,{...options,supportedPlanes:[plane],triangulateConcave:true}).filledHoleCount).toBe(1);
  expect(fillSmallMeshHoles(source,{...options,supportedPlanes:[{...plane,supportingFrameIds:[1,2]}]}).filledHoleCount).toBe(0);
});

test('a bounded hole on a measured slanted panel needs plane support and depth agreement', () => {
  const source=grid((x,y)=>x===4&&y===5);
  for(let i=2;i<source.positions.length;i+=3)
    source.positions[i]=source.positions[i-1]*.3;
  const length=Math.hypot(.3,1);
  const panel={normal:[0,-.3/length,1/length],offset:0,
    retainedArea:.4,maxInputResidual:.06};
  const allowRepair=()=>true;
  expect(fillSmallMeshHoles(source,{...options,supportedPlanes:[panel],allowRepair}).filledHoleCount).toBe(1);
  expect(fillSmallMeshHoles(source,{...options,supportedPlanes:[panel],allowRepair:()=>false}).filledHoleCount).toBe(0);
  expect(fillSmallMeshHoles(source,{...options,supportedPlanes:[{...panel,retainedArea:.1}],allowRepair}).filledHoleCount).toBe(0);
});

test('supported concave gaps use interior triangles rather than a crossing fan', () => {
  const source=grid((x,y)=>(y===3&&x>=3&&x<=5)||((x===3||x===5)&&y>=3&&y<=5));
  const result=fillSmallMeshHoles(source,{...options,triangulateConcave:true});
  expect(result.filledHoleCount).toBe(1);
  expect(result.filledHoleArea).toBeCloseTo(.0175,6);
  let calls=0;
  expect(fillSmallMeshHoles(source,{...options,triangulateConcave:true,allowRepair:()=>++calls<3}).filledHoleCount).toBe(0);
});
