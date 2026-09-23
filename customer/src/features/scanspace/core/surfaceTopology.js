import { ShapeUtils, Vector2 } from 'three';

// Geometric adjacency is independent of texture seams. Only weld numerical
// duplicates, never nearby layers: those need measured registration evidence.
const pointKey = (p, tolerance) => p.map(v => Math.round(v / tolerance)).join(',');
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => a.map((v, i) => v - b[i]);
export function triangulatePlanarLoop(points, normal) {
  const length = Math.hypot(...normal);
  if (length < 1e-8 || points.length < 3) return [];
  const n = normal.map(v => v / length),
    axis = Math.abs(n[1]) < .8 ? [0, 1, 0] : [1, 0, 0];
  let u = cross(n, axis);
  const ul = Math.hypot(...u);
  u = u.map(v => v / ul);
  const v = cross(n, u),
    dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const contour = points.map(p => new Vector2(dot(p, u), dot(p, v)));
  return ShapeUtils.triangulateShape(contour, []).map(face => {
    const direction = cross(sub(points[face[1]], points[face[0]]), sub(points[face[2]], points[face[0]]));
    return dot(direction, n) < 0 ? [face[0], face[2], face[1]] : face;
  });
}
function geometricEdges(mesh, tolerance) {
  const points = [],
    ids = [],
    lookup = new Map(),
    edges = new Map();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = Array.from(mesh.positions.subarray(i, i + 3)),
      key = pointKey(p, tolerance);
    if (!lookup.has(key)) {
      lookup.set(key, points.length);
      points.push(p);
    }
    ids.push(lookup.get(key));
  }
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const face = Array.from(mesh.indices.subarray(t, t + 3), id => ids[id]);
    for (let i = 0; i < 3; i++) {
      const a = face[i],
        b = face[(i + 1) % 3];
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edges.has(key)) edges.set(key, {
        a,
        b,
        faces: [],
        directions: []
      });
      const edge = edges.get(key);
      edge.faces.push(t / 3);
      edge.directions.push(a < b ? 1 : -1);
    }
  }
  return {
    points,
    ids,
    edges
  };
}
function connectivityFromGeometry(mesh, edges) {
  const faceCount = Math.floor((mesh.indices?.length || 0) / 3),
    parent = new Int32Array(faceCount);
  for (let face = 0; face < faceCount; face++) parent[face] = face;
  const find = value => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const join = (left, right) => {
    const a = find(left), b = find(right);
    if (a !== b) parent[b] = a;
  };
  for (const edge of edges.values()) if (edge.faces.length > 1) {
    for (let index = 1; index < edge.faces.length; index++) join(edge.faces[0], edge.faces[index]);
  }
  const components = new Map();
  for (let face = 0; face < faceCount; face++) {
    const root = find(face), idsForFace = [0, 1, 2].map(corner => mesh.indices[face * 3 + corner]),
      p = idsForFace.map(id => Array.from(mesh.positions.subarray(id * 3, id * 3 + 3))),
      normal = cross(sub(p[1], p[0]), sub(p[2], p[0])),
      area = Math.hypot(...normal) * .5;
    const component = components.get(root) || {
      triangles: 0,
      area: 0,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity]
    };
    component.triangles++;
    component.area += area;
    for (const vertex of p) for (let axis = 0; axis < 3; axis++) {
      component.min[axis] = Math.min(component.min[axis], vertex[axis]);
      component.max[axis] = Math.max(component.max[axis], vertex[axis]);
    }
    components.set(root, component);
  }
  const entries = [...components.values()].sort((a, b) => b.area - a.area),
    totalArea = entries.reduce((sum, component) => sum + component.area, 0),
    dominantArea = entries[0]?.area || 0;
  return {
    componentCount: entries.length,
    dominantComponentArea: dominantArea,
    dominantComponentAreaRatio: dominantArea / Math.max(1e-9, totalArea),
    disconnectedComponentCount: Math.max(0, entries.length - 1),
    disconnectedArea: Math.max(0, totalArea - dominantArea),
    largestDisconnectedArea: entries[1]?.area || 0,
    tinyDisconnectedCount: entries.slice(1).filter(component => component.area < 0.001).length,
    components: entries.slice(0, 12).map(component => ({
      triangles: component.triangles,
      area: component.area,
      min: component.min,
      max: component.max
    }))
  };
}
export function surfaceConnectivityDiagnostics(mesh, tolerance = 0.00001) {
  const { edges } = geometricEdges(mesh, tolerance);
  return connectivityFromGeometry(mesh, edges);
}
export function surfaceTopologyDiagnostics(mesh, tolerance = 0.00001) {
  const {
    points,
    edges
  } = geometricEdges(mesh, tolerance);
  let boundaryEdges = 0,
    boundaryLengthMeters = 0,
    nonManifoldEdges = 0,
    windingConflicts = 0;
  for (const edge of edges.values()) {
    if (edge.faces.length === 1) {
      boundaryEdges++;
      boundaryLengthMeters += distance(points[edge.a], points[edge.b]);
    }
    if (edge.faces.length > 2) nonManifoldEdges++;
    if (edge.faces.length === 2 && edge.directions[0] === edge.directions[1]) windingConflicts++;
  }
  return {
    boundaryEdges,
    boundaryLengthMeters,
    nonManifoldEdges,
    windingConflicts,
    ...connectivityFromGeometry(mesh, edges)
  };
}

