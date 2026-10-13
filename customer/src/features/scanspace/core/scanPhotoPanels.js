import { linearScanBytes, scanLuminance } from "./scanSurfaceLighting";

const key = (x, y) => `${x},${y}`;
const luminance = p => p?.rgb && Math.log(Math.max(.003,
  scanLuminance(Array.from(p.rgb, v => linearScanBytes[Math.max(0, Math.min(255, Math.round(v)))]))));

// Small texture samples cannot recognize broad curtain pleats: each sample
// sees only one smooth light/shadow slope. Look for several alternating folds
// that persist vertically, with non-planar measured depth. A hard wall shadow,
// a lighting gradient or stripes on a flat wall cannot supply that evidence.
export function classifyFoldedPhotoPanels(cells, cellSize) {
  if (!cells.size || !(cellSize > 0)) return;
  for (const p of cells.values()) p.foldedPanel = false;
  const points = [...cells.values()];
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const xs = [...new Set(points.map(p => p.x))].sort((a, b) => a - b);
  const height = Math.ceil(.9 / cellSize), gradients = new Map();
  if ((maxY - minY + 1) * cellSize < .9 || xs.length * cellSize < .6) return;
  for (const p of points) {
    const left = luminance(cells.get(key(p.x - 1, p.y))), right = luminance(cells.get(key(p.x + 1, p.y)));
    if (Number.isFinite(left) && Number.isFinite(right)) gradients.set(key(p.x, p.y), (right - left) / 2);
  }
  for (let y = minY; y <= maxY - height + 1; y++) {
    const columns = [];
    for (const x of xs) {
      const values = [];
      for (let dy = 0; dy < height; dy++) {
        const value = gradients.get(key(x, y + dy));
        if (Number.isFinite(value)) values.push(value);
      }
      if (values.length < height * .85) continue;
      const sign = Math.sign(values.reduce((sum, v) => sum + v, 0));
      if (values.filter(v => v * sign > .22).length >= height * .7) columns.push({ x, sign });
    }
    const groups = [];
    for (const column of columns) {
      if (!groups.length || (column.x - groups[groups.length - 1].at(-1).x) * cellSize > .32) groups.push([]);
      groups[groups.length - 1].push(column);
    }
    for (const group of groups) {
      const low = group[0].x, high = group.at(-1).x;
      if ((high - low) * cellSize < .5 || group.filter((p, i) => i && p.sign !== group[i - 1].sign).length < 4) continue;
      let measured = 0, curved = 0;
      for (let x = low; x <= high; x++) for (let dy = 0; dy < height; dy++) {
        const p = cells.get(key(x, y + dy)), a = cells.get(key(x - 2, y + dy)), b = cells.get(key(x + 2, y + dy));
        if (![p, a, b].every(v => Number.isFinite(v?.depthOffset))) continue;
        measured++;
        if (Math.abs(p.depthOffset - (a.depthOffset + b.depthOffset) / 2) > .006) curved++;
      }
      if (measured < height * 6 || curved < measured * .12) continue;
      for (let dy = 0; dy < height; dy++) {
        if (group.filter(p => (gradients.get(key(p.x, y + dy)) || 0) * p.sign > .15).length < group.length * .6) continue;
        for (let x = low - 2; x <= high + 2; x++) {
          const p = cells.get(key(x, y + dy));
          if (p) p.foldedPanel = true;
        }
      }
    }
  }
  // Pleats disappear in cropped or dark parts of a photo. Carry the recognized
  // cloth silhouette through the same native-supported columns, within the
  // robust vertical extent of its neighboring pleats. Do not grow onto the wall
  // above the curtain or across its side boundary.
  const columns = new Map();
  for (const p of points) if (p.foldedPanel) {
    if (!columns.has(p.x)) columns.set(p.x, []); columns.get(p.x).push(p.y);
  }
  if (columns.size * cellSize < .5) return;
  const lows=[...columns.values()].map(a=>Math.min(...a)).sort((a,b)=>a-b);
  const highs=[...columns.values()].map(a=>Math.max(...a)).sort((a,b)=>a-b);
  const low=lows[Math.floor(lows.length*.25)], high=highs[Math.floor(highs.length*.75)];
  for (const p of points) if (columns.has(p.x) && p.y>=low && p.y<=high &&
      (p.support === undefined || p.support>=2) && Number.isFinite(p.depthOffset) && Math.abs(p.depthOffset)<=.18) p.foldedPanel=true;
}

