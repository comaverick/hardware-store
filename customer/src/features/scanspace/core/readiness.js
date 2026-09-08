export const MIN_CAMERA_BASELINE_METERS = 0.4;
export const MIN_DIRECTION_COVERAGE = 75;
export const MIN_FUSION_KEYFRAMES = 12;
export const MIN_STABLE_POINTS = 2000;
export const MIN_SURFACE_CAMERA_BASELINE_METERS = 0.25;
export const MIN_SURFACE_FUSION_KEYFRAMES = 6;
export const MIN_SURFACE_STABLE_POINTS = 800;

export function depthFrameQuality({
  validSamples = 0,
  totalSamples = 0,
  nearRatio = 0,
  linearSpeed = 0,
  angularSpeed = 0,
} = {}) {
  const validRatio = validSamples / Math.max(1, totalSamples);
  if (linearSpeed > 0.75 || angularSpeed > 0.8)
    return { accepted: false, reason: "moving-too-fast", validRatio };
  if (validRatio < 0.2)
    return { accepted: false, reason: "sparse-depth", validRatio };
  if (nearRatio > 0.3)
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
