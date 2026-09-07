import { scanReadiness } from "./readiness";

const readyStats = {
  depthActive: true,
  depthCurrent: true,
  floorY: 0,
  fusionKeyframes: 6,
  coverage: 50,
  stablePointCount: 1200,
};

test("does not call a sparse depth capture a complete room scan", () => {
  const result = scanReadiness({
    ...readyStats,
    floorY: null,
    fusionKeyframes: 2,
    coverage: 17,
    stablePointCount: 300,
  });
  expect(result.ready).toBe(false);
  expect(result.missing).toEqual(
    expect.arrayContaining([
      "a detected floor",
      "six captured depth views",
      "half of the camera heading sweep",
      "1,200 stable points",
    ]),
  );
});

test("enables room completion only after the capture preflight passes", () => {
  expect(scanReadiness(readyStats)).toEqual({ ready: true, missing: [] });
});
