export const MIN_CAMERA_BASELINE_METERS = 0.25;

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
  if ((stats.fusionKeyframes || 0) < 6)
    missing.push("six captured depth views");
  if ((stats.cameraBaseline || 0) < MIN_CAMERA_BASELINE_METERS)
    missing.push("25 cm of horizontal camera-position spread");
  if ((stats.coverage || 0) < 50)
    missing.push("half of the camera heading sweep");
  if ((stats.stablePointCount || 0) < 1200)
    missing.push("1,200 stable points");
  return { ready: missing.length === 0, missing };
}
