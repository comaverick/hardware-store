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
    // WebXR tracking is a good starting pose, but the raw capture can still
    // accumulate centimetres of drift while the camera crosses a wall. The
    // fusion pass evaluates bounded corrections against held-out views. Depth
    // and independent RGB snapshots participate in the same pose pass.
    poseRefinement: "validated",
    // A correction still needs three consecutive, held-out-validated poses.
    // Permit the small change across that run seen when mobile tracking drift
    // settles, while rejecting isolated pose jumps.
    poseRefinementMaximumTrajectoryTranslationStep: 0.045,
    poseRefinementMaximumTrajectoryRotationStep: 0.04,
    requireCoherentSurfaceCore: false,
    preferCoherentSurfaceCore: true,
    rejectStructurallyInvalidSurface: false,
    // Bounded normal-only denoising preserves discontinuities and caps the
    // total displacement independently of the number of passes.
    smoothingPasses: completionMode === "surface" ? 1 : 3,
    // Keep all of the scanner's bounded depth path for a measured surface.
    maxKeyframes: completionMode === "surface" ? 60 : 40,
    depthType: raw?.stats?.depthType || raw?.depthType || "",
    ...extra,
  };
}
