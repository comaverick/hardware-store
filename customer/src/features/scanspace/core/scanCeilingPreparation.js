import { independentFrameIds } from "./structuralDepth";
const CELL = .04,
  MAX_CELLS = 24000,
  MAX_MOVEMENT = .6;
const key = (x, z) => `${x},${z}`;
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const luminance = rgb => (rgb[0] + rgb[1] + rgb[2]) / 3;
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const inView = uv => uv && Math.min(uv.u, uv.v) >= .01 && Math.max(uv.u, uv.v) <= .99;
function facePoints(mesh, face) {
  return [0, 1, 2].map(c => Array.from(mesh.positions.subarray(mesh.indices[face * 3 + c] * 3, mesh.indices[face * 3 + c] * 3 + 3)));
}
function faceArea(points) {
  const a = points[1].map((v, i) => v - points[0][i]),
    b = points[2].map((v, i) => v - points[0][i]);
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = Math.hypot(...n);
  return {
    area: length / 2,
    horizontal: Math.abs(n[1]) / (length || 1)
  };
}
function clip(points, x, z) {
  let polygon = points;
  for (const [axis, sign, boundary] of [[0, 1, x * CELL], [0, -1, -(x + 1) * CELL], [2, 1, z * CELL], [2, -1, -(z + 1) * CELL]]) {
    const next = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      const da = a[axis] * sign - boundary,
        db = b[axis] * sign - boundary;
      if (da >= -1e-9) next.push(a);
      if (da * db < -1e-18) next.push(a.map((v, k) => v + (b[k] - v) * da / (da - db)));
    }
    polygon = next;
    if (polygon.length < 3) return [];
  }
  return polygon;
}
function area2d(polygon) {
  return Math.abs(polygon.reduce((sum, a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return sum + a[0] * b[2] - b[0] * a[2];
  }, 0)) / 2;
}
function eachCell(points, visit) {
  const min = [0, 2].map(a => Math.floor(Math.min(...points.map(p => p[a])) / CELL));
  const max = [0, 2].map(a => Math.floor(Math.max(...points.map(p => p[a])) / CELL));
  if ((max[0] - min[0] + 1) * (max[1] - min[1] + 1) > MAX_CELLS) return;
  for (let x = min[0]; x <= max[0]; x++) for (let z = min[1]; z <= max[1]; z++) {
    const polygon = clip(points, x, z),
      area = area2d(polygon);
    // Float32 coordinates on a grid edge can produce a numerical sliver in
    // the next cell. It must not veto ownership of a whole ceiling triangle.
    if (area > Math.max(1e-9, CELL * CELL * .0001)) visit(x, z, area);
  }
}

