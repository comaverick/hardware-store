const CELL = .12;
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const key = p => p.join(',');

// RGB snapshots have their own pose; their borrowed depth map cannot test
// visibility from that pose. Intersect the finished capture instead. A tolerance
// at the endpoint permits depth noise without looking through a nearer object.
export function createScanPhotoVisibility(mesh) {
  const cells = new Map(), triangles = [];
  for (let face = 0; face < mesh.indices.length / 3; face++) {
    const p = [0,1,2].map(c => Array.from(mesh.positions.subarray(mesh.indices[face*3+c]*3, mesh.indices[face*3+c]*3+3)));
    const a = p[1].map((v,i)=>v-p[0][i]), b = p[2].map((v,i)=>v-p[0][i]);
    if (Math.hypot(...cross(a,b)) < 1e-9) continue;
    const min = [0,1,2].map(i=>Math.floor(Math.min(...p.map(q=>q[i]))/CELL));
    const max = [0,1,2].map(i=>Math.floor(Math.max(...p.map(q=>q[i]))/CELL));
    // Fusion already limits triangle edge lengths. Bound pathological imports.
    if (max.reduce((v,x,i)=>v*(x-min[i]+1),1)>4096) continue;
    const id = triangles.length;
    triangles.push({p:p[0], a, b});
    for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)for(let z=min[2];z<=max[2];z++) {
      const k=key([x,y,z]); if(!cells.has(k))cells.set(k,[]); cells.get(k).push(id);
    }
  }
  return (frame, point, tolerance = .08) => {
    const matrix=frame.viewTransformMatrix || frame.transformMatrix;
    if(matrix?.length!==16)return true;
    const origin=Array.from(matrix.slice(12,15)), ray=point.map((v,i)=>v-origin[i]);
    const length=Math.hypot(...ray), limit=length-tolerance;
    if(limit<=0)return true;
    const direction=ray.map(v=>v/length), cell=origin.map(v=>Math.floor(v/CELL));
    const step=direction.map(v=>Math.sign(v));
    const delta=direction.map(v=>v ? CELL/Math.abs(v) : Infinity);
    const next=direction.map((v,i)=>v ? ((cell[i]+(v>0?1:0))*CELL-origin[i])/v : Infinity);
    const visited=new Set();
    for(let entry=0;entry<limit;) {
      for(const id of cells.get(key(cell)) || []) {
        if(visited.has(id))continue; visited.add(id);
        const t=triangles[id], h=cross(direction,t.b), determinant=dot(t.a,h);
        if(Math.abs(determinant)<1e-9)continue;
        const inv=1/determinant, s=origin.map((v,i)=>v-t.p[i]), u=inv*dot(s,h);
        if(u<-.00001 || u>1.00001)continue;
        const q=cross(s,t.a), v=inv*dot(direction,q);
        if(v<-.00001 || u+v>1.00001)continue;
        const distance=inv*dot(t.b,q);
        if(distance>.02 && distance<limit)return false;
      }
      const axis=next[0]<next[1] ? (next[0]<next[2]?0:2) : (next[1]<next[2]?1:2);
      entry=next[axis]; cell[axis]+=step[axis]; next[axis]+=delta[axis];
    }
    return true;
  };
}
