export const MIN_CAMERA_BASELINE_METERS = 0.4;
export const MIN_DIRECTION_COVERAGE = 75;
export const MIN_FUSION_KEYFRAMES = 12;
export const MIN_STABLE_POINTS = 2000;
export const MIN_SURFACE_CAMERA_BASELINE_METERS = 0.25;
export const MIN_SURFACE_FUSION_KEYFRAMES = 6;
export const MIN_SURFACE_STABLE_POINTS = 800;
// Allow a hit-test floor to be a little noisy, but never fuse points that are
// far enough below it to be a plausible wall/floor measurement.
export const FLOOR_OUTLIER_TOLERANCE_METERS = 0.45;
// A depth sample is captured every few hundred milliseconds. At the old
// limits a phone could translate many centimetres between samples, so the
// resulting color frame was often motion-blurred and its geometry disagreed
// with the neighboring pose. Keep only deliberately slow views.
export const MAX_CAPTURE_LINEAR_SPEED = 0.45;
export const MAX_CAPTURE_ANGULAR_SPEED = 0.6;
// Geometry can still be useful while the phone is moving moderately, but a
// camera image captured at that speed becomes a smeared texture. Keep the
// depth keyframe and omit only its colors until the phone is steadier.
export const MAX_COLOR_CAPTURE_LINEAR_SPEED = 0.22;
export const MAX_COLOR_CAPTURE_ANGULAR_SPEED = 0.32;

export function depthFrameQuality({
  validSamples = 0,
  totalSamples = 0,
  nearRatio = 0,
  obstructionRatio = nearRatio,
  linearSpeed = 0,
  angularSpeed = 0,
} = {}) {
  const validRatio = validSamples / Math.max(1, totalSamples);
  if (
    linearSpeed > MAX_CAPTURE_LINEAR_SPEED ||
    angularSpeed > MAX_CAPTURE_ANGULAR_SPEED
  )
    return { accepted: false, reason: "moving-too-fast", validRatio };
  if (validRatio < 0.2)
    return { accepted: false, reason: "sparse-depth", validRatio };
  if (obstructionRatio > 0.3)
    return { accepted: false, reason: "near-field-obstruction", validRatio };
  return { accepted: true, reason: "accepted", validRatio };
}

export function scanReadiness(stats) {
  const missing = [];
  if (!stats.depthActive || !stats.depthCurrent) missing.push("live depth");
  if (!Number.isFinite(stats.floorY)) missing.push("a detected floor");
  if ((stats.fusionKeyframes || 0) < MIN_FUSION_KEYFRAMES)
    missing.push("12 translated or clearly separated depth views");
  if ((stats.cameraBaseline || 0) < MIN_CAMERA_BASELINE_METERS)
    missing.push("40 cm of horizontal camera-position spread");
  if ((stats.coverage || 0) < MIN_DIRECTION_COVERAGE)
    missing.push("three quarters of the camera heading sweep");
  if ((stats.stablePointCount || 0) < MIN_STABLE_POINTS)
    missing.push("2,000 independently observed surface points");
  return { ready: missing.length === 0, missing };
}

export function surfaceScanReadiness(stats) {
  const missing = [];
  if (!stats.depthActive || !stats.depthCurrent) missing.push("live depth");
  if ((stats.fusionKeyframes || 0) < MIN_SURFACE_FUSION_KEYFRAMES)
    missing.push("6 translated or clearly separated depth views");
  if ((stats.cameraBaseline || 0) < MIN_SURFACE_CAMERA_BASELINE_METERS)
    missing.push("25 cm of horizontal camera-position spread");
  if ((stats.stablePointCount || 0) < MIN_SURFACE_STABLE_POINTS)
    missing.push("800 independently observed surface points");
  return { ready: missing.length === 0, missing };
}
