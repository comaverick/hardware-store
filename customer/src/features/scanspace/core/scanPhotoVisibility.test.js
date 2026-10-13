import { createScanPhotoVisibility } from "./scanPhotoVisibility";
import { repairCapturedCeilingPhotos } from "./scanCapturedPhotoRepair";

const camera=(p)=>({viewTransformMatrix:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,...p,1])});

test('RGB visibility uses its own pose and rejects a nearer foreground triangle',()=>{
  const mesh={positions:new Float32Array([-1,-1,1,1,-1,1,0,1,1]),indices:new Uint32Array([0,1,2])};
  const visible=createScanPhotoVisibility(mesh);
  expect(visible(camera([0,0,0]),[0,0,2])).toBe(false);
  expect(visible(camera([0,0,0]),[0,0,1.03])).toBe(true);
  expect(visible(camera([2,0,0]),[2,0,2])).toBe(true);
  expect(visible(camera([0,0,2]),[0,0,1])).toBe(true);
});

test('ceiling gutter placeholders receive sharp camera UVs only when photographed and visible',()=>{
  const mesh={positions:new Float32Array([0,2.6,0,.2,2.6,0,0,2.6,.2]),indices:new Uint32Array([0,1,2]),
    normals:new Float32Array([0,-1,0,0,-1,0,0,-1,0]),colors:new Uint8Array(9).fill(50),uvs:new Float32Array(6).fill(.001),floorY:0};
  const photos=[{...camera([.1,1,.1]),colorWidth:512,colorHeight:512,atlasUVTransform:[.1,.2,.4,.6]}];
  const helpers={textureFrames:photos,projectColor:(f,x,y,z)=>({u:.3+x,v:.3+z}),photoVisible:()=>true};
  const fresh=()=>({positions:[],normals:[],colors:[],uvs:[],indices:[],sourceFaces:[],estimatedTriangleMask:[],finishLabels:[]});
  let fragments=fresh(),removed=new Uint8Array(1);
  expect(repairCapturedCeilingPhotos(mesh,helpers,fragments,removed).repairedCeilingPhotoTriangles).toBe(1);
  expect(removed[0]).toBe(1);expect(fragments.colors.every(x=>x===255)).toBe(true);
  expect(new Set(fragments.uvs).size).toBeGreaterThan(2);
  expect(mesh.colors.every(x=>x===50)).toBe(true);expect(mesh.uvs.every(x=>x<.002)).toBe(true);
  fragments=fresh();removed=new Uint8Array(1);
  expect(repairCapturedCeilingPhotos(mesh,{...helpers,photoVisible:()=>false},fragments,removed).repairedCeilingPhotoTriangles).toBe(0);
  expect(removed[0]).toBe(0);
});
