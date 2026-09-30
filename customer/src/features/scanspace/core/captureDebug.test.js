import { snapshotDepthCapture, restoreDepthCapture, CaptureRuntimeDiagnostics,
  captureDebugEnabled, installCaptureRuntimeDebug } from "./captureDebug";
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

describe("runtime diagnostics", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    delete window.scanspaceDebug;
  });

  test("are opt-in and available before any views are saved", () => {
    expect(captureDebugEnabled()).toBe(false);
    window.history.replaceState({}, "", "/?scanspaceDebug=1");
    expect(captureDebugEnabled()).toBe(true);
    const diagnostics = new CaptureRuntimeDiagnostics();
    diagnostics.update({ fusionKeyframes: 0, xrFrames: 12, depthReads: 4,
      nativeDepthActive: false, depthFailureKind: "depth-missing" });
    installCaptureRuntimeDebug(diagnostics);
    expect(window.scanspaceDebug.snapshot().state).toMatchObject({
      fusionKeyframes: 0, xrFrames: 12, depthReads: 4, nativeDepthActive: false,
      depthFailureKind: "depth-missing",
    });
  });

  test("stay bounded and exclude camera data", () => {
    const diagnostics = new CaptureRuntimeDiagnostics();
    diagnostics.update({ features: ["depth-sensing"], positions: [1, 2, 3], colorImage: [255] });
    for (let index = 0; index < 70; index++) diagnostics.record("error", index * 100, {
      stage: "Depth read failed", name: "InvalidStateError", message: "failure".repeat(100),
      positions: [1, 2, 3], colorImage: [255],
    });
    const snapshot = diagnostics.snapshot();
    expect(snapshot.events).toHaveLength(48);
    expect(snapshot.errorCount).toBe(70);
    expect(snapshot.events[0].message.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(snapshot)).not.toMatch(/positions|colorImage/);
    snapshot.events[0].message = "modified";
    snapshot.state.xrFrames = 999;
    expect(diagnostics.snapshot().events[0].message).not.toBe("modified");
    expect(diagnostics.snapshot().state.xrFrames).not.toBe(999);
  });

  test("a fresh session does not retain the old session's callbacks", () => {
    const first = new CaptureRuntimeDiagnostics();
    installCaptureRuntimeDebug(first);
    const previous = window.scanspaceDebug;
    const second = new CaptureRuntimeDiagnostics();
    second.update({ fusionKeyframes: 0 });
    installCaptureRuntimeDebug(second);
    first.update({ fusionKeyframes: 9 });
    expect(window.scanspaceDebug.snapshot().state.fusionKeyframes).toBe(0);
    expect(previous.snapshot().state.fusionKeyframes).toBe(9);
  });
});