// A pleat detector's padded silhouette can reach the plaster beside a curtain.
// Give a smooth neutral border back to an adjoining wall only when translated
// native depth also observes that wall's orientation at the actual surface.
export function foldedPanelWallBorders(cells, cellSize, normal, pointAt, adjoiningWalls) {
  const cloth=[...cells.values()].filter(p=>p.foldedPanel);
  if(!cloth.length || !adjoiningWalls.length)return [];
  const min=Math.min(...cloth.map(p=>p.x)),max=Math.max(...cloth.map(p=>p.x)),released=[];
  const colors=new Map();
  for(const p of cloth)if(p.rgb) {if(!colors.has(p.x))colors.set(p.x,[]);colors.get(p.x).push(p.rgb);}
  for(const p of cloth) {
    const column=colors.get(p.x) || [];
    const rgb=p.rgb || (column.length>=3 ? [0,1,2].map(i=>column.map(c=>c[i]).sort((a,b)=>a-b)[Math.floor(column.length/2)]) : null);
    if(Math.min(p.x-min,max-p.x)*cellSize>.12 || !rgb || p.framedPicture ||
        rgb.reduce((sum,v)=>sum+v,0)/3<140 || Math.max(...rgb)-Math.min(...rgb)>25 ||
        !Number.isFinite(p.depthOffset))continue;
    const point=pointAt(p);
    if(adjoiningWalls.some(w=>Math.abs(w.normal.reduce((s,v,i)=>s+v*normal[i],0))<.6 &&
        Math.abs(w.normal.reduce((s,v,i)=>s+v*point[i],0)-w.offset)<.045 && w.nativeNormalSupport(point)>=(p.rgb?2:3))) {
      released.push(key(p.x,p.y));
    }
  }
  return released;
}

// A curtain at a room corner can also project into the neighboring wall's
// footprint. Share its measured fabric mask across that junction so the other
// wall cannot recolor the thin cloth edge as a flat wall detail.
export function protectFoldedPanelJunctions(surfaces) {
  let protectedPixels=0;
  const panels=surfaces.filter(s=>s.preserved?.size);
  const nearby=new Map();
  const plainWalls=new Map();
  for(const surface of surfaces) {
    const w=surface.wall,t=w.texture,mask=w.detailMask;
    for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++) {
      const i=y*t.width+x;if(mask[i])continue;
      const q=[w.extent[0][0]+(x+.5)/t.width*(w.extent[1][0]-w.extent[0][0]),
        w.extent[0][1]+(y+.5)/t.height*(w.extent[1][1]-w.extent[0][1])].map(v=>v*w.cellSize);
      const p=w.normal.map((n,a)=>n*w.offset+w.axes[0][a]*q[0]+w.axes[1][a]*q[1]);
      const ownedKey=key(Math.floor(q[0]/w.cellSize),Math.floor(q[1]/w.cellSize));
      const owned=surface.cells?.get(ownedKey),pixel=t.data?.subarray(i*4,i*4+3);
      if(owned?.photoFrame && owned.support>=3 && !owned.foreground && !owned.textureDetail &&
          !owned.framedPicture && Number.isFinite(owned.depthOffset) && Math.abs(owned.depthOffset)<.045 &&
          pixel && pixel.reduce((sum,v)=>sum+v,0)/3>140 && Math.max(...pixel)-Math.min(...pixel)<25) {
        const cacheKey=`${w.id}:${ownedKey}`;
        if(!plainWalls.has(cacheKey)) {
          const center=w.normal.map((n,a)=>n*w.offset+w.axes[0][a]*(owned.x+.5)*w.cellSize+w.axes[1][a]*(owned.y+.5)*w.cellSize);
          plainWalls.set(cacheKey,!!surface.nativeWallSupport && surface.nativeWallSupport(center)>=2);
        }
        // An independently observed plain wall wins over a neighboring cloth
        // mask's padding. Existing picture/foreground masks remain untouched.
        if(plainWalls.get(cacheKey))continue;
      }
      if(panels.some(s=>{
        if(s===surface)return false;
        const grid=s.wall.axes.map(axis=>Math.floor(axis.reduce((v,n,a)=>v+n*p[a],0)/s.wall.cellSize));
        const k=`${panels.indexOf(s)}:${grid.join(',')}`;
        if(!nearby.has(k)) {
          const samples=[];
          for(let dx=-4;dx<=4;dx++)for(let dy=-4;dy<=4;dy++)if(Math.hypot(dx,dy)*s.wall.cellSize<=.16) {
            const c=s.preserved.get(key(grid[0]+dx,grid[1]+dy));if(c)samples.push(c);
          }
          nearby.set(k,samples);
        }
        const residual=s.wall.normal.reduce((v,n,a)=>v+n*p[a],0)-s.wall.offset;
        const rgb=pixel;
        return nearby.get(k).some(cloth=>{
          if(Math.abs(residual-(cloth.depthOffset || 0))>=.18)return false;
          if(!rgb || !cloth.rgb)return !rgb;
          // Agreeing photographed cloth can protect a short meshing crack.
          // Bright flat border samples cannot expand the mask onto plaster.
          if(rgb.reduce((sum,v)=>sum+v,0)/3>160 && (cloth.depthOffset || 0)>.065)return false;
          return Math.hypot(...Array.from(rgb,(v,a)=>v-cloth.rgb[a]))<100;
        });
      })) {
        mask[i]=255;protectedPixels++;
      }
    }
  }
  return {protectedCurtainJunctionPixels:protectedPixels};
}
