import {
  DEFAULT_COLOR_LONG_EDGE,
  DEFAULT_COLOR_SHORT_EDGE,
  measureColorFrameQuality,
} from "./cameraColor";

test("camera color capture keeps a higher-detail but bounded default", () => {
  expect(DEFAULT_COLOR_LONG_EDGE).toBeGreaterThan(640);
  expect(DEFAULT_COLOR_LONG_EDGE).toBeLessThanOrEqual(1024);
  expect(DEFAULT_COLOR_SHORT_EDGE).toBeLessThan(DEFAULT_COLOR_LONG_EDGE);
});

test("color quality distinguishes detail from a flat frame", () => {
  const flat = new Uint8Array(
    Array(64)
      .fill([120, 120, 120, 255])
      .flat(),
  );
  const checker = new Uint8Array(
    Array.from({ length: 64 }, (_, index) => {
      const value = (index + Math.floor(index / 8)) % 2 ? 30 : 225;
      return [value, value, value, 255];
    }).flat(),
  );
  const flatQuality = measureColorFrameQuality(flat, 8, 8);
  const checkerQuality = measureColorFrameQuality(checker, 8, 8);
  expect(checkerQuality.sharpness).toBeGreaterThan(flatQuality.sharpness);
  expect(checkerQuality.focus).toBeGreaterThan(flatQuality.focus);
  expect(flatQuality.clippedRatio).toBe(0);
});

test("color quality reports clipped camera content", () => {
  const pixels = new Uint8Array(
    Array(16)
      .fill([255, 255, 255, 255])
      .flat(),
  );
  const quality = measureColorFrameQuality(pixels, 4, 4);
  expect(quality.clippedRatio).toBe(1);
  expect(quality.sharpness).toBe(0);
  expect(quality.focus).toBe(0);
});
