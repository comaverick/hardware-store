import { depthFrameQuality, scanReadiness } from "./readiness";

const readyStats = {
  depthActive: true,
  depthCurrent: true,
  floorY: 0,
  fusionKeyframes: 6,
  cameraBaseline: 0.25,
  coverage: 50,
  stablePointCount: 1200,
};

test("does not call a sparse depth capture a complete room scan", () => {
  const result = scanReadiness({
    ...readyStats,
    floorY: null,
    fusionKeyframes: 2,
    cameraBaseline: 0.05,
    coverage: 17,
    stablePointCount: 300,
  });
  expect(result.ready).toBe(false);
  expect(result.missing).toEqual(
    expect.arrayContaining([
      "a detected floor",
      "six captured depth views",
      "25 cm of horizontal camera-position spread",
      "half of the camera heading sweep",
      "1,200 stable points",
    ]),
  );
});

test("enables room completion only after the capture preflight passes", () => {
  expect(scanReadiness(readyStats)).toEqual({ ready: true, missing: [] });
});

test("rejects fast, sparse, and obstructed depth frames before fusion", () => {
  expect(depthFrameQuality({
    validSamples: 800,
    totalSamples: 1000,
    angularSpeed: 1.1,
  }).reason).toBe("moving-too-fast");
  expect(depthFrameQuality({
    validSamples: 100,
    totalSamples: 1000,
  }).reason).toBe("sparse-depth");
  expect(depthFrameQuality({
    validSamples: 800,
    totalSamples: 1000,
    nearRatio: 0.45,
  }).reason).toBe("near-field-obstruction");
  expect(depthFrameQuality({
    validSamples: 800,
    totalSamples: 1000,
    angularSpeed: 0.2,
  }).accepted).toBe(true);
});