// This is an optional display estimate, separate from structural depth repair.
// A bent photographed ceiling can fail rigid plane discovery while its observed
// footprint still supports a useful flat preview. Never extend it to the room
// bounds, count it as measured coverage, or modify the captured mesh and UVs.
export function prepareScanCeiling(mesh, frames, helpers, removed, walls = []) {
  if (!helpers.project || !helpers.sampleColor || frames.length < 3) return null;
  const photos = (helpers.textureFrames || frames).filter(f => f.colorImage?.length);
  if (!photos.length) return null;
  const floorY = Number.isFinite(mesh.floorY) ? mesh.floorY : 0;
  const seeds = [],
    heights = new Map();
  for (let face = 0; face < mesh.indices.length / 3; face++) {
    if (removed[face]) continue;
    const points = facePoints(mesh, face),
      shape = faceArea(points);
    const y = points.reduce((s, p) => s + p[1] / 3, 0);
    if (y < floorY + 2.15 || shape.horizontal < .75 || shape.area < 1e-9) continue;
    seeds.push({
      points,
      y,
      area: shape.area
    });
    const bin = Math.round(y / .08);
    heights.set(bin, (heights.get(bin) || 0) + shape.area);
  }
  if (!seeds.length) return null;
  const peak = [...heights].sort((a, b) => b[1] - a[1])[0][0] * .08;
  const nearby = seeds.filter(s => Math.abs(s.y - peak) < .18);
  if (nearby.reduce((s, p) => s + p.area, 0) < .35) return null;
  nearby.sort((a, b) => a.y - b.y);
  const half = nearby.reduce((s, p) => s + p.area, 0) / 2;
  let weight = 0,
    height = peak;
  for (const seed of nearby) {
    weight += seed.area;
    if (weight >= half) {
      height = seed.y;
      break;
    }
  }
  const cells = new Map(),
    candidates = [];
  for (let face = 0; face < mesh.indices.length / 3; face++) {
    if (removed[face]) continue;
    const points = facePoints(mesh, face),
      shape = faceArea(points);
    if (shape.horizontal < .18 || points.some(p => p[1] < floorY + 2.05 || Math.abs(p[1] - height) > MAX_MOVEMENT)) continue;
    candidates.push({
      face,
      points
    });
    eachCell(points, (x, z, area) => {
      const k = key(x, z),
        cell = cells.get(k) || {
          x,
          z,
          area: 0
        };
      cell.area += area;
      cells.set(k, cell);
    });
  }
  if (cells.size > MAX_CELLS) return null;
  const observedFootprint = new Set(cells.keys()),
    protectedCells = new Set();
  const byId = new Map(frames.map(f => [f.frameId, f])),
    independentCache = new Map();
  const independent = ids => {
    const k = ids.join(',');
    if (!independentCache.has(k)) independentCache.set(k, independentFrameIds(ids, byId, .06));
    return independentCache.get(k);
  };
  const diagnostics = {
    footprintCells: cells.size,
    insufficientDepthCells: 0,
    alternateLevelCells: 0,
    missingPhotoCells: 0,
    detailCells: 0,
    smallRegionCells: 0
  };
  const world = (x, z) => [x * CELL, height, z * CELL];
  const projectColor = helpers.projectColor || helpers.project;
  const frameScores = new Map(),
    paletteSamples = [];
  for (const [k, cell] of cells) {
    const p = world(cell.x + .5, cell.z + .5);
    // Do not put a ceiling outside the already prepared room sides.
    if (walls.some(w => w.normal.reduce((s, n, i) => s + n * p[i], 0) - w.offset < -.01)) {
      cells.delete(k);
      continue;
    }
    const support = [],
      through = [],
      heights = [];
    for (const f of frames) {
      if (f.textureOnly) continue;
      const uv = helpers.project(f, ...p);
      if (!inView(uv)) continue;
      const i = Math.floor(uv.v * f.rows) * f.columns + Math.floor(uv.u * f.columns);
      const d = (f.originalFilteredDepth || f.filteredDepth)?.[i];
      if (!f.measuredMask?.[i] || !(d > 0)) continue;
      if (d - uv.depth > MAX_MOVEMENT && f.freeSpaceMask?.[i] && (f.depthConfidence?.[i] ?? 255) >= 140) through.push(f.frameId);
      if (Math.abs(d - uv.depth) > MAX_MOVEMENT) continue;
      const hit = helpers.unproject?.(f, i, d);
      if (!hit || hit[1] < floorY + 2.05 || Math.abs(hit[1] - height) > MAX_MOVEMENT) continue;
      support.push(f.frameId);
      heights.push({
        id: f.frameId,
        y: hit[1]
      });
    }
    if (independent(through).size >= 2) {
      protectedCells.add(k);
      cells.delete(k);
      continue;
    }
    if (independent(support).size < 3) {
      diagnostics.insufficientDepthCells++;
      cells.delete(k);
      continue;
    }
    const offsets = heights.filter(v => independent(support).has(v.id)).map(v => v.y - height);
    const level = median(offsets),
      scatter = median(offsets.map(v => Math.abs(v - level)));
    // Independently stable alternate heights belong to beams/soffits/fixtures.
    if (Math.abs(level) > .16 && scatter < .015) {
      diagnostics.alternateLevelCells++;
      protectedCells.add(k);
      cells.delete(k);
      continue;
    }
    const choices = [];
    for (const frame of photos) {
      const uv = projectColor(frame, ...p),
        depthUV = helpers.project(frame, ...p);
      if (!inView(uv) || !inView(depthUV)) continue;
      const i = Math.floor(depthUV.v * frame.rows) * frame.columns + Math.floor(depthUV.u * frame.columns);
      const d = (frame.originalFilteredDepth || frame.filteredDepth)?.[i];
      if (!frame.measuredMask?.[i] || !(d > 0) || Math.abs(d - depthUV.depth) > MAX_MOVEMENT) continue;
      const rgb = helpers.sampleColor(frame, uv);
      if (!rgb || luminance(rgb) < 12 || Math.max(...rgb) - Math.min(...rgb) > 70) continue;
      const camera = frame.viewTransformMatrix || frame.transformMatrix;
      if (camera?.length !== 16) continue;
      const ray = p.map((v, i) => camera[i + 12] - v),
        angle = -ray[1] / Math.hypot(...ray);
      if (angle < .2) continue;
      // Prefer usable exposure locally; clipped views should not form white tiles.
      const clipped = rgb.filter(v => v >= 250).length / 3;
      const score = angle / (1 + Math.abs(d - depthUV.depth)) + (Number(frame.colorSharpness) || 0) * .005 - clipped;
      choices.push({
        frame,
        rgb,
        score
      });
    }
    choices.sort((a, b) => b.score - a.score);
    if (!choices.length) {
      diagnostics.missingPhotoCells++;
      cells.delete(k);
      continue;
    }
    cell.choices = choices;
    cell.rgb = choices[0].rgb;
    paletteSamples.push(cell.rgb);
    for (const c of choices) frameScores.set(c.frame, (frameScores.get(c.frame) || 0) + Math.max(.01, c.score));
  }
  if (cells.size * CELL * CELL < .35) return null;
  const palette = [0, 1, 2].map(i => median(paletteSamples.map(rgb => rgb[i])));
  const matches = rgb => {
    const l = luminance(rgb),
      base = luminance(palette);
    return l > base * .55 && l < base * 1.6 && distance(rgb.map(v => v / (l || 1)), palette.map(v => v / (base || 1))) < .18;
  };
  const preferred = [...frameScores].sort((a, b) => b[1] - a[1]).map(([frame]) => frame);
  for (const [k, cell] of cells) {
    const choice = preferred.map(f => cell.choices.find(c => c.frame === f && c.score >= cell.choices[0].score - .25)).find(Boolean) || cell.choices[0];
    const samples = [];
    for (const [x, z] of [[.15, .15], [.85, .15], [.5, .5], [.15, .85], [.85, .85]]) {
      const uv = projectColor(choice.frame, ...world(cell.x + x, cell.z + z));
      samples.push(inView(uv) && helpers.sampleColor(choice.frame, uv));
    }
    if (samples.some(rgb => !rgb)) {
      diagnostics.missingPhotoCells++;
      cells.delete(k);
      continue;
    }
    // A planar photograph can retain trim and fixture appearance behind the
    // captured detail. Those cells cannot authorize removal of a real fixture.
    cell.detail = samples.some(rgb => !matches(rgb)) || Math.max(...samples.map(luminance)) - Math.min(...samples.map(luminance)) > 45;
    if (cell.detail) diagnostics.detailCells++;
    cell.frame = choice.frame;
    cell.rgb = choice.rgb;
  }
  // Close small enclosed depth cracks only where the source mesh already
  // supplied a footprint and an actual photograph confirms plain ceiling.
  // Missing outer boundaries, fixture gaps and stable alternate levels stay open.
  let repairedGapCells = 0;
  const gaps = new Set([...observedFootprint].filter(k => !cells.has(k)));
  while (gaps.size) {
    const region = [gaps.values().next().value];
    gaps.delete(region[0]);
    let enclosed = true;
    for (let i = 0; i < region.length; i++) {
      const [x, z] = region[i].split(',').map(Number);
      if (protectedCells.has(region[i])) enclosed = false;
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const k = key(x + dx, z + dz);
        if (!observedFootprint.has(k)) enclosed = false;
        if (gaps.delete(k)) region.push(k);
      }
    }
    const points = region.map(k => k.split(',').map(Number));
    const span = [0, 1].map(a => (Math.max(...points.map(p => p[a])) - Math.min(...points.map(p => p[a])) + 1) * CELL);
    if (!enclosed || region.length * CELL * CELL > .05 || Math.hypot(...span) > .35) continue;
    const repairs = [];
    for (const [x, z] of points) {
      const p = world(x + .5, z + .5);
      const choice = preferred.map(frame => {
        const uv = projectColor(frame, ...p),
          rgb = inView(uv) && helpers.sampleColor(frame, uv);
        return rgb && matches(rgb) ? {
          frame,
          rgb
        } : null;
      }).find(Boolean);
      if (!choice) break;
      repairs.push({
        x,
        z,
        frame: choice.frame,
        rgb: choice.rgb,
        detail: false
      });
    }
    if (repairs.length === region.length) {
      repairs.forEach(p => cells.set(key(p.x, p.z), p));
      repairedGapCells += repairs.length;
    }
  }
  // Keep sizeable connected observed regions; do not create detached tiles.
  const remaining = new Set(cells.keys());
  while (remaining.size) {
    const region = [remaining.values().next().value];
    remaining.delete(region[0]);
    for (let i = 0; i < region.length; i++) {
      const p = cells.get(region[i]);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const k = key(p.x + dx, p.z + dz);
        if (remaining.delete(k)) region.push(k);
      }
    }
    if (region.length * CELL * CELL < .035) {
      diagnostics.smallRegionCells += region.length;
      region.forEach(k => cells.delete(k));
    }
  }
  if (cells.size * CELL * CELL < .35) return null;
  const values = [...cells.values()],
    min = [Math.min(...values.map(p => p.x)), Math.min(...values.map(p => p.z))],
    max = [Math.max(...values.map(p => p.x)) + 1, Math.max(...values.map(p => p.z)) + 1];
  const gw = max[0] - min[0],
    gh = max[1] - min[1];
  if (gw * gh > MAX_CELLS) return null;
  const width = Math.min(512, Math.ceil(gw * CELL * 128)),
    textureHeight = Math.min(512, Math.ceil(gh * CELL * 128));
  const texture = {
      width,
      height: textureHeight,
      data: new Uint8Array(width * textureHeight * 4)
    },
    detailMask = new Uint8Array(width * textureHeight);
  for (let y = 0; y < textureHeight; y++) for (let x = 0; x < width; x++) {
    const gx = min[0] + (x + .5) / width * gw,
      gz = min[1] + (y + .5) / textureHeight * gh,
      cell = cells.get(key(Math.floor(gx), Math.floor(gz)));
    const uv = cell && projectColor(cell.frame, ...world(gx, gz));
    const photographed = inView(uv) ? helpers.sampleColor(cell.frame, uv) : null;
    const rgb = photographed || cell?.rgb || palette;
    texture.data.set([...rgb.map(v => Math.round(v)), 255], (y * width + x) * 4);
    detailMask[y * width + x] = cell?.detail ? 255 : 0;
  }
  const positions = [],
    normals = [],
    uvs = [],
    indices = [],
    lattice = new Map();
  function at(x, z) {
    const k = key(x, z);
    if (!lattice.has(k)) {
      lattice.set(k, positions.length / 3);
      positions.push(...world(x, z));
      normals.push(0, -1, 0);
      uvs.push((x - min[0]) / gw, (z - min[1]) / gh);
    }
    return lattice.get(k);
  }
  for (const c of cells.values()) {
    const a = at(c.x, c.z),
      b = at(c.x + 1, c.z),
      d = at(c.x, c.z + 1),
      e = at(c.x + 1, c.z + 1);
    indices.push(a, b, e, a, e, d);
  }
  let removedTriangles = 0;
  // Whole-face ownership avoids cutting a fixture or a photograph boundary.
  // Boundary faces retain their original geometry until their whole footprint
  // belongs to the prepared surface.
  for (const {
    face,
    points
  } of candidates) {
    let owns = true,
      covered = false;
    eachCell(points, (x, z) => {
      covered = true;
      const cell = cells.get(key(x, z));
      if (!cell || cell.detail) owns = false;
    });
    if (!owns || !covered) continue;
    removed[face] = 1;
    removedTriangles++;
  }
  if (!removedTriangles) return null;
  // The outside of an incomplete scan often contains upward-folded copies
  // of photographed trim. Use the established ceiling as a cutaway boundary
  // inside its footprint; keep details below it and stable alternate levels.
  let cutawayTriangles = 0;
  const fragments = [];
  const clipHeight = height + .025;
  for (let face = 0; face < removed.length; face++) {
    if (removed[face]) continue;
    const points = facePoints(mesh, face);
    if (points.every(p => p[1] <= clipHeight) || points.some(p => p[1] < height - .2 || p[1] > height + MAX_MOVEMENT)) continue;
    let owns = true,
      covered = false;
    eachCell(points, (x, z) => {
      covered = true;
      const k = key(x, z);
      if (!observedFootprint.has(k) || protectedCells.has(k)) owns = false;
    });
    if (!owns || !covered) continue;
    removed[face] = 1;
    cutawayTriangles++;
    // Clip the display copy with interpolated camera UVs and colors. Keeping
    // this local to its observed footprint preserves real higher ceilings and
    // tall objects elsewhere; the raw mesh remains available in Geometry.
    const polygon = [0, 1, 2].map(c => {
      const id = mesh.indices[face * 3 + c];
      return [...points[c], ...Array.from(mesh.normals?.subarray(id * 3, id * 3 + 3) || [0, -1, 0]), ...Array.from(mesh.colors?.subarray(id * 3, id * 3 + 3) || [255, 255, 255]), ...Array.from(mesh.uvs?.subarray(id * 2, id * 2 + 2) || [0, 0])];
    });
    const clipped = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        da = clipHeight - a[1],
        db = clipHeight - b[1];
      if (da >= 0) clipped.push(a);
      if (da * db < 0) clipped.push(a.map((v, k) => v + (b[k] - v) * da / (da - db)));
    }
    for (let i = 1; i < clipped.length - 1; i++) fragments.push({
      face,
      points: [clipped[0], clipped[i], clipped[i + 1]].map(p => ({
        p: p.slice(0, 3),
        n: p.slice(3, 6),
        rgb: p.slice(6, 9),
        uv: p.slice(9)
      }))
    });
  }
  const footprint = new Uint8Array(gw * gh);
  for (const c of cells.values()) footprint[(c.z - min[1]) * gw + c.x - min[0]] = 2;
  const area = cells.size * CELL * CELL;
  return {
    fragments,
    surface: {
      id: "prepared-ceiling",
      normal: [0, -1, 0],
      offset: -height,
      axes: [[1, 0, 0], [0, 0, 1]],
      cellSize: CELL,
      extent: [min, max],
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Uint8Array(positions.length).fill(255),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
      estimatedTriangleMask: new Uint8Array(indices.length / 3).fill(1),
      footprint,
      openingMask: new Uint8Array(gw * gh),
      detailMask,
      texture,
      area,
      estimatedArea: area,
      source: "mesh-footprint"
    },
    diagnostics: {
      ...diagnostics,
      area,
      height,
      removedTriangles,
      cutawayTriangles,
      repairedGapCells,
      maximumAllowedDisplacementMeters: MAX_MOVEMENT,
      measuredGeometryChanged: false
    }
  };
}
