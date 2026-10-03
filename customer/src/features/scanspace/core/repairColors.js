// Estimated patches use observed colors at their own rim. A camera image is
// never projected through a missing ray onto the new faces.
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const distance = (a, b) => Math.hypot(...subtract(a, b));
const point = (mesh, id) => Array.from(mesh.positions.subarray(id * 3, id * 3 + 3));
const normal = record => [record.faceNormal.x, record.faceNormal.y, record.faceNormal.z];

export function blendRepairColors(mesh, records, sampleObservedColor) {
  const colors = mesh.colors?.slice() || new Uint8Array(mesh.positions.length);
  const blended = new Uint8Array(records.length);
  const diagnostics = { mode: 'surrounding-observed-colors', groups: 0,
    triangles: 0, area: 0, boundaryVertices: 0, interiorVertices: 0 };
  const visited = new Set();
  for (let first = 0; first < records.length; first++) {
    if (!records[first].estimated || visited.has(first)) continue;
    const reference = normal(records[first]), origin = records[first].center;
    const coplanar = record => Math.abs(dot(normal(record), reference)) > .985 &&
      Math.abs(dot(subtract(record.center, origin), reference)) < .025;
    const group = [first];
    visited.add(first);
    for (let cursor = 0; cursor < group.length; cursor++) {
      for (const neighbor of records[group[cursor]].neighbors) {
        if (visited.has(neighbor) || !records[neighbor].estimated || !coplanar(records[neighbor])) continue;
        visited.add(neighbor);
        group.push(neighbor);
      }
    }
    const ids = new Set(group.flatMap(index => records[index].triangle));
    if (ids.size > 4096) continue;
    const points = new Map([...ids].map(id => [id, point(mesh, id)]));
    const min = [0, 1, 2].map(axis => Math.min(...[...points.values()].map(p => p[axis])));
    const max = [0, 1, 2].map(axis => Math.max(...[...points.values()].map(p => p[axis])));
    const area = group.reduce((sum, index) => sum + records[index].area, 0);
    // Do not diffuse a color across a whole unobserved room or an attached fold.
    if (distance(min, max) > 1 || area > .4) continue;
    const seeds = new Map(), scores = new Map();
    for (const index of group) for (const neighbor of records[index].neighbors) {
      const observed = records[neighbor];
      if (observed.estimated || !coplanar(observed)) continue;
      const score = observed.candidates[observed.selected]?.score ?? -Infinity;
      observed.triangle.forEach((id, corner) => {
        if (!ids.has(id) || (scores.has(id) && score <= scores.get(id))) return;
        const color = sampleObservedColor(observed, corner);
        if (!color?.length || color.some(value => !Number.isFinite(value))) return;
        seeds.set(id, color);
        scores.set(id, score);
      });
    }
    if (seeds.size < 3) continue;
    // Three samples on one edge cannot define the appearance of a whole patch.
    const seedPoints = [...seeds.keys()].map(id => points.get(id));
    const a = seedPoints[0], b = seedPoints.reduce((best, p) => distance(a, p) > distance(a, best) ? p : best, a);
    const ab = subtract(b, a), length2 = dot(ab, ab);
    if (length2 < 1e-8 || !seedPoints.some(p => {
      const ap = subtract(p, a), t = dot(ap, ab) / length2;
      return distance(p, a.map((v, axis) => v + ab[axis] * t)) > .002;
    })) continue;
    const values = new Map(seeds), neighbors = new Map([...ids].map(id => [id, new Map()]));
    for (const index of group) {
      const triangle = records[index].triangle;
      for (let corner = 0; corner < 3; corner++) {
        const u = triangle[corner], v = triangle[(corner + 1) % 3];
        const weight = 1 / Math.max(.001, distance(points.get(u), points.get(v)));
        neighbors.get(u).set(v, weight);
        neighbors.get(v).set(u, weight);
      }
    }
    const interior = [...ids].filter(id => !seeds.has(id));
    for (const id of interior) {
      const weights = [...seeds].map(([seed, color]) => ({ color,
        weight: 1 / Math.max(1e-6, distance(points.get(id), points.get(seed)) ** 2) }));
      const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
      values.set(id, [0, 1, 2].map(axis => weights.reduce((sum, entry) => sum + entry.color[axis] * entry.weight, 0) / total));
    }
    // Harmonic interpolation in linear color space, with the observed rim
    // fixed. This blends shades without inventing texture or borrowing furniture.
    for (let pass = 0; pass < 64 && interior.length; pass++) {
      let change = 0;
      for (const id of interior) {
        const adjacent = [...neighbors.get(id)], total = adjacent.reduce((sum, [, weight]) => sum + weight, 0);
        const value = [0, 1, 2].map(axis => adjacent.reduce((sum, [neighbor, weight]) => sum + values.get(neighbor)[axis] * weight, 0) / total);
        change = Math.max(change, ...value.map((v, axis) => Math.abs(v - values.get(id)[axis])));
        values.set(id, value);
      }
      if (change < .05) break;
    }
    for (const [id, color] of values) colors.set(color.map(value => Math.max(0, Math.min(255, Math.round(value)))), id * 3);
    group.forEach(index => { blended[index] = 1; });
    diagnostics.groups++;
    diagnostics.triangles += group.length;
    diagnostics.area += area;
    diagnostics.boundaryVertices += seeds.size;
    diagnostics.interiorVertices += interior.length;
  }
  return { colors, blended, diagnostics };
}
