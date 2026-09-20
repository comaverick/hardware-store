// Rebuild independently observed horizontal footprints on one shared grid.
// Moving old fragments onto a plane leaves their cracks and overlaps intact;
// a single triangulation removes that viewpoint-dependent layering instead.
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const key = (x, y) => `${x},${y}`;
function outsideCell(polygon, x, y) {
  let inside = polygon;
  const outside = [];
  for (const [axis, sign, offset] of [[0, 1, x], [0, -1, -x - 1], [1, 1, y], [1, -1, -y - 1]]) {
    const clipped = [],
      rejected = [];
    for (let i = 0; i < inside.length; i++) {
      const a = inside[i],
        b = inside[(i + 1) % inside.length],
        da = a.q[axis] * sign - offset,
        db = b.q[axis] * sign - offset;
      if (da >= -1e-8) clipped.push(a);else rejected.push(a);
      if ((da > 1e-8 && db < -1e-8) || (da < -1e-8 && db > 1e-8)) {
        const t = da / (da - db),
          p = {
            q: a.q.map((v, k) => v + (b.q[k] - v) * t),
            p: a.p.map((v, k) => v + (b.p[k] - v) * t),
            c: a.c.map((v, k) => v + (b.c[k] - v) * t)
          };
        clipped.push(p);
        rejected.push(p);
      }
    }
    if (rejected.length >= 3) outside.push(rejected);
    inside = clipped;
    if (inside.length < 3) break;
  }
  return outside;
}
export function rebuildStructuralSurfaces(mesh, planes, frames, helpers, options = {}) {
  const diagnostics = {
    planes: [],
    removedTriangles: 0,
    reconstructedTriangles: 0,
    reconstructedArea: 0,
    estimatedHoleCount: 0,
    estimatedArea: 0,
    estimatedTriangles: 0
  };
  const patches = [];
  for (const plane of planes) {
    if (plane.kind === 'wall' || plane.supportingFrameIds.length < 3 || plane.area < .7) continue;
    const cell = plane.cellSize,
      occupied = new Map();
    for (const [k, views] of plane.cells) if (views.size >= 2) occupied.set(k, {
      estimated: false
    });
    const coordinates = [...occupied.keys()].map(k => k.split(',').map(Number));
    if (!coordinates.length) continue;
    const bounds = [Math.min(...coordinates.map(p => p[0])), Math.min(...coordinates.map(p => p[1])), Math.max(...coordinates.map(p => p[0])), Math.max(...coordinates.map(p => p[1]))];
    const world = (x, y) => plane.normal.map((n, i) => n * plane.offset + plane.axes[0][i] * x * cell + plane.axes[1][i] * y * cell);
    const evidence = p => {
      const agreeing = [],
        contradicting = [];
      for (const f of frames) {
        const uv = helpers.project(f, ...p);
        if (!uv) continue;
        const x = Math.floor(uv.u * f.columns),
          y = Math.floor(uv.v * f.rows);
        if (x < 0 || y < 0 || x >= f.columns || y >= f.rows) continue;
        const i = y * f.columns + x;
        if (!f.measuredMask[i]) continue;
        const depth = (f.originalFilteredDepth || f.filteredDepth)[i];
        const difference = depth - uv.depth;
        if (Math.abs(difference) < .08) agreeing.push(f);
        // A foreground object is an occlusion, not evidence of empty space.
        // It does not supply support either. Seeing through a proposed plane
        // DOES veto a patch (doorway, opening, or an incorrect plane fit).
        else if (difference > .13) contradicting.push(f);
      }
      const independent = [];
      for (const f of agreeing) if (independent.every(g => Math.hypot(...sub(Array.from(f.camera), Array.from(g.camera))) >= .06)) independent.push(f);
      return {
        agrees: independent.length,
        contradicts: contradicting.length
      };
    };
    // Test the interior in addition to the center. A narrow opening or object
    // must not disappear simply because the cell's center misses its edge.
    for (const [k] of occupied) {
      const [x, y] = k.split(',').map(Number);
      if ([[.5, .5], [.15, .15], [.85, .15], [.15, .85], [.85, .85]].some(([dx, dy]) => {
        const e = evidence(world(x + dx, y + dy));
        return e.agrees < 2 || e.contradicts > Math.max(1, e.agrees * .25);
      })) occupied.delete(k);
    }
    const visited = new Set();
    if (options.repairPlanarGaps) for (let y = bounds[1]; y <= bounds[3]; y++) for (let x = bounds[0]; x <= bounds[2]; x++) {
      if (occupied.has(key(x, y)) || visited.has(key(x, y))) continue;
      const group = [[x, y]];
      visited.add(key(x, y));
      let boundary = false;
      for (let cursor = 0; cursor < group.length; cursor++) {
        const [a, b] = group[cursor];
        if (a === bounds[0] || a === bounds[2] || b === bounds[1] || b === bounds[3]) boundary = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = a + dx,
            d = b + dy,
            k = key(c, d);
          if (c < bounds[0] || c > bounds[2] || d < bounds[1] || d > bounds[3] || occupied.has(k) || visited.has(k)) continue;
          visited.add(k);
          group.push([c, d]);
        }
      }
      if (boundary || group.length * cell * cell > .4) continue;
      if (group.some(([a, b]) => {
        const e = evidence(world(a + .5, b + .5));
        return e.agrees < 2 || e.contradicts > 0;
      })) continue;
      diagnostics.estimatedHoleCount++;
      for (const [a, b] of group) occupied.set(key(a, b), {
        estimated: true
      });
    }
    if (occupied.size * cell * cell < .7) continue;
    // The grid and retained fragments must share EXACTLY the same plane.
    // Do not replace independently fitted, nearby sheets or perpendicular
    // furniture faces: lack of evidence is not permission to delete them.
    const matching = (mesh.planarConsolidation?.planes || []).find(p => p.kind === plane.kind && dot(p.normal, plane.normal) > .999999 && Math.abs(p.offset - plane.offset) < 1e-5);
    if (matching) patches.push({
      plane,
      occupied,
      world,
      cell
    });
  }
  if (!patches.length) return {
    ...mesh,
    structuralRebuild: diagnostics
  };
  const positions = Array.from(mesh.positions),
    colors = Array.from(mesh.colors || []),
    indices = [],
    patchIds = [];
  const point = id => positions.slice(id * 3, id * 3 + 3);
  // Boundary vertices shared with perpendicular object/wall faces are kept;
  // only the supported floor/ceiling fragments themselves are replaced.
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ids = Array.from(mesh.indices.subarray(t, t + 3)),
      p = ids.map(point);
    const n = cross(sub(p[1], p[0]), sub(p[2], p[0])),
      l = Math.hypot(...n) || 1;
    const center = [0, 1, 2].map(i => p.reduce((s, q) => s + q[i] / 3, 0));
    const replacement = patches.find(({
      plane,
      occupied,
      cell
    }) => {
      if (Math.abs(dot(n, plane.normal)) / l < .999 || !p.every(q => Math.abs(dot(plane.normal, q) - plane.offset) < 1e-5)) return false;
      const x = Math.floor(dot(plane.axes[0], center) / cell),
        y = Math.floor(dot(plane.axes[1], center) / cell);
      if (!occupied.has(key(x, y)) && !p.some(q => occupied.has(key(Math.floor(dot(plane.axes[0], q) / cell), Math.floor(dot(plane.axes[1], q) / cell))))) return false;
      return true;
    });
    if (!replacement) {
      indices.push(...ids);
      patchIds.push(mesh.surfacePatchIds?.[t / 3] ?? -1);
      continue;
    }
    const {
      plane,
      occupied,
      cell
    } = replacement;
    let pieces = [p.map((q, k) => ({
      p: q,
      c: mesh.colors?.length ? Array.from(mesh.colors.subarray(ids[k] * 3, ids[k] * 3 + 3)) : [],
      q: plane.axes.map(a => dot(a, q) / cell)
    }))];
    const xy = pieces[0].map(q => q.q),
      bounds = [Math.floor(Math.min(...xy.map(q => q[0]))), Math.floor(Math.min(...xy.map(q => q[1]))), Math.floor(Math.max(...xy.map(q => q[0]))), Math.floor(Math.max(...xy.map(q => q[1])))];
    for (let y = bounds[1]; y <= bounds[3]; y++) for (let x = bounds[0]; x <= bounds[2]; x++) if (occupied.has(key(x, y))) pieces = pieces.flatMap(polygon => outsideCell(polygon, x, y));
    diagnostics.removedTriangles++;
    for (const polygon of pieces) {
      const base = positions.length / 3;
      for (const vertex of polygon) {
        positions.push(...vertex.p);
        if (mesh.colors?.length) colors.push(...vertex.c);
      }
      for (let k = 1; k < polygon.length - 1; k++) {
        indices.push(base, base + k, base + k + 1);
        patchIds.push(mesh.surfacePatchIds?.[t / 3] ?? -1);
      }
    }
  }
  const storedPlanes = [...(mesh.planarConsolidation?.planes || [])];
  for (const {
    plane,
    occupied,
    world,
    cell
  } of patches) {
    const patchId = storedPlanes.length,
      lookup = new Map();
    storedPlanes.push({
      normal: plane.normal,
      offset: plane.offset,
      kind: plane.kind,
      supportingFrameIds: plane.supportingFrameIds,
      inputArea: occupied.size * cell * cell,
      retainedArea: occupied.size * cell * cell,
      maxInputResidual: 0
    });
    const vertex = (x, y) => {
      const k = key(x, y);
      if (!lookup.has(k)) {
        const p = world(x, y),
          id = positions.length / 3;
        positions.push(...p);
        lookup.set(k, id);
        if (mesh.colors?.length) {
          const samples = [];
          for (const f of frames) {
            const uv = helpers.project(f, ...p);
            if (!uv) continue;
            const i = Math.floor(uv.v * f.rows) * f.columns + Math.floor(uv.u * f.columns);
            if (f.measuredMask[i] && Math.abs(f.filteredDepth[i] - uv.depth) < .1 && f.colors?.length) samples.push(Array.from(f.colors.subarray(i * 3, i * 3 + 3)));
          }
          colors.push(...[0, 1, 2].map(i => samples.length ? samples.reduce((s, c) => s + helpers.linearByte(c[i]), 0) / samples.length : 90));
        }
      }
      return lookup.get(k);
    };
    // Subdivide each supported cell so perspective texture projection cannot
    // stretch one large photograph triangle over an entire room surface.
    for (const [k, info] of occupied) {
      const [x, y] = k.split(',').map(Number);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const a = vertex(x + dx * .5, y + dy * .5),
          b = vertex(x + (dx + 1) * .5, y + dy * .5),
          c = vertex(x + dx * .5, y + (dy + 1) * .5),
          d = vertex(x + (dx + 1) * .5, y + (dy + 1) * .5);
        if (plane.kind === 'floor') indices.push(a, b, c, b, d, c);else indices.push(a, c, b, b, c, d);
        patchIds.push(patchId, patchId);
        diagnostics.reconstructedTriangles += 2;
        if (info.estimated) diagnostics.estimatedTriangles += 2;
      }
      if (info.estimated) diagnostics.estimatedArea += cell * cell;
    }
    diagnostics.reconstructedArea += occupied.size * cell * cell;
    diagnostics.planes.push({
      kind: plane.kind,
      area: occupied.size * cell * cell,
      supportingFrameIds: plane.supportingFrameIds
    });
  }
  const result = {
    ...mesh,
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    colors: mesh.colors?.length ? new Uint8Array(colors) : mesh.colors,
    surfacePatchIds: new Int32Array(patchIds),
    structuralRebuild: diagnostics,
    planarConsolidation: {
      ...(mesh.planarConsolidation || {}),
      planes: storedPlanes
    }
  };
  delete result.normals;
  return result;
}