// Once T-junctions and bounded holes have been resolved, make neighboring
// manifold faces agree on an orientation. This changes only triangle index
// order: measured positions, texture coordinates, and open boundaries stay
// exactly where they were. Non-manifold edges do not establish an orientation
// constraint because they may join genuinely separate depth layers.
export function orientManifoldFaces(mesh, tolerance = 0.00001) {
  if (!mesh?.indices?.length)
    return { ...mesh, faceOrientation: { flippedFaces: 0, unresolvedGroups: 0 } };
  const { edges } = geometricEdges(mesh, tolerance);
  const faceCount = mesh.indices.length / 3;
  const neighbors = Array.from({ length: faceCount }, () => []);
  for (const edge of edges.values()) {
    if (edge.faces.length !== 2) continue;
    const [a, b] = edge.faces;
    const different = edge.directions[0] === edge.directions[1] ? 1 : 0;
    neighbors[a].push([b, different]);
    neighbors[b].push([a, different]);
  }
  const orientation = new Int8Array(faceCount).fill(-1);
  const indices = new Uint32Array(mesh.indices);
  let flippedFaces = 0, unresolvedGroups = 0;
  for (let start = 0; start < faceCount; start++) {
    if (orientation[start] !== -1) continue;
    const group = [start];
    orientation[start] = 0;
    let inconsistent = false, keepCost = 0, reverseCost = 0;
    for (let cursor = 0; cursor < group.length; cursor++) {
      const face = group[cursor];
      const ids = Array.from(indices.subarray(face * 3, face * 3 + 3));
      const p = ids.map(id => Array.from(mesh.positions.subarray(id * 3, id * 3 + 3)));
      const area = Math.hypot(...cross(sub(p[1], p[0]), sub(p[2], p[0]))) * 0.5;
      if (orientation[face]) keepCost += area;
      else reverseCost += area;
      for (const [next, different] of neighbors[face]) {
        const expected = orientation[face] ^ different;
        if (orientation[next] === -1) {
          orientation[next] = expected;
          group.push(next);
        } else if (orientation[next] !== expected) inconsistent = true;
      }
    }
    // An inconsistent cycle indicates intersecting/ambiguous topology. Do
    // not force a speculative flip through that region.
    if (inconsistent) {
      unresolvedGroups++;
      continue;
    }
    const reverseGroup = reverseCost < keepCost;
    for (const face of group) {
      if (!(orientation[face] ^ Number(reverseGroup))) continue;
      const offset = face * 3;
      [indices[offset + 1], indices[offset + 2]] =
        [indices[offset + 2], indices[offset + 1]];
      flippedFaces++;
    }
  }
  return { ...mesh, indices,
    faceOrientation: { flippedFaces, unresolvedGroups } };
}

