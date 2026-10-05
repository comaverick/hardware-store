import { buildScanDesignSurfaces, validScanDesignSurfaces } from "./scanDesignSurfaces";
import { prepareScanCeiling } from "./scanCeilingPreparation";
import { alignFinishedScan } from "./scanCoordinates";
import { parsePartialScan, serializePartialScan } from "./partialScanFile";
import { surfaceTopologyDiagnostics } from "./surfaceTopology";
function fixture({
  stationary = false,
  fixtureDetail = false,
  alternateLevel = false,
  opening = false
} = {}) {
  const positions = [],
    normals = [],
    colors = [],
    indices = [],
    size = 1.2,
    cell = .04;
  for (let z = 0; z < 30; z++) for (let x = 0; x < 30; x++) {
    if (opening && x >= 12 && x < 18 && z >= 12 && z < 18) continue;
    const i = positions.length / 3;
    for (const [dx, dz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      positions.push((x + dx) * cell, 2.6 + .08 * Math.sin((x + dx) * .3), (z + dz) * cell);
      normals.push(0, -1, 0);
      colors.push(160, 160, 150);
    }
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  const frames = [0, 1, 2].map(frameId => {
    const camera = [stationary ? 0 : frameId * .12, 1, .6];
    const transformMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...camera, 1]);
    return {
      frameId,
      camera,
      transformMatrix,
      columns: 30,
      rows: 30,
      colorWidth: 8,
      colorHeight: 8,
      colorImage: new Uint8Array(8 * 8 * 4).fill(180),
      measuredMask: new Uint8Array(900).fill(1),
      filteredDepth: new Float32Array(900).fill(alternateLevel ? 1.85 : 1.6 + frameId * .025)
    };
  });
  const mesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    floorY: 0,
    bounds: {
      min: {
        x: 0,
        y: 2.5,
        z: 0
      },
      max: {
        x: size,
        y: 2.7,
        z: size
      }
    }
  };
  const helpers = {
    project: (f, x, y, z) => ({
      u: x / size,
      v: z / size,
      depth: y - 1
    }),
    unproject: (f, i, d) => [(i % 30 + .5) * cell, 1 + d, (Math.floor(i / 30) + .5) * cell],
    sampleColor: (f, uv) => fixtureDetail && uv.u > .4 && uv.u < .6 && uv.v > .4 && uv.v < .6 ? [15, 15, 15] : [180, 178, 170]
  };
  return {
    mesh,
    frames,
    helpers
  };
}
test("bent photographed ceiling has a connected flat preview while captured geometry stays intact", () => {
  const {
      mesh,
      frames,
      helpers
    } = fixture(),
    original = mesh.positions.slice(),
    indices = mesh.indices.slice();
  const design = buildScanDesignSurfaces(mesh, [], frames, helpers);
  expect(design.walls).toHaveLength(0);
  expect(design.ceilings).toHaveLength(1);
  const ceiling = design.ceilings[0],
    topology = surfaceTopologyDiagnostics(ceiling);
  expect(topology.componentCount).toBe(1);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.windingConflicts).toBe(0);
  const ys = Array.from(ceiling.positions).filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(0);
  expect(ceiling.estimatedTriangleMask.every(Boolean)).toBe(true);
  expect(ceiling.estimatedArea).toBe(ceiling.area);
  expect(design.removedSourceFaces.some(Boolean)).toBe(true);
  expect(mesh.positions).toEqual(original);
  expect(mesh.indices).toEqual(indices);
});
test("photographed fixtures and observed ceiling openings keep their captured footprint", () => {
  const {
    mesh,
    frames,
    helpers
  } = fixture({
    fixtureDetail: true,
    opening: true
  });
  const removed = new Uint8Array(mesh.indices.length / 3),
    result = prepareScanCeiling(mesh, frames, helpers, removed);
  expect(result).not.toBeNull();
  const ceiling = result.surface;
  for (let f = 0; f < ceiling.indices.length / 3; f++) {
    const points = [0, 1, 2].map(c => ceiling.indices[f * 3 + c] * 3);
    const x = points.reduce((s, i) => s + ceiling.positions[i] / 3, 0),
      z = points.reduce((s, i) => s + ceiling.positions[i + 2] / 3, 0);
    expect(x > .48 && x < .72 && z > .48 && z < .72).toBe(false);
  }
  expect(removed.some(v => !v)).toBe(true);
});
test.each(["stationary", "alternateLevel"])("%s observations do not authorize a ceiling replacement", kind => {
  const {
      mesh,
      frames,
      helpers
    } = fixture({
      [kind]: true
    }),
    removed = new Uint8Array(mesh.indices.length / 3);
  expect(prepareScanCeiling(mesh, frames, helpers, removed)).toBeNull();
  expect(removed.some(Boolean)).toBe(false);
});
test("missing photographs leave the measured ceiling available", () => {
  const {
    mesh,
    frames,
    helpers
  } = fixture();
  frames.forEach(f => {
    f.colorImage = null;
  });
  expect(prepareScanCeiling(mesh, frames, helpers, new Uint8Array(mesh.indices.length / 3))).toBeNull();
});
test("prepared ceiling and its estimate survive floor alignment and portable export", () => {
  const {
    mesh,
    frames,
    helpers
  } = fixture();
  mesh.designSurfaces = buildScanDesignSurfaces(mesh, [], frames, helpers);
  const finished = alignFinishedScan(mesh, {}, -.27).mesh;
  expect(validScanDesignSurfaces(finished.designSurfaces, finished)).toBe(true);
  const restored = parsePartialScan(serializePartialScan({
    mesh: finished
  })).mesh;
  expect(restored.designSurfaces.ceilings[0].positions).toEqual(finished.designSurfaces.ceilings[0].positions);
  expect(restored.designSurfaces.ceilings[0].texture).toEqual(finished.designSurfaces.ceilings[0].texture);
  expect(restored.designSurfaces.ceilings[0].estimatedTriangleMask.every(Boolean)).toBe(true);
});
function addFin(mesh, x = .3, z = .3) {
  const id = mesh.positions.length / 3;
  mesh.positions = new Float32Array([...mesh.positions, x, 2.55, z, x + .02, 2.85, z, x, 2.55, z + .02]);
  mesh.normals = new Float32Array([...mesh.normals, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  mesh.colors = new Uint8Array([...mesh.colors, ...new Uint8Array(9).fill(160)]);
  mesh.indices = new Uint32Array([...mesh.indices, id, id + 1, id + 2]);
  mesh.uvs = Float32Array.from({
    length: mesh.positions.length / 3 * 2
  }, (_, i) => mesh.positions[Math.floor(i / 2) * 3 + (i % 2 ? 2 : 0)] / 1.2);
  return mesh.indices.length / 3 - 1;
}
test("the local ceiling cutaway interpolates photographed boundaries without clipping stable higher levels", () => {
  const {
      mesh,
      frames,
      helpers
    } = fixture(),
    fin = addFin(mesh),
    original = mesh.positions.slice();
  const removed = new Uint8Array(mesh.indices.length / 3),
    result = prepareScanCeiling(mesh, frames, helpers, removed);
  const clipped = result.fragments.filter(fragment => fragment.face === fin);
  expect(removed[fin]).toBe(1);
  expect(clipped.length).toBeGreaterThan(0);
  for (const fragment of clipped) for (const p of fragment.points) {
    expect(p.p[1]).toBeLessThanOrEqual(result.diagnostics.height + .025 + 1e-7);
    expect(p.uv[0]).toBeCloseTo(p.p[0] / 1.2, 6);
    expect(p.uv[1]).toBeCloseTo(p.p[2] / 1.2, 6);
  }
  expect(mesh.positions).toEqual(original);
  const other = fixture(),
    stable = addFin(other.mesh, .55, .55);
  for (const f of other.frames) for (let z = 12; z < 18; z++) for (let x = 12; x < 18; x++) f.filteredDepth[z * 30 + x] = 1.85;
  const protectedFaces = new Uint8Array(other.mesh.indices.length / 3);
  expect(prepareScanCeiling(other.mesh, other.frames, other.helpers, protectedFaces)).not.toBeNull();
  expect(protectedFaces[stable]).toBe(0);
});
test("independently observed free space cannot be filled by a ceiling color match", () => {
  const {
    mesh,
    frames,
    helpers
  } = fixture();
  for (const f of frames) {
    f.freeSpaceMask = new Uint8Array(900).fill(1);
    for (let z = 14; z < 16; z++) for (let x = 14; x < 16; x++) f.filteredDepth[z * 30 + x] = 2.6;
  }
  const result = prepareScanCeiling(mesh, frames, helpers, new Uint8Array(mesh.indices.length / 3));
  expect(result).not.toBeNull();
  for (let face = 0; face < result.surface.indices.length / 3; face++) {
    const points = [0, 1, 2].map(c => result.surface.indices[face * 3 + c] * 3);
    const x = points.reduce((s, i) => s + result.surface.positions[i] / 3, 0),
      z = points.reduce((s, i) => s + result.surface.positions[i + 2] / 3, 0);
    expect(x > .56 && x < .64 && z > .56 && z < .64).toBe(false);
  }
});
