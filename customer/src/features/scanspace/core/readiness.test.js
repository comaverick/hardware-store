import {
  depthFrameQuality,
  scanReadiness,
  surfaceScanReadiness,
} from "./readiness";

const readyStats = {
  depthActive: true,
  depthCurrent: true,
  floorY: 0,
  fusionKeyframes: 12,
  cameraBaseline: 0.4,
  coverage: 75,
  stablePointCount: 2000,
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
      "12 translated or clearly separated depth views",
      "40 cm of horizontal camera-position spread",
      "three quarters of the camera heading sweep",
      "2,000 independently observed surface points",
    ]),
  );
});

test("enables room completion only after the capture preflight passes", () => {
  expect(scanReadiness(readyStats)).toEqual({ ready: true, missing: [] });
});

test("allows a well-observed surface without requiring a complete room sweep", () => {
  expect(surfaceScanReadiness({
    ...readyStats,
    floorY: null,
    fusionKeyframes: 6,
    cameraBaseline: 0.25,
    coverage: 25,
    stablePointCount: 800,
  })).toEqual({ ready: true, missing: [] });
});

test("does not allow a single weak view to finish as a surface", () => {
  const result = surfaceScanReadiness({
    ...readyStats,
    fusionKeyframes: 1,
    cameraBaseline: 0.02,
    stablePointCount: 200,
  });
  expect(result.ready).toBe(false);
  expect(result.missing).toEqual(expect.arrayContaining([
    "6 translated or clearly separated depth views",
    "25 cm of horizontal camera-position spread",
    "800 independently observed surface points",
  ]));
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
