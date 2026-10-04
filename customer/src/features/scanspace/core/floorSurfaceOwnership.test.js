import { floorSurfaceOwnership } from "./floorSurfaceOwnership";

const plane={kind:"floor",normal:[0,1,0],offset:0};
const helpers={project:(f,x,y,z)=>({u:x/1.2,v:-z/1.2,depth:1-y})};
function frames(levels=[0,0,0]) {
  return levels.map((level,id)=>{
    const originalPositions=new Float32Array(20*20*3);
    for(let y=0;y<20;y++)for(let x=0;x<20;x++) originalPositions.set([(x+.5)*.06,level,-(y+.5)*.06],(y*20+x)*3);
    return {frameId:id,camera:[id*.12,1,1],columns:20,rows:20,originalPositions,
      measuredMask:new Uint8Array(400).fill(1),filteredDepth:new Float32Array(400).fill(1),
      colorWidth:20,colorHeight:20,colorImage:new Uint8Array(1600).fill(160)};
  });
}

test("original horizontal samples and translated photographs own bounded noisy floor copies",()=>{
  const f=frames([-.02,.02,.01]),source=f[0].originalPositions.slice();
  const owner=floorSurfaceOwnership(plane,f,helpers);
  expect(owner.owns([.6,.1,-.6],[.6,0,-.6])).toBe(true);
  expect(owner.owns([.6,.13,-.6],[.6,0,-.6])).toBe(false);
  expect(f[0].originalPositions).toEqual(source);
});

test("one observed photograph covers a floor edge already confirmed by independent native depth",()=>{
  const f=frames(),projectColor=(frame,...p)=>frame.frameId===0?helpers.project(frame,...p):{u:2,v:.5};
  const owner=floorSurfaceOwnership(plane,f,{...helpers,projectColor});
  expect(owner.evidence([.6,0,-.6])).toMatchObject({agrees:3,photographs:1});
  expect(owner.owns([.6,.08,-.6],[.6,0,-.6])).toBe(true);
  const unseen=floorSurfaceOwnership(plane,f,{...helpers,projectColor:()=>({u:2,v:.5})});
  expect(unseen.owns([.6,.08,-.6],[.6,0,-.6])).toBe(false);
});
test.each([.06,.09,.16])("an independently stable raised level %s remains separate",level=>{
  const owner=floorSurfaceOwnership(plane,frames([level,level,level]),helpers);
  expect(owner.owns([.6,level,-.6],[.6,0,-.6])).toBe(false);
});

test("consistent rays on a drifting noisy floor do not masquerade as a raised platform",()=>{
  const f=frames();
  for(const frame of f)for(let y=0;y<20;y++)for(let x=0;x<20;x++)
    frame.originalPositions[(y*20+x)*3+1]=.06+((x+.5)*.06-.6)*.18;
  const before=f.map(frame=>frame.originalPositions.slice());
  const owner=floorSurfaceOwnership(plane,f,helpers);
  expect(owner.owns([.6,.08,-.6],[.6,0,-.6])).toBe(true);
  f.forEach((frame,i)=>expect(frame.originalPositions).toEqual(before[i]));
});

test("a real raised plateau remains protected near its measured edge",()=>{
  const f=frames();
  for(const frame of f)for(let y=0;y<20;y++)for(let x=0;x<20;x++)
    frame.originalPositions[(y*20+x)*3+1]=x>=7?.06:0;
  const owner=floorSurfaceOwnership(plane,f,helpers);
  expect(owner.owns([.48,.06,-.6],[.48,0,-.6])).toBe(false);
  expect(owner.owns([.24,0,-.6])).toBe(true);
});
test("stationary depth repeats and missing native pixels cannot authorize replacement",()=>{
  const f=frames();f.forEach(frame=>{frame.camera=[0,1,1];frame.viewTransformMatrix=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,frame.frameId*.12,1,1,1]);});
  expect(floorSurfaceOwnership(plane,f,helpers).owns([.6,0,-.6])).toBe(false);
  const missing=frames();missing.forEach(frame=>frame.measuredMask.fill(0));
  expect(floorSurfaceOwnership(plane,missing,helpers).owns([.6,0,-.6])).toBe(false);
});
test("stationary color poses and captures without original depth do not enable the floor ownership path",()=>{
  const f=frames();f.forEach(frame=>{frame.viewTransformMatrix=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,1,1,1]);});
  expect(floorSurfaceOwnership(plane,f,helpers)).toBeNull();
  expect(floorSurfaceOwnership(plane,frames().map(({originalPositions,...f})=>f),helpers)).toBeNull();
});
test("native vertical baseboard samples are not flattened into the floor",()=>{
  const f=frames();for(const frame of f)for(let y=0;y<20;y++)for(let x=0;x<20;x++)
    frame.originalPositions.set([(x+.5)*.06,(y+.5)*.004,-.6],(y*20+x)*3);
  expect(floorSurfaceOwnership(plane,f,helpers).owns([.6,.04,-.6],[.6,0,-.6])).toBe(false);
});
