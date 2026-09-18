import { refineFramePoses, refineTrajectoryPoses } from './fusion';

function plane(frameId, x, drift = 0, timestamp = frameId * 100) {
  const columns = 24, rows = 24, positions = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++)
    positions.push(x + ((col + 0.5) / columns * 2 - 1) * 2,
      (1 - (row + 0.5) / rows * 2) * 2, -2 + drift);
  const transformMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, drift, 1]);
  return {
    frameId, timestamp, columns, rows, positions: new Float32Array(positions),
    projectionMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]),
    transformMatrix, viewTransformMatrix: transformMatrix.slice(), camera: new Float32Array([x, 0, drift]),
    filteredCount: columns * rows, filteredDepth: new Float32Array(columns * rows).fill(2),
    measuredMask: new Uint8Array(columns * rows).fill(1),
  };
}

test('same-capture depth and independent RGB get exactly the same held-out-validated correction', () => {
  const depth = plane(2, 0.02, 0.035, 200);
  const photo = { ...plane(10, 0.02, 0.035, 200), textureOnly: true, colorImage: new Uint8Array([250, 20, 80, 255]) };
  const original = depth.transformMatrix.slice();
  const input = [plane(0, -0.16), plane(1, -0.08), depth, photo, plane(3, 0.1), plane(4, 0.18)];
  const result = refineFramePoses(input, { minimumTrajectorySupport: 1 });
  const correctedDepth = result.frames.find((f) => f.frameId === 2);
  const correctedPhoto = result.frames.find((f) => f.frameId === 10);
  expect(Math.abs(correctedDepth.transformMatrix[14])).toBeLessThan(0.008);
  expect(correctedPhoto.transformMatrix).toEqual(correctedDepth.transformMatrix);
  expect(correctedPhoto.viewTransformMatrix).toEqual(correctedDepth.viewTransformMatrix);
  expect(correctedPhoto.positions).toEqual(correctedDepth.positions);
  expect(correctedPhoto.colorImage).toBe(photo.colorImage);
  expect(depth.transformMatrix).toEqual(original);
  expect(photo.transformMatrix).toEqual(original);
  expect(result.diagnostics.corrections.find((c) => c.frameId === 2).heldOutViews).toBeGreaterThanOrEqual(2);
});

test('an isolated pairwise correction cannot tear the native camera trajectory', () => {
  const target = plane(2, 0.02, 0.035, 200);
  const input = [plane(0, -0.16), plane(1, -0.08), target, plane(3, 0.1), plane(4, 0.18)];
  const result = refineFramePoses(input);
  expect(result.frames[2].transformMatrix).toEqual(target.transformMatrix);
  expect(result.diagnostics.corrected).toBe(0);
  expect(result.diagnostics.rejectedTrajectory).toBeGreaterThan(0);
});

test('an attractive pairwise fit contradicted by other views does not move a good frame', () => {
  const target = plane(2, 0.02);
  const result = refineFramePoses([plane(0, -0.16, 0.045), plane(1, -0.08), target, plane(3, 0.1), plane(4, 0.18)]);
  expect(result.frames[2].transformMatrix).toEqual(target.transformMatrix);
  expect(result.diagnostics.rejectedValidation).toBeGreaterThan(0);
});

test('insufficient pose evidence keeps both observations rather than blocking a partial scan', () => {
  const input = [plane(0, 0), plane(1, 0.1, 0.035)];
  const result = refineFramePoses(input);
  expect(result.frames).toHaveLength(2);
  expect(result.diagnostics.corrected).toBe(0);
  expect(result.frames[1].transformMatrix).toEqual(input[1].transformMatrix);
});

test('joint registration improves independent overlap while sharing one correction with RGB', () => {
  const input = Array.from({ length: 9 }, (_, i) => plane(i, (i - 4) * 0.1, Math.sin(i * 0.45) * 0.045));
  const photo = { ...input[4], frameId: 99, textureOnly: true, colorImage: new Uint8Array([250, 20, 80, 255]) };
  const originals = input.map(frame => frame.transformMatrix.slice());
  const result = refineTrajectoryPoses([...input, photo]);
  expect(result.diagnostics.captures).toBe(9);
  expect(result.diagnostics.accepted).toBe(true);
  expect(result.diagnostics.afterMeters).toBeLessThan(result.diagnostics.beforeMeters * 0.94);
  expect(result.diagnostics.heldOutSamples).toBeGreaterThan(100);
  expect(result.diagnostics.maxTranslationMeters).toBeLessThanOrEqual(0.09);
  expect(result.diagnostics.maxRotationRadians).toBeLessThanOrEqual(0.06);
  expect(result.frames[4].transformMatrix).toEqual(result.frames[9].transformMatrix);
  expect(result.frames[4].viewTransformMatrix).toEqual(result.frames[9].viewTransformMatrix);
  expect(result.frames[9].colorImage).toBe(photo.colorImage);
  input.forEach((frame, i) => expect(frame.transformMatrix).toEqual(originals[i]));
});

test('joint registration leaves an already aligned plane and its unconstrained lateral motion alone', () => {
  const input = Array.from({ length: 7 }, (_, i) => plane(i, i * 0.1));
  const result = refineTrajectoryPoses(input);
  expect(result.diagnostics.accepted).toBe(false);
  expect(result.frames).toBe(input);
});

test('joint registration never aligns unrelated surfaces or unsupported pairs', () => {
  const input = Array.from({ length: 6 }, (_, i) => plane(i, i * 2, i * 0.3));
  const result = refineTrajectoryPoses(input);
  expect(result.diagnostics.accepted).toBe(false);
  expect(result.frames).toBe(input);
  expect(refineTrajectoryPoses(input.slice(0, 2)).frames).toEqual(input.slice(0, 2));
});
