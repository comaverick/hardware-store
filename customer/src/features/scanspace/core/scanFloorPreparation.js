import { independentFrameIds } from "./structuralDepth";

const CELL = .04, MAX_CELLS = 24000;
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const key = (x,y) => `${x},${y}`;
const inView = uv => uv && Math.min(uv.u,uv.v)>=.01 && Math.max(uv.u,uv.v)<=.99;
const neighbors = [[-1,0],[1,0],[0,-1],[0,1]];

const mean=rgb=>rgb.reduce((sum,v)=>sum+v,0)/3;
function wallPixel(w,point) {
  if(!w.texture?.data || !w.extent || !w.footprint)return null;
  const q=w.axes.map(a=>dot(a,point)/w.cellSize),[min,max]=w.extent;
  const gx=Math.floor(q[0])-min[0],gy=Math.floor(q[1])-min[1],gw=max[0]-min[0];
  if(gx<0 || gy<0 || gx>=gw || gy>=max[1]-min[1] || !w.footprint[gy*gw+gx])return null;
  const x=Math.floor((q[0]-min[0])/gw*w.texture.width),y=Math.floor((q[1]-min[1])/(max[1]-min[1])*w.texture.height);
  return Array.from(w.texture.data.subarray((y*w.texture.width+x)*4,(y*w.texture.width+x)*4+3));
}

// The floor fit can cross a photographed skirting cap. Close the geometry but
// preserve its captured material: a finish may change only the actual flooring.
// Nearby shadows alone cannot protect it; require the same trim in the wall photo
// and a contrasting plaster sample above that strip.
export function photographedWallTrim(point,rgb,walls) {
  if(!rgb)return false;
  return walls.some(w=>{
    const distance=dot(w.normal,point)-w.offset;
    if(distance<-.015 || distance>.08)return false;
    const above=wallPixel(w,[point[0],point[1]+.25,point[2]]);
    if(!above || mean(above)<mean(rgb)*1.5)return false;
    const matches=[-.02,-.01,0,.01,.02].map(dy=>wallPixel(w,[point[0],point[1]+dy,point[2]]))
      .filter(c=>c && Math.hypot(...c.map((v,i)=>v-rgb[i]))<55);
    return matches.length>=2;
  });
}

