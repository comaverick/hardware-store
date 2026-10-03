import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { unprojectDepth } from './depth';
import { createRgbdKeyframe, projectWorld } from './fusion';
import { repairCeilingRegions } from './ceilingRecovery';

const ceilingHeight = 2.6, columns = 64, rows = 64;
const camera = new PerspectiveCamera(70, 1, .1, 10);
const projection = [...camera.projectionMatrix.elements];
projection[8] = .08;
projection[9] = -.04;
const inverse = new Matrix4().fromArray(projection).invert();
const clamp = (v, minimum, maximum) => Math.max(minimum, Math.min(maximum, v));
const poseAt = x => new Matrix4().makeRotationX(Math.PI / 2).setPosition(x, 1.4, 0);
const pointAt = (frame, i) => Array.from(frame.positions.subarray(i * 3, i * 3 + 3));
const changed = (before, after, i) => Math.hypot(...pointAt(after, i)
  .map((v, axis) => v - before.positions[i * 3 + axis])) > 1e-5;

function ceilingPoint(pose, u, v) {
  const origin = new Vector3().setFromMatrixPosition(pose);
  const ray = new Vector3(u * 2 - 1, 1 - v * 2, .5).applyMatrix4(inverse);
  ray.multiplyScalar(1 / -ray.z).applyMatrix4(pose).sub(origin);
  return { origin, ray, point: ray.clone().multiplyScalar((ceilingHeight - origin.y) / ray.y).add(origin) };
}

function featureAt(point, scene) {
  if (scene === 'dark-fixture' && point.x > .05 && point.x < .45 && point.z > .05 && point.z < .45)
    return 'fixture';
  if (scene === 'trim' && point.x > -.05 && point.z > .48 && point.z < .67) return 'trim';
  if (scene === 'higher-ceiling' && point.x > .3 && point.z < -.3) return 'higher';
  if (scene === 'thin-white-trim' && point.x > .0435 && point.x < .0515) return 'white-trim';
  return 'ceiling';
}

function colorAt(point, scene) {
  const feature = featureAt(point, scene);
  if (feature === 'fixture') return [25, 25, 25];
  if (feature === 'trim') return [68, 68, 68];
  if (feature === 'white-trim') return [250, 250, 250];
  const value = Math.round(180 + clamp(point.x * 7 + point.z * 3, -12, 12));
  return [value, value, value];
}

function makeFrame(frameId, cameraX, bias, scene) {
  const pose = poseAt(cameraX);
  const depthAt = (u, v) => {
    const { origin, ray, point } = ceilingPoint(pose, u, v);
    const feature = featureAt(point, scene);
    let height = ceilingHeight + bias * clamp((point.x + .5) / .4, 0, 1);
    // Fixture/trim depths also vary between views: their photograph must
    // protect them independently of the stable-height veto.
    if (feature === 'fixture') height -= .25;
    if (feature === 'trim') height -= .14;
    if (feature === 'higher') height = ceilingHeight + .3;
    return (height - origin.y) / ray.y;
  };
  const points = unprojectDepth({ getDepthInMeters: depthAt }, {
    projectionMatrix: projection, transform: { matrix: pose.elements },
  }, columns, rows, (u, v) => colorAt(ceilingPoint(pose, u, v).point, scene));
  const width = columns * 2, height = rows * 2, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Captured RGBA follows the application's bottom-up image convention.
    const rgb = colorAt(ceilingPoint(pose, (x + .5) / width, 1 - (y + .5) / height).point, scene);
    data.set([...rgb, 255], (y * width + x) * 4);
  }
  const frame = createRgbdKeyframe(points, { columns, rows,
    projectionMatrix: projection, transformMatrix: pose.elements,
    colorImage: { data, width, height, channels: 4 },
  });
  return { ...frame, frameId, filteredDepth: frame.depths.slice(),
    measuredMask: new Uint8Array(columns * rows).fill(1),
    freeSpaceMask: new Uint8Array(columns * rows).fill(1),
    depthConfidence: new Uint8Array(columns * rows).fill(255),
  };
}

