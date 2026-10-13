import { cleanPreparedWallPlaceholders } from "./scanWallPlaceholderCleanup";

function fixture({photo=false,depth=.04,height=.5,footprint=2,detail=0,opening=0}={}) {
  const source={positions:new Float32Array([.4,height,depth,.44,height,depth,.4,height+.04,depth]),
    indices:new Uint32Array([0,1,2]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),
    uvs:new Float32Array(photo?[.2,.2,.3,.2,.2,.3]:Array(6).fill(.001)),colors:new Uint8Array(Array(9).fill(115))};
  const wall={normal:[0,0,1],offset:0,axes:[[1,0,0],[0,1,0]],cellSize:.04,extent:[[0,0],[25,60]],
    footprint:new Uint8Array(25*60).fill(footprint),openingMask:new Uint8Array(25*60).fill(opening),
    texture:{width:25,height:60},detailMask:new Uint8Array(25*60).fill(detail)};
  const design={walls:[wall],floor:{normal:[0,1,0],offset:0},ceilings:[{offset:-2.4}],
    removedSourceFaces:new Uint8Array(1),fragments:{...source,sourceFaces:new Uint32Array([0]),
      estimatedTriangleMask:new Uint8Array([1]),finishLabels:new Uint8Array([0])}};
  return {mesh:source,design};
}

test('small untextured wall shards yield to the observed wall without changing captured vertices',()=>{
  const {mesh,design}=fixture(),original=mesh.positions.slice();
  expect(cleanPreparedWallPlaceholders(mesh,design)).toEqual({removedWallPlaceholders:1,removedWallPlaceholderFragments:1});
  expect(design.removedSourceFaces[0]).toBe(1);
  expect(design.fragments.indices).toHaveLength(0);
  expect(mesh.positions).toEqual(original);
});

test('a small repaired wall gap backed by nearby observations also replaces its untextured shards',()=>{
  const {mesh,design}=fixture(),wall=design.walls[0];
  for(let y=11;y<=16;y++)for(let x=8;x<=13;x++)wall.footprint[y*25+x]=1;
  expect(cleanPreparedWallPlaceholders(mesh,design).removedWallPlaceholderFragments).toBe(1);
});

test.each([
  {photo:true},{depth:.25},{height:.05},{height:2.3},{footprint:0},{footprint:1},{detail:255},{opening:1},
])('photos, foreground objects, trim, ceilings and unsupported wall regions remain captured (%j)',options=>{
  const {mesh,design}=fixture(options);
  expect(cleanPreparedWallPlaceholders(mesh,design)).toEqual({removedWallPlaceholders:0,removedWallPlaceholderFragments:0});
  expect(design.removedSourceFaces[0]).toBe(0);
  expect(design.fragments.indices).toHaveLength(3);
});
