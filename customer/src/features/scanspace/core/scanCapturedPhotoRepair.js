const inView = uv => uv && Math.min(uv.u,uv.v)>=.01 && Math.max(uv.u,uv.v)<=.99;
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);

// Repair the white atlas gutter's vertex-color placeholders with real camera
// pixels. Check visibility from the RGB pose, including inset triangle corners.
// Work on the display copy; the original UVs and measured triangles stay intact.
export function repairCapturedCeilingPhotos(mesh, helpers, fragments, removed, clothSurfaces = []) {
  const photos=(helpers.textureFrames || []).filter(f=>f.atlasUVTransform?.length===4);
  if(!photos.length || !helpers.projectColor || !helpers.photoVisible)return {repairedCeilingPhotoTriangles:0};
  const repairs=[],votes=new Map(),floorY=Number.isFinite(mesh.floorY)?mesh.floorY:0;
  function inspect(source, face, captured) {
    const ids=[0,1,2].map(c=>source.indices[face*3+c]);
    if(!source.uvs || ids.some(i=>source.uvs[i*2]>.003 || source.uvs[i*2+1]>.003))return;
    const points=ids.map(i=>Array.from(source.positions.slice(i*3,i*3+3)));
    const cloth = points.every(p => clothSurfaces.some(s => {
      const w=s.wall, k=w.axes.map(a=>Math.floor(dot(a,p)/w.cellSize)).join(',');
      return Math.abs(dot(w.normal,p)-w.offset)<.35 && s.preserved.has(k);
    }));
    if(!cloth && points.some(p=>p[1]<floorY+2.05))return;
    const a=points[1].map((v,i)=>v-points[0][i]),b=points[2].map((v,i)=>v-points[0][i]);
    const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...n);
    if(length<1e-9)return;
    const center=points[0].map((_,i)=>points.reduce((s,p)=>s+p[i]/3,0)),choices=[];
    for(const frame of photos) {
      const projections=points.map(p=>helpers.projectColor(frame,...p));
      if(projections.some(uv=>!inView(uv)))continue;
      const transform=frame.viewTransformMatrix || frame.transformMatrix;
      if(transform?.length!==16)continue;
      const ray=center.map((v,i)=>transform[i+12]-v),distance=Math.hypot(...ray),angle=dot(ray,n)/distance/length;
      if(angle<.12)continue;
      const inset=[center,...points.map(p=>p.map((v,i)=>v*.8+center[i]*.2))];
      if(inset.some(p=>!helpers.photoVisible(frame,p,.10)))continue;
      const score=angle*Math.sqrt(frame.colorWidth*frame.colorHeight)/distance;
      choices.push({frame,projections,score});votes.set(frame,(votes.get(frame)||0)+score);
    }
    if(choices.length)repairs.push({source,face,captured,ids,points,choices,normal:n.map(v=>v/length)});
  }
  const count=fragments.indices.length/3;
  for(let face=0;face<count;face++)inspect(fragments,face,false);
  for(let face=0;face<removed.length;face++)if(!removed[face])inspect(mesh,face,true);
  const preferred=[...votes].sort((a,b)=>b[1]-a[1]).map(([f])=>f);
  for(const repair of repairs) {
    const best=Math.max(...repair.choices.map(q=>q.score));
    const choice=preferred.map(f=>repair.choices.find(q=>q.frame===f && q.score>=best*.5)).find(Boolean),t=choice.frame.atlasUVTransform;
    for(let c=0;c<3;c++) {
      const old=repair.ids[c],id=repair.captured?fragments.positions.length/3:old;
      const uv=[t[0]+choice.projections[c].u*t[2],t[1]+(1-choice.projections[c].v)*t[3]];
      if(repair.captured) {
        fragments.positions.push(...repair.points[c]);fragments.normals.push(...(mesh.normals?.slice(old*3,old*3+3) || repair.normal));
        fragments.colors.push(255,255,255);fragments.uvs.push(...uv);fragments.indices.push(id);
      }else {fragments.colors.splice(id*3,3,255,255,255);fragments.uvs.splice(id*2,2,...uv);}
    }
    if(repair.captured){removed[repair.face]=1;fragments.sourceFaces.push(repair.face);fragments.estimatedTriangleMask.push(1);fragments.finishLabels.push(0);}
  }
  return {repairedCeilingPhotoTriangles:repairs.filter(p=>p.points.every(q=>q[1]>=floorY+2.05)).length,
    repairedCurtainPhotoTriangles:repairs.filter(p=>p.points.some(q=>q[1]<floorY+2.05)).length};
}
