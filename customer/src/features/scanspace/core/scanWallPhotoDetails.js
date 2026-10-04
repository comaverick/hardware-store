import { linearScanBytes, scanLuminance } from "./scanSurfaceLighting";
import { classifyFoldedPhotoPanels } from "./scanPhotoPanels";

const key = (x, y) => `${x},${y}`;
const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const linear = rgb => rgb.map(value => linearScanBytes[Math.max(0, Math.min(255, Math.round(value)))]);

// Glare and pale flowers can split a picture's contrast into several islands.
// Propose a rectangle from observed horizontal runs, then require contrast on
// all four sides and real color/texture anchors inside it. A shadow or an L-shaped
// object cannot supply those boundaries. Do not grow through curtain pleats.
function framedPhotoRegions(cells, contrasted, detail, cellSize) {
  const rows = new Map(), protectedCells = new Set();
  for (const p of contrasted.values()) if (!p.foldedPanel) {
    if (!rows.has(p.y)) rows.set(p.y, []);
    rows.get(p.y).push(p.x);
  }
  const contrastedAt = (x,y) => contrasted.has(key(x,y)) && !cells.get(key(x,y))?.foldedPanel;
  for (const [y, xs] of rows) {
    xs.sort((a,b) => a-b);
    const runs = [];
    for (const x of xs) {
      if (!runs.length || x-runs[runs.length-1].at(-1)>3) runs.push([]);
      runs[runs.length-1].push(x);
    }
    for (const run of runs) {
      const low=run[0], high=run.at(-1), width=high-low+1;
      if (width*cellSize<.24 || run.length/width<.75 || protectedCells.has(key(low,y))) continue;
      const density = row => {
        let count=0; for(let x=low;x<=high;x++) count+=contrastedAt(x,row);
        return count/width;
      };
      let bottom=y, top=y;
      while(density(bottom-1)>=.35 && (top-bottom+2)*cellSize<=3) bottom--;
      while(density(top+1)>=.35 && (top-bottom+2)*cellSize<=3) top++;
      const height=top-bottom+1, size=width*height;
      if(height*cellSize<.24 || size>cells.size*.55 || Math.max(width/height,height/width)>3) continue;
      let covered=0, anchors=0, left=0, right=0;
      const anchorSides=[0,0,0,0];
      for(let row=bottom;row<=top;row++) for(let x=low;x<=high;x++) {
        covered+=contrastedAt(x,row); anchors+=detail.has(key(x,row));
        if(x===low) left+=contrastedAt(x,row);
        if(x===high) right+=contrastedAt(x,row);
        if(detail.has(key(x,row))) {
          if(row===bottom) anchorSides[0]++;
          if(row===top) anchorSides[1]++;
          if(x===low) anchorSides[2]++;
          if(x===high) anchorSides[3]++;
        }
      }
      if(covered/size<.65 || anchors<Math.max(6,size*.1) || left/height<.5 || right/height<.5 ||
          density(bottom)<.5 || density(top)<.5 ||
          anchorSides.filter((n,i)=>n/(i<2?width:height)>=.15).length<3) continue;
      for(let row=bottom;row<=top;row++) for(let x=low;x<=high;x++) {
        const k=key(x,row),p=cells.get(k);
        if(p && !p.foldedPanel) {p.detail=true;p.framedPicture=true;detail.set(k,p);protectedCells.add(k);}
      }
    }
  }
}

// Compare reflectance color after allowing for a change in illumination. An
// otherwise matching wall must remain editable even in a deep, sharp shadow.
function differentReflectance(rgb, background) {
  const color = linear(rgb), base = linear(background);
  const light = scanLuminance(color), reference = scanLuminance(base);
  if (light < .004 || reference < .004) return false;
  const chroma = Math.hypot(...color.map((value, i) => value / light - base[i] / reference));
  return chroma > .45 && Math.hypot(...rgb.map((value, i) => value - background[i])) > 45;
}

// Repeated internal contrast can protect monochrome artwork too. A smooth
// gradient or a single hard shadow edge has no repeated brightness reversals.
export function wallPhotoTextureDetail(samples) {
  if (samples?.length !== 9 || samples.some(rgb => !rgb)) return false;
  const values = samples.map(rgb => scanLuminance(linear(rgb)));
  const range = Math.max(...values) - Math.min(...values);
  if (range < .08) return false;
  let reversals = 0;
  for (const [a, b, c] of [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8]]) {
    const first = values[b] - values[a], second = values[c] - values[b];
    if (first * second < 0 && Math.min(Math.abs(first), Math.abs(second)) > .04) reversals++;
  }
  return reversals >= 3;
}

