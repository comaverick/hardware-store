import { compactTexturedMesh } from "./compactTexturedMesh";

const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);

function supportedBackground(wall,point) {
  if(!wall.extent || !wall.footprint || !wall.detailMask || !wall.texture)return false;
  const q=wall.axes.map(axis=>dot(axis,point)/wall.cellSize),[min,max]=wall.extent;
  const x=Math.floor(q[0])-min[0],y=Math.floor(q[1])-min[1],width=max[0]-min[0],height=max[1]-min[1];
  if(x<0 || y<0 || x>=width || y>=height || !wall.footprint[y*width+x] || wall.openingMask?.[y*width+x])return false;
  if(wall.footprint[y*width+x]!==2) {
    let observed=false;
    for(let dy=-4;dy<=4 && !observed;dy++)for(let dx=-4;dx<=4;dx++)
      if(x+dx>=0 && y+dy>=0 && x+dx<width && y+dy<height && wall.footprint[(y+dy)*width+x+dx]===2){observed=true;break;}
    if(!observed)return false;
  }
  const tx=Math.min(wall.texture.width-1,Math.floor((q[0]-min[0])/width*wall.texture.width));
  const ty=Math.min(wall.texture.height-1,Math.floor((q[1]-min[1])/height*wall.texture.height));
  return wall.detailMask[ty*wall.texture.width+tx]<128;
}

// Untextured atlas placeholders sometimes survive the wall clipping as pale
// shards. Hide only small neutral shards backed by an observed, editable wall;
// photographs, protected details, openings, floor trim and ceilings stay intact.
export function cleanPreparedWallPlaceholders(mesh,design) {
  if(!design?.walls?.length || !design.floor)return {removedWallPlaceholders:0,removedWallPlaceholderFragments:0};
  const top=design.ceilings?.length ? Math.min(...design.ceilings.map(c=>-c.offset)) : mesh.bounds?.max?.y;
  const isPlaceholder=(source,face)=>{
    const ids=[0,1,2].map(c=>source.indices[face*3+c]);
    if(!source.uvs || !source.colors || ids.some(id=>source.uvs[id*2]>.003 || source.uvs[id*2+1]>.003))return false;
    if(ids.some(id=>{
      const rgb=source.colors.slice(id*3,id*3+3);
      return Math.max(...rgb)-Math.min(...rgb)>35;
    }))return false;
    const ps=ids.map(id=>Array.from(source.positions.slice(id*3,id*3+3)));
    if(ps.some(p=>dot(design.floor.normal,p)-design.floor.offset<.18 || (Number.isFinite(top) && p[1]>top-.14)))return false;
    if(ps.some((p,i)=>Math.hypot(...p.map((v,j)=>v-ps[(i+1)%3][j]))>.22))return false;
    const center=[0,1,2].map(i=>ps.reduce((s,p)=>s+p[i]/3,0));
    return design.walls.some(w=>[...ps,center].every(p=>{
      const distance=dot(w.normal,p)-w.offset;
      return distance>=-.05 && distance<=.20 && supportedBackground(w,p);
    }));
  };
  let removedWallPlaceholders=0,removedWallPlaceholderFragments=0;
  for(let face=0;face<design.removedSourceFaces.length;face++)if(!design.removedSourceFaces[face] && isPlaceholder(mesh,face)) {
    design.removedSourceFaces[face]=1;removedWallPlaceholders++;
  }
  const f=design.fragments,indices=[],sourceFaces=[],estimatedTriangleMask=[],finishLabels=[];
  for(let face=0;face<f.indices.length/3;face++) {
    if(f.finishLabels[face]===0 && isPlaceholder(f,face)){removedWallPlaceholderFragments++;continue;}
    indices.push(...f.indices.slice(face*3,face*3+3));sourceFaces.push(f.sourceFaces[face]);
    estimatedTriangleMask.push(f.estimatedTriangleMask[face]);finishLabels.push(f.finishLabels[face]);
  }
  if(removedWallPlaceholderFragments)design.fragments=compactTexturedMesh({...f,indices:new Uint32Array(indices),
    sourceFaces:new Uint32Array(sourceFaces),estimatedTriangleMask:new Uint8Array(estimatedTriangleMask),finishLabels:new Uint8Array(finishLabels)});
  return {removedWallPlaceholders,removedWallPlaceholderFragments};
}
