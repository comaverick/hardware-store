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
    windingConflicts
  };
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