export function classifyWallPhotoDetails(cells, cellSize) {
  classifyFoldedPhotoPanels(cells, cellSize);
  const palette = new Map();
  const hasBackgroundSamples = [...cells.values()].some(p => p.rgb && !p.foreground && !p.foldedPanel);
  for (const p of cells.values()) {
    p.detail = false;
    p.framedPicture = false;
    // Consistent shallow depth bias can mark every cell foreground. Its wall
    // color still supplies the reference; actual relief stays protected below.
    if (!p.rgb || p.foldedPanel || (p.foreground && hasBackgroundSamples)) continue;
    const bin = p.rgb.map(value => Math.round(value / 32)).join(",");
    if (!palette.has(bin)) palette.set(bin, { sum: [0, 0, 0], weight: 0 });
    const entry = palette.get(bin), weight = p.area || 1;
    entry.weight += weight;
    p.rgb.forEach((value, i) => { entry.sum[i] += value * weight; });
  }
  const dominant = [...palette.values()].sort((a, b) => b.weight - a.weight)[0];
  const background = dominant ? dominant.sum.map(value => value / dominant.weight) : [210, 210, 200];
  const detail = new Map();
  for (const [k, p] of cells) if (p.rgb && (differentReflectance(p.rgb, background) ||
      p.textureDetail || (!p.photoFrame && p.foreground && p.foregroundOffset >= .1))) {
    p.detail = true;
    detail.set(k, p);
  }

  // A framed picture can have a neutral/dark background that resembles a
  // shadow. Its colored or textured detail anchors the object; a dense,
  // bounded rectangle with four observed sides groups the whole photograph.
  // Brightness alone cannot anchor one, and ragged shelving does not qualify.
  const contrasted = new Map([...cells].filter(([k, p]) => p.rgb && (detail.has(k) ||
    Math.hypot(...p.rgb.map((value, i) => value - background[i])) > 105)));
  const candidates = new Set(contrasted.keys());
  while (candidates.size) {
    const region = [candidates.values().next().value];
    candidates.delete(region[0]);
    for (let i = 0; i < region.length; i++) {
      const p = contrasted.get(region[i]);
      for (const [dx, dy] of neighbors) {
        const next = key(p.x + dx, p.y + dy);
        if (candidates.delete(next)) region.push(next);
      }
    }
    const points = region.map(k => contrasted.get(k)), keys = new Set(region);
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const width = maxX - minX + 1, height = maxY - minY + 1;
    if (width * cellSize < .12 || height * cellSize < .12 || width * height > cells.size * .55 ||
        region.length / (width * height) < .72 || region.filter(k => detail.has(k)).length < Math.max(3, region.length * .12)) continue;
    const sides = [0, 0, 0, 0];
    for (let x = minX; x <= maxX; x++) {
      sides[0] += keys.has(key(x, minY)); sides[1] += keys.has(key(x, maxY));
    }
    for (let y = minY; y <= maxY; y++) {
      sides[2] += keys.has(key(minX, y)); sides[3] += keys.has(key(maxX, y));
    }
    if (sides.some((count, i) => count / (i < 2 ? width : height) < .65)) continue;
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const k = key(x, y), p = cells.get(k);
      if (p) { p.detail = true; p.framedPicture = true; detail.set(k, p); }
    }
  }

  framedPhotoRegions(cells, contrasted, detail, cellSize);

  const remaining = new Set(detail.keys());
  while (remaining.size) {
    const pending = [remaining.values().next().value], region = new Set(pending);
    remaining.delete(pending[0]);
    for (let i = 0; i < pending.length; i++) {
      const p = detail.get(pending[i]);
      for (const [dx, dy] of neighbors) {
        const next = key(p.x + dx, p.y + dy);
        if (remaining.delete(next)) { pending.push(next); region.add(next); }
      }
    }
    const points = pending.map(k => detail.get(k));
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const width = maxX - minX + 1, height = maxY - minY + 1;
    if (width * cellSize < .12 || height * cellSize < .12 ||
        region.size / (width * height) < .28 || width * height > cells.size * .55) continue;

    // Protect highlights enclosed by a picture's observed detail, following
    // its contour. A bounding rectangle also swallowed wall beside shelving
    // and the shadows around objects, leaving large unpainted blocks.
    const outside = new Set(), flood = [];
    const visit = (x, y) => {
      const k = key(x, y);
      if (x < minX || x > maxX || y < minY || y > maxY || region.has(k) || outside.has(k)) return;
      outside.add(k); flood.push([x, y]);
    };
    for (let x = minX; x <= maxX; x++) { visit(x, minY); visit(x, maxY); }
    for (let y = minY; y <= maxY; y++) { visit(minX, y); visit(maxX, y); }
    for (let i = 0; i < flood.length; i++)
      for (const [dx, dy] of neighbors) visit(flood[i][0] + dx, flood[i][1] + dy);
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++)
      if (!outside.has(key(x, y)) && cells.has(key(x, y))) cells.get(key(x, y)).detail = true;
  }
  for (const p of cells.values()) if (p.foldedPanel) p.detail = true;
  return background;
}
