const UNKNOWN = 1;
const CONTRADICTED = 2;
const SUPPORTED = 3;

function triangleArea(positions, a, b, c) {
  const ux = positions[b * 3] - positions[a * 3];
  const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
  const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
  const vx = positions[c * 3] - positions[a * 3];
  const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
  const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

// Trim a flare even when it is attached to the main room mesh. Missing depth
// and foreground occlusion cannot authorize deletion: every sampled point must
// lie in measured free space in three translated views, and any original depth
// agreement preserves it. A continuous 3x3 footprint avoids cutting thin items
// at depth edges. This operates before texture projection and never edits views.
export function pruneContradictedSurfaceTriangles(mesh, frames, project, {
  minimumContradictingViews = 3,
  minimumBaselineMeters = 0.06,
} = {}) {
  const minimumViews = Math.max(3, minimumContradictingViews);
  const baseline = Math.max(0.06, minimumBaselineMeters);
  const diagnostics = {
    mode: 'original-depth-free-space',
    minimumContradictingViews: minimumViews,
    minimumBaselineMeters: baseline,
    examinedVertices: 0,
    depthProjections: 0,
    supportedVertices: 0,
    contradictedVertices: 0,
    candidateTriangles: 0,
    centroidVetoTriangles: 0,
    removedTriangles: 0,
    removedArea: 0,
    removedBranches: 0,
    largestRemovedBranchArea: 0,
    branches: [],
  };
  const views = (frames || []).filter(frame =>
    frame.camera?.length >= 3 && Array.from(frame.camera).every(Number.isFinite) &&
    frame.columns >= 3 && frame.rows >= 3 &&
    frame.measuredMask?.length >= frame.columns * frame.rows &&
    (frame.originalFilteredDepth || frame.filteredDepth)?.length >= frame.columns * frame.rows);
  if (!mesh?.indices?.length || !mesh.positions?.length || !project || views.length < minimumViews)
    return { ...mesh, surfaceEvidence: diagnostics };

  const independent = views.map((frame, i) => Uint8Array.from(views, (other, j) =>
    i !== j && Math.hypot(
      frame.camera[0] - other.camera[0],
      frame.camera[1] - other.camera[1],
      frame.camera[2] - other.camera[2],
    ) >= baseline ? 1 : 0));

  const classify = point => {
    if (!point.every(Number.isFinite)) return UNKNOWN;
    const contradictions = [];
    for (let frameIndex = 0; frameIndex < views.length; frameIndex++) {
      const frame = views[frameIndex];
      const uv = project(frame, ...point);
      diagnostics.depthProjections++;
      if (!uv || !Number.isFinite(uv.u) || !Number.isFinite(uv.v) ||
          !(uv.depth > 0) || uv.u < 0 || uv.u >= 1 || uv.v < 0 || uv.v >= 1) continue;
      const x = Math.floor(uv.u * frame.columns);
      const y = Math.floor(uv.v * frame.rows);
      const depths = frame.originalFilteredDepth || frame.filteredDepth;
      const agreement = Math.max(0.065, uv.depth * 0.03);
      const freeSpace = Math.max(0.14, uv.depth * 0.06);
      let continuous = x > 0 && y > 0 && x < frame.columns - 1 && y < frame.rows - 1;
      let minimumDepth = Infinity, maximumDepth = -Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= frame.columns || ny >= frame.rows) {
          continuous = false;
          continue;
        }
        const index = ny * frame.columns + nx;
        const depth = depths[index];
        if (!frame.measuredMask[index] || !(depth > 0) || !Number.isFinite(depth)) {
          continuous = false;
          continue;
        }
        // Checking adjacent support is intentionally conservative at an object
        // silhouette; those pixels cannot be used to invent an empty ray.
        if (Math.abs(depth - uv.depth) <= agreement) return SUPPORTED;
        minimumDepth = Math.min(minimumDepth, depth);
        maximumDepth = Math.max(maximumDepth, depth);
        if (depth - uv.depth < freeSpace) continuous = false;
      }
      if (!continuous || maximumDepth - minimumDepth > Math.max(0.1, uv.depth * 0.04)) continue;
      const center = y * frame.columns + x;
      // Prepared views already mark rays safe for free-space erasure. Their
      // confidence veto wins even when a weak neighborhood happens to agree.
      // Legacy callers without that mask may supply the original confidence.
      if (frame.freeSpaceMask?.length) {
        if (!frame.freeSpaceMask[center]) continue;
      } else if (frame.depthConfidence?.length && frame.depthConfidence[center] < 140) continue;
      if (contradictions.length < minimumViews &&
          contradictions.every(previous => independent[frameIndex][previous])) contradictions.push(frameIndex);
      // Continue checking all original views even after enough contradictions:
      // a single matching view protects unique coverage and measured relief.
    }
    return contradictions.length >= minimumViews ? CONTRADICTED : UNKNOWN;
  };

  const vertexEvidence = new Uint8Array(mesh.positions.length / 3);
  const evidenceAt = id => {
    if (!vertexEvidence[id]) {
      const offset = id * 3;
      vertexEvidence[id] = classify([
        mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2],
      ]);
      diagnostics.examinedVertices++;
      if (vertexEvidence[id] === SUPPORTED) diagnostics.supportedVertices++;
      if (vertexEvidence[id] === CONTRADICTED) diagnostics.contradictedVertices++;
    }
    return vertexEvidence[id];
  };
  const removed = [], areas = [];
  for (let face = 0; face < mesh.indices.length / 3; face++) {
    const a = mesh.indices[face * 3], b = mesh.indices[face * 3 + 1], c = mesh.indices[face * 3 + 2];
    // A face that touches a supported wall/baseboard junction is retained.
    if (evidenceAt(a) !== CONTRADICTED || evidenceAt(b) !== CONTRADICTED || evidenceAt(c) !== CONTRADICTED) continue;
    diagnostics.candidateTriangles++;
    const center = [0, 1, 2].map(axis =>
      (mesh.positions[a * 3 + axis] + mesh.positions[b * 3 + axis] + mesh.positions[c * 3 + axis]) / 3);
    if (classify(center) !== CONTRADICTED) {
      diagnostics.centroidVetoTriangles++;
      continue;
    }
    removed.push(face);
    areas.push(triangleArea(mesh.positions, a, b, c));
  }
  if (!removed.length) return { ...mesh, surfaceEvidence: diagnostics };

  // Keep branch diagnostics bounded; indices sharing a vertex form one cut.
  const parent = Int32Array.from(removed, (_, i) => i);
  const find = i => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const firstFaceAtVertex = new Map();
  removed.forEach((face, i) => {
    for (let corner = 0; corner < 3; corner++) {
      const id = mesh.indices[face * 3 + corner];
      if (firstFaceAtVertex.has(id)) parent[find(i)] = find(firstFaceAtVertex.get(id));
      else firstFaceAtVertex.set(id, i);
    }
  });
  const branches = new Map();
  removed.forEach((face, i) => {
    const root = find(i), branch = branches.get(root) || { triangles: 0, area: 0 };
    branch.triangles++;
    branch.area += areas[i];
    branches.set(root, branch);
    diagnostics.removedArea += areas[i];
  });
  diagnostics.removedTriangles = removed.length;
  diagnostics.removedBranches = branches.size;
  diagnostics.branches = [...branches.values()].sort((a, b) => b.area - a.area).slice(0, 16);
  diagnostics.largestRemovedBranchArea = diagnostics.branches[0]?.area || 0;

  const removedFaces = new Set(removed);
  const indices = [], patches = [], estimated = [];
  let inputArea = 0;
  for (let face = 0; face < mesh.indices.length / 3; face++) {
    const a = mesh.indices[face * 3], b = mesh.indices[face * 3 + 1], c = mesh.indices[face * 3 + 2];
    if (!Number.isFinite(mesh.surfaceArea)) inputArea += triangleArea(mesh.positions, a, b, c);
    if (removedFaces.has(face)) continue;
    indices.push(a, b, c);
    if (mesh.surfacePatchIds) patches.push(mesh.surfacePatchIds[face]);
    if (mesh.estimatedTriangleMask) estimated.push(mesh.estimatedTriangleMask[face]);
  }
  const result = {
    ...mesh,
    indices: new Uint32Array(indices),
    ...(mesh.surfacePatchIds ? { surfacePatchIds: new Int32Array(patches) } : {}),
    ...(mesh.estimatedTriangleMask ? { estimatedTriangleMask: new Uint8Array(estimated) } : {}),
    surfaceArea: Math.max(0, (Number.isFinite(mesh.surfaceArea) ? mesh.surfaceArea : inputArea) - diagnostics.removedArea),
    surfaceEvidence: diagnostics,
  };
  delete result.normals;
  return result;
}
