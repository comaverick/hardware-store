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
}
