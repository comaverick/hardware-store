import { independentFrameIds } from "./structuralDepth";

const dot = (a,b) => a.reduce((sum,v,i) => sum+v*b[i],0);
const median = values => values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)] || 0;

// A floor fit alone cannot own a curled layer or a furniture face. Require
// original horizontal depth samples from translated cameras at the proposed
// point and an observed photograph. Stable alternate heights stay separate.
export function floorSurfaceOwnership(plane, frames, helpers) {
  if (plane.kind !== "floor" || !helpers.project || !frames.some(f => f.originalPositions?.length)) return null;
  const photos = (helpers.photoFrames || frames).filter(f => f.colorImage?.length && f.colorWidth && f.colorHeight);
  const photoPoses = new Map(photos.map(f => [f.frameId,{...f,
    camera:Array.from((f.viewTransformMatrix || f.transformMatrix)?.slice(12,15) || f.camera || [])}]));
  if (independentFrameIds(photoPoses.keys(),photoPoses,.06).size<2) return null;
  const horizontal=[1-plane.normal[0]**2,-plane.normal[0]*plane.normal[1],-plane.normal[0]*plane.normal[2]];
  const axis=horizontal.map(v=>v/Math.hypot(...horizontal));
  const axes=plane.axes || [axis,[plane.normal[1]*axis[2]-plane.normal[2]*axis[1],
    plane.normal[2]*axis[0]-plane.normal[0]*axis[2],plane.normal[0]*axis[1]-plane.normal[1]*axis[0]]];
  const frameMap = new Map(frames.map(f=>[f.frameId,f])), cache=new Map(),nativeCache=new Map(),viewSets=new Map(),photoSets=new Map();
  const independent = (ids,map,memo) => {
    const k=ids.join(","); if(!memo.has(k)) memo.set(k,independentFrameIds(ids,map,.06));
    return memo.get(k);
  };
  const nativePoint = (f,i) => {
    const a=f.originalPositions, p=a && Array.from(a.subarray(i*3,i*3+3));
    return p?.length===3 && p.every(Number.isFinite) && f.measuredMask?.[i] &&
      (f.originalFilteredDepth || f.filteredDepth)?.[i]>0 ? p : null;
  };
  function nativeEvidence(p) {
    const k=p.map(v=>Math.round(v*100000)).join(",");
    if(nativeCache.has(k)) return nativeCache.get(k);
    const samples=[];
    for(const f of frames) {
      if(f.textureOnly) continue;
      const uv=helpers.project(f,...p);
      if(!uv || Math.min(uv.u,uv.v)<0 || Math.max(uv.u,uv.v)>=1) continue;
      const x=Math.floor(uv.u*f.columns),y=Math.floor(uv.v*f.rows),i=y*f.columns+x;
      const hit=nativePoint(f,i),a=nativePoint(f,y*f.columns+Math.max(0,x-1)),b=nativePoint(f,y*f.columns+Math.min(f.columns-1,x+1)),
        c=nativePoint(f,Math.max(0,y-1)*f.columns+x),d=nativePoint(f,Math.min(f.rows-1,y+1)*f.columns+x);
      if(!hit || !a || !b || !c || !d) continue;
      const u=b.map((v,h)=>v-a[h]),v=d.map((value,h)=>value-c[h]);
      const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
      const offset=dot(plane.normal,hit)-plane.offset;
      if(length<1e-8 || Math.abs(dot(normal,plane.normal))/length<.9 || Math.abs(offset)>.1) continue;
      samples.push({id:f.frameId,offset});
    }
    const ids=independent(samples.map(s=>s.id),frameMap,viewSets);
    const offsets=samples.filter(s=>ids.has(s.id)).map(s=>s.offset),level=median(offsets);
    const result={agrees:ids.size,level,scatter:median(offsets.map(v=>Math.abs(v-level)))};
    nativeCache.set(k,result);return result;
  }
  function evidence(p) {
    const k=p.map(v=>Math.round(v*100000)).join(",");
    if(cache.has(k)) return cache.get(k);
    const native=nativeEvidence(p);
    let stableRaised=native.agrees>=3 && Math.abs(native.level)>.035 && native.scatter<.008;
    if(stableRaised) {
      // A single ray can repeat the same biased depth in several views. A
      // genuine step/platform also has a coherent horizontal neighborhood;
      // isolated stable pixels or a drifting floor fit must not punch holes.
      const neighbors=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      stableRaised=neighbors.filter(([x,y])=>{
        const q=p.map((v,i)=>v+.08*(axes[0][i]*x+axes[1][i]*y));
        const next=nativeEvidence(q);
        return next.agrees>=3 && next.scatter<.008 && Math.abs(next.level-native.level)<.008;
      }).length>=4;
    }
    const photoIds=[];
    for(const f of photos) {
      const uv=(helpers.projectColor || helpers.project)(f,...p);
      if(uv && Math.min(uv.u,uv.v)>.01 && Math.max(uv.u,uv.v)<.99) photoIds.push(f.frameId);
    }
    const result={agrees:stableRaised?0:native.agrees,photographs:independent(photoIds,photoPoses,photoSets).size};
    cache.set(k,result);return result;
  }
  // The capture has independent color poses, but a particular floor edge may
  // appear in just one image. Geometry still needs two native depth observers
  // at both positions; a second photo of that same cell adds no depth support.
  const owns=(p,target=p) => Math.abs(dot(plane.normal,p)-plane.offset)<=.12 &&
    evidence(target).agrees>=2 && evidence(target).photographs>=1 && evidence(p).agrees>=2 && evidence(p).photographs>=1;
  return {owns,evidence,flatEvidence:p=>evidence(p).agrees>=2};
}
