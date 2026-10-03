import { pruneContradictedSurfaceTriangles } from './surfaceEvidence';

const project = (frame, x, y, z) => ({ u: 0.5 + x * 0.2, v: 0.5 + y * 0.2, depth: z });
const framesAtDepth = (depth = 2, count = 3) => Array.from({ length: count }, (_, i) => ({
  frameId: i,
  camera: [i * 0.12, 0, 0],
  columns: 32,
  rows: 32,
  measuredMask: new Uint8Array(32 * 32).fill(1),
  filteredDepth: new Float32Array(32 * 32).fill(depth),
}));

function fixture() {
  return {
    positions: new Float32Array([
      -0.8, -0.8, 2, 0.8, -0.8, 2, 0, 0.8, 2,
      -0.6, -0.5, 1, 0.6, -0.5, 1, 0, 0.7, 1,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 3, 4, 3, 4, 5]),
    colors: new Uint8Array(18).fill(90),
    surfacePatchIds: new Int32Array([0, -1, -1]),
    estimatedTriangleMask: new Uint8Array([0, 0, 1]),
    normals: new Float32Array(18),
  };
}

test('trims a contradicted attached flare while retaining its measured junction and metadata', () => {
  const mesh = fixture(), before = mesh.positions.slice();
  const result = pruneContradictedSurfaceTriangles(mesh, framesAtDepth(), project);
  expect(Array.from(result.indices)).toEqual([0, 1, 2, 0, 3, 4]);
  expect(result.surfaceEvidence.removedTriangles).toBe(1);
  expect(result.surfaceEvidence.removedBranches).toBe(1);
  expect(result.surfaceEvidence.removedArea).toBeCloseTo(0.72, 6);
  expect(result.surfaceEvidence.branches[0].triangles).toBe(1);
  expect(Array.from(result.surfacePatchIds)).toEqual([0, -1]);
  expect(Array.from(result.estimatedTriangleMask)).toEqual([0, 0]);
  expect(result.normals).toBeUndefined();
  expect(mesh.positions).toEqual(before);
  expect(mesh.indices.length).toBe(9);
});

test('one original observation preserves curtain or furniture relief despite many background votes', () => {
  const mesh = fixture(), frames = framesAtDepth(2, 8);
  frames[7].originalFilteredDepth = new Float32Array(1024).fill(1);
  const originalDepth = frames[7].originalFilteredDepth.slice();
  const result = pruneContradictedSurfaceTriangles(mesh, frames, project);
  expect(result.indices).toBe(mesh.indices);
  expect(result.surfaceEvidence.removedTriangles).toBe(0);
  expect(result.surfaceEvidence.supportedVertices).toBeGreaterThan(0);
  expect(frames[7].originalFilteredDepth).toEqual(originalDepth);
});

test('two views, missing depth, and foreground occlusion cannot authorize a cut', () => {
  const mesh = fixture();
  expect(pruneContradictedSurfaceTriangles(mesh, framesAtDepth(2, 2), project).indices).toBe(mesh.indices);
  const missing = framesAtDepth();
  missing[2].measuredMask.fill(0);
  expect(pruneContradictedSurfaceTriangles(mesh, missing, project).indices).toBe(mesh.indices);
  const occluded = framesAtDepth();
  occluded[2].filteredDepth.fill(0.5);
  expect(pruneContradictedSurfaceTriangles(mesh, occluded, project).indices).toBe(mesh.indices);
});

test('rotations or duplicate camera positions are one free-space observation', () => {
  const mesh = fixture(), frames = framesAtDepth(2, 8);
  for (const frame of frames) frame.camera = [0, 0, 0];
  const result = pruneContradictedSurfaceTriangles(mesh, frames, project);
  expect(result.indices).toBe(mesh.indices);
  expect(result.surfaceEvidence.contradictedVertices).toBe(0);
});

test('weak depth and a prepared free-space veto cannot count as contradictory observations', () => {
  const mesh = fixture(), weak = framesAtDepth();
  weak[2].depthConfidence = new Uint8Array(1024).fill(139);
  expect(pruneContradictedSurfaceTriangles(mesh, weak, project).indices).toBe(mesh.indices);
  const vetoed = framesAtDepth();
  vetoed[2].depthConfidence = new Uint8Array(1024).fill(255);
  vetoed[2].freeSpaceMask = new Uint8Array(1024);
  expect(pruneContradictedSurfaceTriangles(mesh, vetoed, project).indices).toBe(mesh.indices);
  const confident = framesAtDepth();
  for (const frame of confident) frame.freeSpaceMask = new Uint8Array(1024).fill(1);
  expect(pruneContradictedSurfaceTriangles(mesh, confident, project).surfaceEvidence.removedTriangles).toBe(1);
});

test('weak original depth still protects a measured surface even when it cannot erase one', () => {
  const mesh = fixture(), frames = framesAtDepth(2, 4);
  frames[3].originalFilteredDepth = new Float32Array(1024).fill(1);
  frames[3].depthConfidence = new Uint8Array(1024).fill(90);
  frames[3].freeSpaceMask = new Uint8Array(1024);
  expect(pruneContradictedSurfaceTriangles(mesh, frames, project).indices).toBe(mesh.indices);
});

test('thin silhouettes and depth discontinuities prevent a background vote', () => {
  const mesh = fixture(), frames = framesAtDepth();
  // Every tip vertex is near a background edge in the third view. There are
  // only two continuous measurements of empty space, so it must remain.
  for (const id of [3, 4, 5]) {
    const uv = project(frames[2], ...mesh.positions.subarray(id * 3, id * 3 + 3));
    const x = Math.floor(uv.u * 32), y = Math.floor(uv.v * 32);
    frames[2].filteredDepth[y * 32 + x + 1] = 3;
  }
  expect(pruneContradictedSurfaceTriangles(mesh, frames, project).indices).toBe(mesh.indices);
});

test('a supported triangle interior vetoes removal even if its three corners are contradicted', () => {
  const mesh = fixture(), frames = framesAtDepth();
  const center = [0, 1, 2].map(axis =>
    (mesh.positions[3 * 3 + axis] + mesh.positions[4 * 3 + axis] + mesh.positions[5 * 3 + axis]) / 3);
  const uv = project(frames[2], ...center);
  frames[2].filteredDepth[Math.floor(uv.v * 32) * 32 + Math.floor(uv.u * 32)] = 1;
  const result = pruneContradictedSurfaceTriangles(mesh, frames, project);
  expect(result.surfaceEvidence.candidateTriangles).toBe(1);
  expect(result.surfaceEvidence.centroidVetoTriangles).toBe(1);
  expect(result.indices).toBe(mesh.indices);
});

test('small residuals after bounded surface flattening are preserved rather than treated as empty space', () => {
  const mesh = fixture();
  for (const id of [3, 4, 5]) mesh.positions[id * 3 + 2] = 1.95;
  const result = pruneContradictedSurfaceTriangles(mesh, framesAtDepth(), project);
  expect(result.indices).toBe(mesh.indices);
});

test('vertex classifications are cached across faces', () => {
  const mesh = fixture();
  mesh.indices = new Uint32Array([...mesh.indices, 3, 4, 5, 3, 4, 5]);
  const result = pruneContradictedSurfaceTriangles(mesh, framesAtDepth(), project);
  expect(result.surfaceEvidence.removedTriangles).toBe(3);
  expect(result.surfaceEvidence.removedBranches).toBe(1);
  // The supported first vertex short-circuits the retained root faces.
  expect(result.surfaceEvidence.examinedVertices).toBe(4);
  expect(result.surfaceEvidence.depthProjections).toBeLessThan(30);
});