function fixture({ scene = 'plain', biases = [.16, -.12, .26], cameras = [-.16, 0, .16] } = {}) {
  const frames = cameras.map((x, i) => makeFrame(i, x, biases[i], scene));
  const plane = { kind: 'ceiling', normal: [0, 1, 0], offset: ceilingHeight,
    axes: [[1, 0, 0], [0, 0, 1]], cellSize: .12, cells: new Map(),
    minimumCellViews: 3, supportingFrameIds: frames.map(frame => frame.frameId), area: .5184,
  };
  // Only the left strip is initially supported at the correct height.
  for (let x = -7; x <= -5; x++) for (let z = -6; z <= 5; z++)
    plane.cells.set(`${x},${z}`, new Set(frames.map(frame => frame.frameId)));
  const indicesAt = (frame, predicate) => Array.from({ length: columns * rows }, (_, i) => i)
    .filter(i => predicate(ceilingPoint(new Matrix4().fromArray(frame.transformMatrix),
      (i % columns + .5) / columns, (Math.floor(i / columns) + .5) / rows).point));
  return { frames, plane, helpers: { project: projectWorld }, indicesAt };
}
const repair = f => repairCeilingRegions(f.frames, [f.plane], f.helpers);

test('translated photos repair differing ceiling depth while preserving source rays and captured arrays', () => {
  const f = fixture();
  const snapshots = f.frames.map(frame => Object.fromEntries(['positions', 'filteredDepth', 'measuredMask',
    'freeSpaceMask', 'depthConfidence', 'colors', 'colorMask', 'colorImage'].map(key => [key, frame[key].slice()])));
  const result = repair(f);
  expect(result.diagnostics.correctedSamples).toBeGreaterThan(500);
  expect(result.diagnostics.maxDisplacementMeters).toBeGreaterThan(.1);
  expect(result.diagnostics.maxDisplacementMeters).toBeLessThanOrEqual(.72);
  f.frames.forEach((before, index) => {
    const after = result.frames[index];
    for (const [key, original] of Object.entries(snapshots[index])) expect(before[key]).toEqual(original);
    expect(after.originalPositions).toBe(before.positions);
    expect(after.originalFilteredDepth).toBe(before.filteredDepth);
    expect(after.colorImage).toBe(before.colorImage);
    expect(after.colors).toBe(before.colors);
    expect(after.projectionMatrix).toBe(before.projectionMatrix);
    expect(after.transformMatrix).toBe(before.transformMatrix);
    let repaired = 0, wrongPixels = 0, unsafeRays = 0;
    let maximumUvError = 0, maximumDepthError = 0, maximumHeightError = 0;
    for (let i = 0; i < before.filteredDepth.length; i++) if (changed(before, after, i)) {
      const a = projectWorld(before, ...pointAt(before, i)), b = projectWorld(after, ...pointAt(after, i));
      maximumUvError = Math.max(maximumUvError, Math.abs(a.u - b.u), Math.abs(a.v - b.v));
      maximumDepthError = Math.max(maximumDepthError, Math.abs(b.depth - after.filteredDepth[i]));
      maximumHeightError = Math.max(maximumHeightError, Math.abs(after.positions[i * 3 + 1] - ceilingHeight));
      if (Math.floor(b.v * after.rows) * after.columns + Math.floor(b.u * after.columns) !== i) wrongPixels++;
      if (after.freeSpaceMask[i] || after.depthConfidence[i] > 128) unsafeRays++;
      repaired++;
    }
    expect(maximumUvError).toBeLessThan(1e-6);
    expect(maximumDepthError).toBeLessThan(1e-6);
    expect(maximumHeightError).toBeLessThan(1e-5);
    expect(wrongPixels).toBe(0);
    expect(unsafeRays).toBe(0);
    expect(repaired).toBeGreaterThan(100);
  });
});

test.each([
  ['dark-fixture', p => p.x > .15 && p.x < .35 && p.z > .15 && p.z < .35],
  ['trim', p => p.x > .15 && p.x < .5 && p.z > .54 && p.z < .61],
  ['higher-ceiling', p => p.x > .45 && p.x < .6 && p.z < -.45 && p.z > -.6],
])('%s retains its measured shape while the surrounding ceiling is repaired', (scene, inside) => {
  const f = fixture({ scene }), result = repair(f);
  expect(result.diagnostics.correctedSamples).toBeGreaterThan(500);
  f.frames.forEach((before, index) => {
    const indices = f.indicesAt(before, inside);
    expect(indices.length).toBeGreaterThan(3);
    expect(indices.some(i => changed(before, result.frames[index], i))).toBe(false);
  });
});

test('a consistent alternate height is retained despite a continuous matching gray photo', () => {
  const f = fixture({ biases: [.12, .12, .12] }), result = repair(f);
  expect(result.diagnostics.correctedSamples).toBe(0);
  expect(result.diagnostics.planes[0].stableOffsetCells).toBeGreaterThan(10);
  f.frames.forEach((before, index) => expect(result.frames[index].positions).toEqual(before.positions));
});

