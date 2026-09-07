export function scanReadiness(stats) {
  const missing = [];
  if (!stats.depthActive || !stats.depthCurrent) missing.push("live depth");
  if (!Number.isFinite(stats.floorY)) missing.push("a detected floor");
  if ((stats.fusionKeyframes || 0) < 6)
    missing.push("six captured depth views");
  if ((stats.coverage || 0) < 50)
    missing.push("half of the camera heading sweep");
  if ((stats.stablePointCount || 0) < 1200)
    missing.push("1,200 stable points");
  return { ready: missing.length === 0, missing };
}
