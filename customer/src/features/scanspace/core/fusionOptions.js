import { FLOOR_OUTLIER_TOLERANCE_METERS } from "./readiness";

// One option builder is shared by live completion and raw-file import. This
// keeps both paths on the same geometry, depth, and texture rules.
export function scanFusionOptions(raw, completionMode = "surface", extra = {}) {
  return {
    textureKeyframes: raw?.textureKeyframes || [],
    maxTextureSize: raw?.maxTextureSize || 4096,
    floorY: raw?.floorY,
    observer: raw?.observer,
    headingCoverage: raw?.stats?.coverage || raw?.captureQuality?.coverage || 0,
    completionMode,
    reconstructionProfile: "quality",
    floorOutlierTolerance: FLOOR_OUTLIER_TOLERANCE_METERS,
    pruneUnsupportedBridges: true,
    // WebXR supplies one tracked coordinate system. Pairwise ICP on a mostly
    // flat wall is under-constrained and can curl an otherwise straight wall.
    poseRefinement: "native-tracking",
    requireCoherentSurfaceCore: false,
    preferCoherentSurfaceCore: true,
    rejectStructurallyInvalidSurface: false,
    smoothingPasses: 3,
    ...extra,
  };
}