test('thin white HD trim stops ownership between gray depth-pixel centers', () => {
  // Six coarse-pixel translations place the physical trim between depth pixels
  // in multiple views. The HD photograph still observes the boundary.
  const cameraStep = 6 * 2 * (ceilingHeight - 1.4) * Math.tan(35 * Math.PI / 180) / columns;
  const f = fixture({ scene: 'thin-white-trim', cameras: [-cameraStep, 0, cameraStep] }), result = repair(f);
  expect(result.diagnostics.correctedSamples).toBeGreaterThan(200);
  f.frames.forEach((before, index) => {
    const indices = f.indicesAt(before, p => p.x > .2 && p.x < .4 && Math.abs(p.z) < .2);
    expect(indices.length).toBeGreaterThan(20);
    expect(indices.some(i => changed(before, result.frames[index], i))).toBe(false);
  });
});

test('stationary RGB duplicates cannot supply a second translated photographed observation', () => {
  const f = fixture();
  for (const frame of f.frames.slice(1)) {
    frame.colorImage = null; frame.colorWidth = 0; frame.colorHeight = 0;
    frame.colorMask.fill(0);
  }
  for (let i = 0; i < 6; i++) f.frames.push({ ...f.frames[0], frameId: i + 10, textureOnly: true });
  expect(repair(f).diagnostics.correctedSamples).toBe(0);
});

test.each([['missing', true], ['filled but unmeasured', false]])(
  'photographs cannot turn %s depth into measured or tagged geometry', (_, removeDepth) => {
    const f = fixture();
    for (const frame of f.frames) for (const i of f.indicesAt(frame, p => p.x > .3 && p.z > .3)) {
      frame.measuredMask[i] = 0;
      if (removeDepth) frame.filteredDepth[i] = 0;
    }
    const result = repair(f);
    expect(result.diagnostics.correctedSamples).toBeGreaterThan(500);
    f.frames.forEach((before, index) => {
      const after = result.frames[index];
      let alteredUnmeasured = 0;
      for (let i = 0; i < before.filteredDepth.length; i++) if (!before.measuredMask[i] &&
        (after.measuredMask[i] || after.filteredDepth[i] !== before.filteredDepth[i] ||
          changed(before, after, i) || after.ceilingRepairMask?.[i])) alteredUnmeasured++;
      expect(alteredUnmeasured).toBe(0);
    });
  },
);

test('only corrected rays receive the owning ceiling ID and raw plane evidence remains immutable', () => {
  const f = fixture();
  const wall = { ...f.plane, kind: 'wall', normal: [0, 0, 1], offset: 0 };
  const originalCells = new Map([...f.plane.cells].map(([key, ids]) => [key, new Set(ids)]));
  const result = repairCeilingRegions(f.frames, [wall, f.plane], f.helpers);
  const recovered = result.planes[1];
  expect(result.planes[0]).toBe(wall);
  expect(f.plane.cells).toEqual(originalCells);
  expect(f.plane.recoveredCells).toBeUndefined();
  expect(recovered.cells).not.toBe(f.plane.cells);
  expect(recovered.ceilingRecoveryId).toBe(2);
  expect(recovered.recoveredCells.size).toBeGreaterThan(10);
  for (const key of recovered.recoveredCells) {
    const ids = recovered.recoveredCellViews.get(key);
    expect(ids.size).toBeGreaterThanOrEqual(3);
    expect([...ids].every(id => f.frames.some(frame => frame.frameId === id))).toBe(true);
  }
  f.frames.forEach((before, index) => {
    const after = result.frames[index];
    let wrongTags = 0, tagged = 0;
    for (let i = 0; i < before.filteredDepth.length; i++) {
      const tag = after.ceilingRepairMask[i];
      if (changed(before, after, i)) {
        if (tag !== recovered.ceilingRecoveryId || !before.measuredMask[i]) wrongTags++;
        tagged++;
      } else if (tag) wrongTags++;
    }
    expect(wrongTags).toBe(0);
    expect(tagged).toBeGreaterThan(100);
    expect(before.ceilingRepairMask).toBeUndefined();
  });
});

test.each(['no RGB', 'no ceiling', 'missing project'])('%s leaves captured geometry unchanged', missing => {
  const f = fixture();
  if (missing === 'no RGB') for (const frame of f.frames) {
    frame.colorImage = null; frame.colorWidth = 0; frame.colorHeight = 0; frame.colorMask.fill(0);
  }
  const planes = missing === 'no ceiling' ? [{ ...f.plane, kind: 'wall' }] : [f.plane];
  const result = repairCeilingRegions(f.frames, planes, missing === 'missing project' ? {} : f.helpers);
  expect(result.diagnostics.correctedSamples).toBe(0);
  expect(result.frames).toEqual(f.frames);
  expect(result.planes).toEqual(planes);
});
