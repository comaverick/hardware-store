import { buildScanDesignSurfaces, validScanDesignSurfaces } from "./scanDesignSurfaces";
import { identifyScanSurfaces } from "./scanSurfaces";
import { alignFinishedScan } from "./scanCoordinates";
import { serializePartialScan, parsePartialScan } from "./partialScanFile";
import { prepareScanFloor } from "./scanFloorPreparation";

function fixture() {
  const positions=[],normals=[],colors=[],uvs=[],indices=[];
  for(let z=0;z<30;z++)for(let x=0;x<30;x++) {
    if(x>=12 && x<16 && z>=12 && z<16)continue;
    const i=positions.length/3;
    for(const [dx,dz]of [[0,0],[0,1],[1,1],[1,0]]) {
      positions.push((x+dx)*.04,-.25,(z+dz)*.04);normals.push(0,1,0);colors.push(255,255,255);uvs.push(.5,.5);
    }
    indices.push(i,i+1,i+2,i,i+2,i+3);
  }
  const mesh={positions:new Float32Array(positions),normals:new Float32Array(normals),colors:new Uint8Array(colors),
    uvs:new Float32Array(uvs),indices:new Uint32Array(indices),texture:{width:1,height:1,data:new Uint8Array([200,190,170,255])},
    floorY:-.25,bounds:{min:{x:0,y:-.25,z:0},max:{x:1.2,y:-.25,z:1.2}}};
  const floor={kind:'floor',normal:[0,1,0],offset:-.25,axes:[[1,0,0],[0,0,-1]],cellSize:.12,cells:new Map()};
  for(let x=0;x<10;x++)for(let z=-10;z<0;z++)floor.cells.set(`${x},${z}`,new Set([1,2,3]));
  const helpers={projectColor:(f,x,y,z)=>({u:x/1.2,v:z/1.2,depth:1.5}),sampleColor:()=>[200,190,170],photoVisible:()=>true,
    textureFrames:[{colorWidth:512,colorHeight:512,atlasUVTransform:[0,0,1,1],
      viewTransformMatrix:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,.6,1,.6,1])}]};
  return {mesh,floor,helpers};
}

test('native floor support closes a meshing hole without changing the capture and round-trips finish ownership',()=>{
  const {mesh,floor,helpers}=fixture(),original=mesh.positions.slice();
  mesh.designSurfaces=buildScanDesignSurfaces(mesh,[floor],[],helpers);
  const design=mesh.designSurfaces;
  expect(design.floor.area).toBeGreaterThan(1.25);
  expect(validScanDesignSurfaces(design,mesh)).toBe(true);
  expect(mesh.positions).toEqual(original);
  const f=design.fragments;
  const centers=[];
  for(let face=0;face<f.indices.length/3;face++)if(f.finishLabels[face]===2) {
    const ps=[0,1,2].map(c=>f.positions.subarray(f.indices[face*3+c]*3,f.indices[face*3+c]*3+3));
    expect(ps.every(p=>Math.abs(p[1]+.25)<1e-6)).toBe(true);
    centers.push(ps[0].map((_,i)=>ps.reduce((s,p)=>s+p[i]/3,0)));
  }
  expect(centers.some(p=>p[0]>.48 && p[0]<.64 && p[2]>.48 && p[2]<.64)).toBe(true);
  const aligned=alignFinishedScan(mesh,{},-.25).mesh;
  const restored=parsePartialScan(serializePartialScan({mesh:aligned})).mesh;
  expect(restored.designSurfaces.fragments.finishLabels).toEqual(f.finishLabels);
  expect(restored.designSurfaces.floor.offset).toBe(0);
  expect(validScanDesignSurfaces(restored.designSurfaces,restored)).toBe(true);
  const surfaces=identifyScanSurfaces({mesh:restored});
  expect(surfaces.labels.some(x=>x===2)).toBe(false);
  expect(surfaces.counts.floor).toBe(design.floor.triangleCount);
  const corner=restored.designSurfaces.fragments.indices[0]*3+1;
  restored.designSurfaces.fragments.positions[corner]+=.1;
  expect(validScanDesignSurfaces(restored.designSurfaces,restored)).toBe(false);
});

test('a curtain fragment cannot inherit flooring even when its source face was a floor',()=>{
  const {mesh,floor,helpers}=fixture();
  const fragments={positions:[.4,-.23,.4,.6,-.23,.4,.6,.7,.4],normals:[0,0,1,0,0,1,0,0,1],
    colors:Array(9).fill(255),uvs:Array(6).fill(.5),indices:[0,1,2],sourceFaces:[0],estimatedTriangleMask:[1],finishLabels:[2]};
  const prepared=prepareScanFloor(mesh,[floor],helpers,fragments,new Uint8Array(mesh.indices.length/3));
  expect(prepared).not.toBeNull();
  expect(fragments.positions.slice(0,9)).toEqual([.4,-.23,.4,.6,-.23,.4,.6,.7,.4]);
  expect(fragments.finishLabels[0]).toBe(0);
  expect(fragments.finishLabels.slice(1).every(x=>x===2)).toBe(true);
});

test('occluded photographs cannot invent a textured floor or erase the capture',()=>{
  const {mesh,floor,helpers}=fixture(),removed=new Uint8Array(mesh.indices.length/3);
  const fragments={positions:[],normals:[],colors:[],uvs:[],indices:[],sourceFaces:[],estimatedTriangleMask:[],finishLabels:[]};
  expect(prepareScanFloor(mesh,[floor],{...helpers,photoVisible:()=>false},fragments,removed)).toBeNull();
  expect(removed.some(Boolean)).toBe(false);
  expect(fragments.indices).toHaveLength(0);
});

test('independent rays through a floor opening veto enclosed gap filling',()=>{
  const {mesh,floor,helpers}=fixture();floor.cells.delete('4,-5');
  helpers.project=(f,x,y,z)=>({u:x/1.2,v:z/1.2,depth:1});
  helpers.nativeFrames=[1,2,3].map(frameId=>{
    const depth=new Float32Array(100).fill(1);depth[44]=1.6;
    return {frameId,camera:[frameId*.12,1,.6],columns:10,rows:10,filteredDepth:depth,
      measuredMask:new Uint8Array(100).fill(1),freeSpaceMask:new Uint8Array(100).fill(1)};
  });
  const fragments={positions:[],normals:[],colors:[],uvs:[],indices:[],sourceFaces:[],estimatedTriangleMask:[],finishLabels:[]};
  const result=prepareScanFloor(mesh,[floor],helpers,fragments,new Uint8Array(mesh.indices.length/3));
  expect(result.gapCells).toBe(0);
  for(let face=0;face<fragments.indices.length/3;face++) {
    const ps=[0,1,2].map(c=>fragments.positions.slice(fragments.indices[face*3+c]*3,fragments.indices[face*3+c]*3+3));
    const p=ps[0].map((_,i)=>ps.reduce((s,q)=>s+q[i]/3,0));
    expect(p[0]>.48 && p[0]<.6 && p[2]>.48 && p[2]<.6).toBe(false);
  }
});