// One editable floor owns the native-supported footprint. Object fragments keep
// their photographs even when a bent hem lies close to the measured floor.
// This optional display sheet never changes measured geometry or coverage.
export function prepareScanFloor(mesh, planes, helpers, fragments, removed, walls = []) {
  const floor=(planes || []).find(p=>p.kind==='floor' && p.normal?.[1]>.9 && p.cells instanceof Map && p.axes?.length===2);
  const photos=(helpers.textureFrames || []).filter(f=>f.atlasUVTransform?.length===4);
  if(!floor || !helpers.projectColor || !helpers.sampleColor || !photos.length)return null;
  const world=(x,y)=>floor.normal.map((n,i)=>n*floor.offset+floor.axes[0][i]*x*CELL+floor.axes[1][i]*y*CELL);
  const cells=new Map(), votes=new Map();
  for(const [k, ids] of floor.cells) {
    if(ids.size<2)continue;
    const [x,y]=k.split(',').map(Number), scale=floor.cellSize/CELL;
    for(let u=Math.floor(x*scale);u<Math.round((x+1)*scale);u++)for(let v=Math.floor(y*scale);v<Math.round((y+1)*scale);v++) {
      const center=world(u+.5,v+.5);
      if(walls.some(w=>dot(w.normal,center)-w.offset<-.01))continue;
      cells.set(key(u,v),{x:u,y:v});
    }
  }
  if(cells.size<100 || cells.size>MAX_CELLS)return null;
  const min=[0,1].map(i=>Math.min(...[...cells.values()].map(p=>i?p.y:p.x))-1);
  const max=[0,1].map(i=>Math.max(...[...cells.values()].map(p=>i?p.y:p.x))+1);
  if((max[0]-min[0]+1)*(max[1]-min[1]+1)>MAX_CELLS)return null;
  // Close small enclosed cracks in the native footprint; never bridge its rim.
  const gaps=new Set();
  for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)if(!cells.has(key(x,y)))gaps.add(key(x,y));
  let gapCells=0;
  while(gaps.size) {
    const region=[gaps.values().next().value]; gaps.delete(region[0]);let enclosed=true;
    for(let i=0;i<region.length;i++) {
      const [x,y]=region[i].split(',').map(Number);
      if(x===min[0]||x===max[0]||y===min[1]||y===max[1])enclosed=false;
      for(const [dx,dy]of neighbors)if(gaps.delete(key(x+dx,y+dy)))region.push(key(x+dx,y+dy));
    }
    if(!enclosed || region.length*CELL*CELL>.16)continue;
    const native=helpers.nativeFrames || [], byId=new Map(native.map(f=>[f.frameId,f]));
    const repairs=[];
    for(const k of region) {
      const [x,y]=k.split(',').map(Number),p=world(x+.5,y+.5),through=[];
      for(const f of native) {
        const uv=helpers.project?.(f,...p);if(!inView(uv))continue;
        const i=Math.floor(uv.v*f.rows)*f.columns+Math.floor(uv.u*f.columns),d=(f.originalFilteredDepth || f.filteredDepth)?.[i];
        if(f.measuredMask?.[i] && f.freeSpaceMask?.[i] && (f.depthConfidence?.[i] ?? 255)>=140 && d-uv.depth>.2)through.push(f.frameId);
      }
      if(independentFrameIds(through,byId,.06).size>=2)break;
      repairs.push({x,y,gap:true});
    }
    if(repairs.length===region.length)for(const p of repairs){cells.set(key(p.x,p.y),p);gapCells++;}
  }
  for(const [k,c]of cells) {
    const points=[[c.x,c.y],[c.x+1,c.y],[c.x+1,c.y+1],[c.x,c.y+1]].map(q=>world(...q));
    const center=world(c.x+.5,c.y+.5), choices=[];
    for(const frame of photos) {
      const projections=points.map(p=>helpers.projectColor(frame,...p));
      if(projections.some(uv=>!inView(uv)))continue;
      // Native floor ownership supplies geometry. Check this photo's actual
      // pose for foreground occlusion instead of using a different depth pose.
      if(helpers.photoVisible && !helpers.photoVisible(frame,center,.12))continue;
      const rgb=helpers.sampleColor(frame,helpers.projectColor(frame,...center));
      if(!rgb || Math.max(...rgb)<18)continue;
      const transform=frame.viewTransformMatrix || frame.transformMatrix;
      if(transform?.length!==16)continue;
      const ray=center.map((v,i)=>transform[i+12]-v),distance=Math.hypot(...ray),angle=dot(ray,floor.normal)/distance;
      if(angle<.25)continue;
      const score=angle*Math.sqrt(frame.colorWidth*frame.colorHeight)/distance;
      choices.push({frame,projections,score,rgb}); votes.set(frame,(votes.get(frame)||0)+score);
    }
    if(!choices.length){cells.delete(k);continue;}
    c.points=points;c.choices=choices;
  }
  if(cells.size*CELL*CELL<.35)return null;
  const preferred=[...votes].sort((a,b)=>b[1]-a[1]).map(([f])=>f);
  // Remove only close, horizontal capture sheets actually covered by the floor.
  const owns=(source,face)=>{
    const ps=[0,1,2].map(c=>Array.from(source.positions.slice(source.indices[face*3+c]*3,source.indices[face*3+c]*3+3)));
    if(ps.some(p=>Math.abs(dot(floor.normal,p)-floor.offset)>.055))return false;
    const a=ps[1].map((v,i)=>v-ps[0][i]),b=ps[2].map((v,i)=>v-ps[0][i]);
    const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    if(Math.abs(dot(n,floor.normal))/(Math.hypot(...n)||1)<.9)return false;
    return ps.every(p=>cells.has(key(Math.floor(dot(floor.axes[0],p)/CELL),Math.floor(dot(floor.axes[1],p)/CELL))));
  };
  let sourceFace=0;
  for(let face=0;face<removed.length;face++)if(owns(mesh,face)){removed[face]=1;sourceFace=face;}
  // Keep fragment attributes together while removing the competing floor sheet.
  const retained={positions:[],normals:[],colors:[],uvs:[],indices:[],sourceFaces:[],estimatedTriangleMask:[],finishLabels:[]};
  for(let face=0;face<fragments.indices.length/3;face++) {
    if(fragments.finishLabels[face]===2 && owns(fragments,face))continue;
    for(let c=0;c<3;c++) {
      const id=fragments.indices[face*3+c]; retained.indices.push(retained.positions.length/3);
      for(const [name,size]of [['positions',3],['normals',3],['colors',3],['uvs',2]])retained[name].push(...fragments[name].slice(id*size,id*size+size));
    }
    retained.sourceFaces.push(fragments.sourceFaces[face]);retained.estimatedTriangleMask.push(fragments.estimatedTriangleMask[face]);retained.finishLabels.push(0);
  }
  Object.assign(fragments,retained);
  const firstFace=fragments.indices.length/3;
  let preservedTrimCells=0;
  for(const c of cells.values()) {
    const best=Math.max(...c.choices.map(q=>q.score));
    const choice=preferred.map(f=>c.choices.find(q=>q.frame===f && q.score>=best*.5)).find(Boolean);
    const t=choice.frame.atlasUVTransform;
    const center=world(c.x+.5,c.y+.5);
    const trim=photographedWallTrim(center,choice.rgb,walls) || c.points.some(corner=>{
      const point=corner.map((v,i)=>v*.8+center[i]*.2);
      if(!walls.some(w=>Math.abs(dot(w.normal,point)-w.offset)<=.08))return false;
      return photographedWallTrim(point,helpers.sampleColor(choice.frame,helpers.projectColor(choice.frame,...point)),walls);
    });
    if(trim)preservedTrimCells++;
    const start=fragments.positions.length/3;
    for(let i=0;i<4;i++) {
      fragments.positions.push(...c.points[i]);fragments.normals.push(...floor.normal);fragments.colors.push(255,255,255);
      fragments.uvs.push(t[0]+choice.projections[i].u*t[2],t[1]+(1-choice.projections[i].v)*t[3]);
    }
    const a=floor.axes[0],b=floor.axes[1],sign=dot([a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],floor.normal);
    fragments.indices.push(...(sign>0?[0,1,2,0,2,3]:[0,2,1,0,3,2]).map(i=>start+i));
    fragments.sourceFaces.push(sourceFace,sourceFace);fragments.estimatedTriangleMask.push(1,1);fragments.finishLabels.push(trim?0:2,trim?0:2);
  }
  return {normal:floor.normal,offset:floor.offset,axes:floor.axes,area:(cells.size-preservedTrimCells)*CELL*CELL,
    estimatedArea:(cells.size-preservedTrimCells)*CELL*CELL,triangleCount:(cells.size-preservedTrimCells)*2,
    preservedTrimTriangles:preservedTrimCells*2,firstFace,gapCells,source:'independent-depth-footprint'};
}
