import { snapshotDepthCapture, restoreDepthCapture } from "./captureDebug";
import { createRgbdKeyframe } from "./fusion";

const readBlob = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsText(blob);
});

test("debug snapshot survives live buffers changing and restores missing positions for replay", async () => {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const frame = createRgbdKeyframe(Array.from({ length: 8 }, (_, index) => ({
    x: index % 3, y: Math.floor(index / 3), z: -2, depth: 2,
    gridX: index % 3, gridY: Math.floor(index / 3),
    color: [180, 120, 90],
  })), { columns: 3, rows: 3, projectionMatrix: matrix, transformMatrix: matrix });
  const blob = snapshotDepthCapture({ keyframes: [frame], stats: {}, floorY: 0 });
  frame.depths.fill(0);
  frame.positions.fill(0);
  const parsed = JSON.parse(await readBlob(blob));
  const restored = restoreDepthCapture({ capture: parsed, diagnostics: {} });
  expect(restored.keyframes[0].depths[0]).toBe(2);
  expect(restored.keyframes[0].validCount).toBe(8);
  expect(restored.keyframes[0].positions[2]).toBe(-2);
  expect(Number.isNaN(restored.keyframes[0].positions[26])).toBe(true);
  expect(restored.keyframes[0].colorImage).toBeNull();
  expect(restored.keyframes[0].viewProjectionMatrix).toEqual(
    restored.keyframes[0].projectionMatrix,
  );
  expect(restored.keyframes[0].viewTransformMatrix).toEqual(
    restored.keyframes[0].transformMatrix,
  );
  expect(restored.options.floorY).toBe(0);
});

test("rejects malformed replay dimensions before reconstruction allocates geometry", () => {
  expect(() => restoreDepthCapture({ keyframes: [{ columns: 999999, rows: 999999 }] }))
    .toThrow(/dimensions/);
});
