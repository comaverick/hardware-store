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
  expect(parsed.version).toBe(4);
  expect(parsed.geometrySchemaVersion).toBe(1);
  expect(parsed.coordinateMode).toBe("view-aligned-v1");
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
  expect(restored.keyframes[0].legacyGeometryAmbiguous).toBe(false);
});

test("flags legacy transformed-UV captures instead of silently reinterpreting them", () => {
  const count = 4;
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const restored = restoreDepthCapture({
    version: 3,
    keyframes: [{
      columns: 2,
      rows: 2,
      depths: Array(count).fill(2),
      positions: Array(count * 3).fill(0),
      depthUvs: Array(count * 2).fill(0.5),
      projectionMatrix: identity,
      transformMatrix: identity,
    }],
  });
  expect(restored.keyframes[0].geometryMode).toBe(
    "legacy-depth-uv-ambiguous",
  );
  expect(restored.keyframes[0].legacyGeometryAmbiguous).toBe(true);
});

test("rejects malformed replay dimensions before reconstruction allocates geometry", () => {
  expect(() => restoreDepthCapture({ keyframes: [{ columns: 999999, rows: 999999 }] }))
    .toThrow(/dimensions/);
});
