import { Matrix4, PerspectiveCamera } from 'three';
import { fillSmallMeshHoles, projectWorld } from './fusion';
import { createColorGapRepair } from './colorGapRepair';

const camera = new PerspectiveCamera(90, 1, .1, 10);
const rim = [[.1, .1, -2], [.2, .1, -2], [.2, .2, -2], [.1, .2, -2]];
const center = [.15, .15, -2];
const context = { diameter: Math.SQRT2 * .1, plane: { normal: [0, 0, 1], offset: -2 } };
const helpers = { project: projectWorld,
  projectColor: (frame, ...p) => projectWorld({ ...frame,
    transformMatrix: frame.viewTransformMatrix || frame.transformMatrix }, ...p),
  sampleColor: (frame, uv) => {
    const x = Math.round(uv.u * (frame.colorWidth - 1)), y = Math.round((1 - uv.v) * (frame.colorHeight - 1));
    const offset = (y * frame.colorWidth + x) * 4;
    return Array.from(frame.colorImage.subarray(offset, offset + 3));
  } };
function frames({ photo = 'plain', cameras = [-.12, 0, .12], depth = 0 } = {}) {
  return cameras.map((x, frameId) => {
    const columns = 128, rows = 128, measuredMask = new Uint8Array(columns * rows).fill(1);
    const filteredDepth = new Float32Array(columns * rows).fill(2), colorImage = new Uint8Array(columns * rows * 4);
    for (let y = 0; y < rows; y++) for (let column = 0; column < columns; column++) {
      const worldX = x + ((column + .5) / columns * 2 - 1) * 2;
      const worldY = (1 - (y + .5) / rows * 2) * 2;
      const gap = worldX > .12 && worldX < .18 && worldY > .12 && worldY < .18;
      if (gap) {
        measuredMask[y * columns + column] = depth ? 1 : 0;
        filteredDepth[y * columns + column] = depth;
      }
      const color = gap && photo === 'dark-opening' ? [20, 20, 20] : [180, 160, 140];
      colorImage.set([...color, 255], ((rows - 1 - y) * columns + column) * 4);
    }
    return { frameId, camera: [x, 0, 0], columns, rows, measuredMask, filteredDepth,
      projectionMatrix: camera.projectionMatrix.elements,
      transformMatrix: new Matrix4().makeTranslation(x, 0, 0).elements,
      colorWidth: columns, colorHeight: rows, colorChannels: 4, colorImage,
      freeSpaceMask: new Uint8Array(columns * rows).fill(1),
      depthConfidence: new Uint8Array(columns * rows).fill(255) };
  });
}

test('two translated matching photos authorize a small planar hole despite missing depth', () => {
  const captured = frames(), snapshot = captured.map(frame => frame.measuredMask.slice());
  const repair = createColorGapRepair(captured, helpers);
  expect(repair(center, rim, context)).toBe('surrounding-colors');
  captured.forEach((frame, index) => expect(frame.measuredMask).toEqual(snapshot[index]));
});

test.each([1.7, 2.3])('measured obstruction/opening depth %s keeps the hole open despite matching paint colors', depth => {
  expect(createColorGapRepair(frames({ depth }), helpers)(center, rim, context)).toBe(false);
});

test('a different photographed interior cannot be covered by its surrounding wall color', () => {
  expect(createColorGapRepair(frames({ photo: 'dark-opening' }), helpers)(center, rim, context)).toBe(false);
});

test('stationary photo repeats cannot authorize a missing patch', () => {
  expect(createColorGapRepair(frames({ cameras: [0, 0, 0] }), helpers)(center, rim, context)).toBe(false);
});

test('refreshed photographs from one camera position cannot borrow independence from older depth poses', () => {
  const captured = frames();
  captured.forEach(frame => { frame.viewTransformMatrix = new Matrix4().elements; });
  expect(createColorGapRepair(captured, helpers)(center, rim, context)).toBe(false);
});

test('larger unobserved gaps and gaps with no photographs remain open', () => {
  const captured = frames();
  expect(createColorGapRepair(captured, helpers)(center, rim, { ...context, diameter: .31 })).toBe(false);
  captured.forEach(frame => { frame.colorImage = null; });
  expect(createColorGapRepair(captured, helpers)(center, rim, context)).toBe(false);
});

test('direct independent depth support retains the existing repair path', () => {
  expect(createColorGapRepair(frames({ depth: 2 }), helpers)(center, rim, { ...context, diameter: .7 })).toBe(true);
});

test('color-supported caps stay estimated and close only the enclosed inner boundary', () => {
  const positions = [], indices = [];
  for (let y = 0; y <= 3; y++) for (let x = 0; x <= 3; x++) positions.push(x * .1, y * .1, -2);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (x === 1 && y === 1) continue;
    const a = y * 4 + x;
    indices.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
  }
  const mesh = { positions: new Float32Array(positions), indices: new Uint32Array(indices), colors: new Uint8Array(positions.length).fill(100) };
  const result = fillSmallMeshHoles(mesh, { maxDiameter: .3, maxPlanarity: .018,
    triangulateConcave: true, supportedPlanes: [context.plane], allowRepair: createColorGapRepair(frames(), helpers) });
  expect(result.filledHoleCount).toBe(1);
  expect(result.colorSupportedHoleCount).toBe(1);
  expect(result.colorSupportedHoleArea).toBeCloseTo(.01, 6);
  expect(Array.from(result.estimatedTriangleMask.slice(-2))).toEqual([2, 2]);
  expect(result.positions).toEqual(mesh.positions);
  expect(mesh.indices.length).toBe(indices.length);
});
