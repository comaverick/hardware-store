import { scanDesignSourceKey } from "./scanDesignSurfaces";

export const FLOOR_ALIGNED_COORDINATES = "floor-aligned-v1";

// Raw camera poses, depth and plane footprints share capture coordinates.
// Finish all camera projection and surface preparation before translating the
// result. Geometry and its plane equations must receive the same translation.
const translatedPositions = (positions, floorY) => {
  const result = positions.slice();
  for (let i = 1; i < result.length; i += 3) result[i] -= floorY;
  return result;
};
const translatedPlane = (plane, floorY) => !plane?.normal?.length || !Number.isFinite(plane.offset)
  ? plane : { ...plane, offset: plane.offset - plane.normal[1] * floorY };
const translatedDiagnostics = (group, floorY) => !group ? group : {
  ...group, coordinateMode: FLOOR_ALIGNED_COORDINATES,
  ...(Array.isArray(group.planes) ? { planes: group.planes.map(p => translatedPlane(p, floorY)) } : {}),
};

export function alignFinishedScan(mesh, diagnostics, floorY = 0) {
  const result = { ...mesh, positions: translatedPositions(mesh.positions, floorY),
    coordinateMode: FLOOR_ALIGNED_COORDINATES, floorY,
    bounds: { min: { ...mesh.bounds.min, y: mesh.bounds.min.y - floorY },
      max: { ...mesh.bounds.max, y: mesh.bounds.max.y - floorY } },
    planarConsolidation: translatedDiagnostics(mesh.planarConsolidation, floorY) };
  const design = mesh.designSurfaces;
  if (design) result.designSurfaces = {
    ...design, sourceKey: scanDesignSourceKey(result),
    walls: design.walls.map(wall => ({ ...translatedPlane(wall, floorY),
      captureOffset: wall.captureOffset - wall.normal[1] * floorY,
      positions: translatedPositions(wall.positions, floorY) })),
    ceilings: (design.ceilings || []).map(ceiling => ({ ...translatedPlane(ceiling, floorY),
      positions: translatedPositions(ceiling.positions, floorY) })),
    fragments: { ...design.fragments, positions: translatedPositions(design.fragments.positions, floorY) },
  };
  return { mesh: result, diagnostics: { ...diagnostics,
    meshCoordinateMode: FLOOR_ALIGNED_COORDINATES,
    structuralDepth: translatedDiagnostics(diagnostics.structuralDepth, floorY),
    planarConsolidation: translatedDiagnostics(diagnostics.planarConsolidation, floorY),
    structuralRebuild: translatedDiagnostics(diagnostics.structuralRebuild, floorY),
  } };
}

// Older exports already translated mesh vertices but kept capture-space
// diagnostics. Their optional floor reference is enough to migrate equations.
export function planesForScanMesh(scan, group) {
  const planes = Array.isArray(group?.planes) ? group.planes : [];
  if (group?.coordinateMode === FLOOR_ALIGNED_COORDINATES) return planes;
  const floorY = [scan.mesh?.floorY, scan.rawCapture?.floorY, scan.cloud?.floorY].find(Number.isFinite) || 0;
  return planes.map(p => translatedPlane(p, floorY));
}
