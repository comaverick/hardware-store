import { prepareFoldedPhotoPanel } from './scanPhotoPanelPreparation';
function fixture() {
  const preserved = new Map();
  for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) preserved.set(`${x},${y}`,
    { x,y,depthOffset:.03*Math.cos(x*Math.PI/4),support:3,foldedPanel:true });
  const frame = { colorWidth:512,colorHeight:1024,colorFocus:10,atlasUVTransform:[.1,.1,.3,.7],
    columns:30,rows:30,filteredDepth:new Float32Array(900).fill(2),measuredMask:new Uint8Array(900).fill(1),
    transformMatrix:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,.6,.6,0,1]) };
  return { preserved, wall:{normal:[0,0,1],offset:-2,axes:[[1,0,0],[0,1,0]],cellSize:.04},
    helpers:{textureFrames:[frame],projectColor:(f,x,y)=>({u:.02+x/1.2*.96,v:.02+y/1.2*.96}),
      project:(f,x,y,z)=>({u:.02+x/1.2*.96,v:.02+y/1.2*.96,depth:-z})} };
}
test('a continuous photo panel retains measured folds, front-facing triangles and exact atlas addressing', () => {
  const {wall,preserved,helpers}=fixture(), before=[...preserved.values()].map(p=>({...p}));
  const result=prepareFoldedPhotoPanel(wall,preserved,helpers);
  expect(result.cells.size).toBe(900);
  const depths=[...result.cells.values()].flatMap(p=>p.vertices.map(v=>v.p[2]));
  expect(Math.max(...depths)-Math.min(...depths)).toBeGreaterThan(.04);
  for(const p of result.cells.values()) for(const v of p.vertices){
    expect(v.n[2]).toBeGreaterThan(.7);
    expect(v.uv[0]).toBeCloseTo(.1+(.02+v.p[0]/1.2*.96)*.3,6);
    expect(v.uv[1]).toBeCloseTo(.1+(1-(.02+v.p[1]/1.2*.96))*.7,6);
  }
  expect([...preserved.values()]).toEqual(before);
});
test.each(['flat','unsupported','hidden','missingPhoto'])('%s fabric does not authorize a photographed repair', kind => {
  const {wall,preserved,helpers}=fixture();
  if(kind==='flat')for(const p of preserved.values())p.foldedPanel=false;
  if(kind==='unsupported')for(const p of preserved.values())p.support=1;
  if(kind==='hidden')helpers.textureFrames[0].filteredDepth.fill(1);
  if(kind==='missingPhoto')helpers.textureFrames=[];
  expect(prepareFoldedPhotoPanel(wall,preserved,helpers)).toBeNull();
});