// Remove only tiny isolated fragments that cannot be verified by two camera
// positions. Separate shelf items and artwork relief with actual repeat depth
// are retained; distance to the main room mesh alone is not a deletion rule.
export function pruneUnsupportedFragments(mesh, frames, project, {
  maxArea = 0.001, minimumBaseline = 0.06, depthTolerance = 0.055,
} = {}) {
  if (!mesh?.indices?.length || !frames?.length || !project)
    return { ...mesh, fragmentPruning: { removedComponents: 0, removedArea: 0 } };
  const { edges } = geometricEdges(mesh, 0.00001);
  const count = mesh.indices.length / 3, parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = value => {
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]];
      value = parent[value];
    }
    return value;
  };
  for (const edge of edges.values()) if (edge.faces.length > 1) {
    const root = find(edge.faces[0]);
    for (let i = 1; i < edge.faces.length; i++) parent[find(edge.faces[i])] = root;
  }
  const groups = new Map();
  for (let face = 0; face < count; face++) {
    const ids = Array.from(mesh.indices.subarray(face * 3, face * 3 + 3));
    const p = ids.map(id => Array.from(mesh.positions.subarray(id * 3, id * 3 + 3)));
    const area = Math.hypot(...cross(sub(p[1], p[0]), sub(p[2], p[0]))) * 0.5;
    const root = find(face), group = groups.get(root) || { area: 0, samples: [] };
    group.area += area;
    if (group.samples.length < 8 && area > 1e-9)
      group.samples.push([0, 1, 2].map(axis => p.reduce((sum, point) => sum + point[axis] / 3, 0)));
    groups.set(root, group);
  }
  const supported = point => {
    const views = [];
    for (const frame of frames) {
      const uv = project(frame, ...point);
      if (!uv || uv.u < 0 || uv.v < 0 || uv.u >= 1 || uv.v >= 1) continue;
      const x = Math.floor(uv.u * frame.columns), y = Math.floor(uv.v * frame.rows);
      const index = y * frame.columns + x;
      if (!frame.measuredMask?.[index]) continue;
      const depth = (frame.originalFilteredDepth || frame.filteredDepth)?.[index];
      if (!depth || Math.abs(depth - uv.depth) > depthTolerance) continue;
      const camera = frame.camera;
      if (!camera?.length || views.some(previous => Math.hypot(...sub(camera, previous)) < minimumBaseline)) continue;
      views.push(camera);
      if (views.length >= 2) return true;
    }
    return false;
  };
  const removed = new Set();
  let removedComponents = 0, removedArea = 0;
  for (const [root, group] of groups) {
    if (group.area >= maxArea || group.samples.some(supported)) continue;
    removed.add(root);
    removedComponents++;
    removedArea += group.area;
  }
  if (!removed.size)
    return { ...mesh, fragmentPruning: { removedComponents, removedArea } };
  const indices = [], patches = [];
  for (let face = 0; face < count; face++) {
    if (removed.has(find(face))) continue;
    indices.push(...mesh.indices.subarray(face * 3, face * 3 + 3));
    if (mesh.surfacePatchIds) patches.push(mesh.surfacePatchIds[face]);
  }
  return { ...mesh, indices: new Uint32Array(indices),
    ...(mesh.surfacePatchIds ? { surfacePatchIds: new Int32Array(patches) } : {}),
    surfaceArea: Math.max(0, (mesh.surfaceArea ?? [...groups.values()].reduce((sum, group) => sum + group.area, 0)) - removedArea),
    fragmentPruning: { removedComponents, removedArea } };
}
export function conformSurfaceTopology(mesh, {
  tolerance = 0.00001
} = {}) {
  const {
    points,
    ids,
    edges
  } = geometricEdges(mesh, tolerance);
  const boundaryAt = new Map();
  for (const edge of edges.values()) if (edge.faces.length === 1) for (const id of [edge.a, edge.b]) {
    if (!boundaryAt.has(id)) boundaryAt.set(id, []);
    boundaryAt.get(id).push(edge);
  }
  const cell = 0.06,
    hash = new Map();
  points.forEach((p, id) => {
    const key = p.map(v => Math.floor(v / cell)).join(',');
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(id);
  });
  const splits = new Map();
  for (const edge of edges.values()) {
    if (edge.faces.length !== 1) continue;
    const a = points[edge.a],
      b = points[edge.b],
      ab = sub(b, a);
    const length2 = ab.reduce((s, v) => s + v * v, 0);
    if (length2 < tolerance * tolerance * 16) continue;
    const candidates = new Set();
    // Walking the edge bounds work even for large, oblique triangles without
    // enumerating the entire volume of their three-dimensional bounding box.
    const steps = Math.ceil(Math.sqrt(length2) / (cell * 0.5));
    for (let step = 0; step <= steps; step++) {
      const at = a.map((v, i) => Math.floor((v + ab[i] * step / steps) / cell));
      for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) hash.get(`${at[0] + x},${at[1] + y},${at[2] + z}`)?.forEach(id => candidates.add(id));
    }
    const found = [];
    for (const id of candidates) {
      if (id === edge.a || id === edge.b) continue;
      const p = points[id],
        t = sub(p, a).reduce((s, v, i) => s + v * ab[i], 0) / length2;
      if (t <= tolerance / Math.sqrt(length2) || t >= 1 - tolerance / Math.sqrt(length2)) continue;
      if (distance(p, a.map((v, i) => v + t * ab[i])) > tolerance) continue;
      // A coincident point alone is not proof of shared topology (it could be
      // another sheet crossing this face). Require a collinear boundary edge
      // from the neighboring face, as in a genuine one-to-two edge junction.
      const neighbor = (boundaryAt.get(id) || []).some(other => {
        if (other.faces[0] === edge.faces[0]) return false;
        const q = points[other.a === id ? other.b : other.a];
        const u = sub(q, a).reduce((s, v, i) => s + v * ab[i], 0) / length2;
        return Math.min(Math.max(t, u), 1) - Math.max(Math.min(t, u), 0) > tolerance / Math.sqrt(length2) && distance(q, a.map((v, i) => v + u * ab[i])) <= tolerance;
      });
      if (neighbor) found.push({
        t,
        p
      });
    }
    if (found.length) {
      found.sort((a, b) => a.t - b.t);
      splits.set(`${edge.a},${edge.b}`, found);
      splits.set(`${edge.b},${edge.a}`, found.slice().reverse().map(v => ({
        ...v,
        t: 1 - v.t
      })));
    }
  }
  const positions = [],
    indices = [],
    patches = [],
    attributes = {},
    lookup = new Map(),
    faces = new Set();
  for (const [name, size] of [['colors', 3], ['portableColors', 3], ['uvs', 2]]) if (mesh[name]?.length === mesh.positions.length / 3 * size) attributes[name] = {
    size,
    values: []
  };
  const append = (p, source, weights) => {
    const values = {};
    for (const [name, a] of Object.entries(attributes)) values[name] = Array.from({
      length: a.size
    }, (_, axis) => source.reduce((s, id, k) => s + weights[k] * mesh[name][id * a.size + axis], 0));
    const key = `${pointKey(p, tolerance)}:${(values.uvs || []).map(v => Math.round(v * 1e7)).join(',')}`;
    if (!lookup.has(key)) {
      lookup.set(key, positions.length / 3);
      positions.push(...p);
      for (const [name, a] of Object.entries(attributes)) a.values.push(...values[name]);
    }
    return lookup.get(key);
  };
  let splitFaces = 0,
    duplicateFaces = 0,
    surfaceArea = 0;
  const addFace = (a, b, c, patch) => {
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (faces.has(key)) {
      duplicateFaces++;
      return;
    }
    const p = [a, b, c].map(id => positions.slice(id * 3, id * 3 + 3));
    const area = Math.hypot(...cross(sub(p[1], p[0]), sub(p[2], p[0]))) / 2;
    if (area <= 1e-10) return;
    faces.add(key);
    indices.push(a, b, c);
    patches.push(patch);
    surfaceArea += area;
  };
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const source = Array.from(mesh.indices.subarray(t, t + 3)),
      polygon = [];
    let split = false;
    for (let k = 0; k < 3; k++) {
      const weights = [0, 0, 0];
      weights[k] = 1;
      polygon.push(append(points[ids[source[k]]], source, weights));
      for (const item of splits.get(`${ids[source[k]]},${ids[source[(k + 1) % 3]]}`) || []) {
        const w = [0, 0, 0];
        w[k] = 1 - item.t;
        w[(k + 1) % 3] = item.t;
        polygon.push(append(item.p, source, w));
        split = true;
      }
    }
    const patch = mesh.surfacePatchIds?.[t / 3] ?? -1;
    if (!split) addFace(...polygon, patch);else {
      splitFaces++;
      const center = [0, 1, 2].map(axis => source.reduce((s, id) => s + mesh.positions[id * 3 + axis] / 3, 0));
      const id = append(center, source, [1 / 3, 1 / 3, 1 / 3]);
      for (let k = 0; k < polygon.length; k++) addFace(id, polygon[k], polygon[(k + 1) % polygon.length], patch);
    }
  }
  const result = {
    ...mesh,
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    surfacePatchIds: new Int32Array(patches),
    surfaceArea,
    topologyRepair: {
      splitFaces,
      duplicateFaces,
      toleranceMeters: tolerance
    }
  };
  for (const [name, a] of Object.entries(attributes)) result[name] = new mesh[name].constructor(a.values);
  delete result.normals;
  return result;
}
