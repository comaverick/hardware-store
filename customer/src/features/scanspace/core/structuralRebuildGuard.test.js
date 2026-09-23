import { structuralRebuildRegression } from './fusion';

const floor = {
  positions: new Float32Array([0,0,0, 1,0,0, 0,0,1, 1,0,1]),
  indices: new Uint32Array([0,1,2, 1,3,2]),
};

test('a replacement that leaves a separate ceiling sheet is reverted', () => {
  const layered = {
    positions: new Float32Array([...floor.positions,
      0,.1,0, 1,.1,0, 0,.1,1, 1,.1,1]),
    indices: new Uint32Array([...floor.indices, 4,5,6, 5,7,6]),
  };
  const result = structuralRebuildRegression(floor, layered);
  expect(result.accepted).toBe(false);
  expect(result.reasons).toContain('disconnected-area');
});

test('a topology preserving replacement is accepted', () => {
  expect(structuralRebuildRegression(floor, floor).accepted).toBe(true);
});
