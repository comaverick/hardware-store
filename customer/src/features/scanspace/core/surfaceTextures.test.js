import { selectSurfaceTextures } from './surfaceTextures';

const candidate = (id, score, focus = 10) => ({ frame: { textureId: id }, score,
  localFocus: focus, localDetail: 20, pixelDensity: 160 });
const record = (area, candidates, patch = 0) => ({ area, candidates, patch, selected: 0 });

test('surface selection removes triangle-level photo alternation without losing uncovered ends', () => {
  const records = [record(1, [candidate(0, 4), candidate(1, 3.8)]),
    record(1, [candidate(1, 4), candidate(0, 3.8)]), record(0.2, [candidate(1, 4)])];
  selectSurfaceTextures(records);
  expect(records.map(r => r.candidates[r.selected].frame.textureId)).toEqual([1, 1, 1]);
});

test('tiny clipped triangles cannot outvote a broad supported photograph', () => {
  const broad = record(2, [candidate(0, 4)]);
  const tiny = Array.from({ length: 100 }, () => record(0.0001, [candidate(1, 4), candidate(0, 3.5)]));
  selectSurfaceTextures([broad, ...tiny]);
  expect(tiny.every(r => r.candidates[r.selected].frame.textureId === 0)).toBe(true);
});

test('a consistently sharper overlapping view wins over a broad blurred photo', () => {
  const records = Array.from({ length: 10 }, () => record(0.1, [candidate(0, 4, 2), candidate(1, 3.5, 12)]));
  records.push(record(0.2, [candidate(0, 4, 2)]));
  const result = selectSurfaceTextures(records);
  expect(records.slice(0, 10).every(r => r.candidates[r.selected].frame.textureId === 1)).toBe(true);
  expect(records[10].selected).toBe(0);
  expect(result.rejectedSoftCandidates).toBe(10);
});

test('a reflected highlight or one misregistered edge is not treated as whole-photo blur', () => {
  const records = Array.from({ length: 10 }, (_, i) => record(0.1,
    [candidate(0, 4, i === 0 ? 2 : 10), candidate(1, 3.5, 12)]));
  const result = selectSurfaceTextures(records);
  expect(result.rejectedSoftCandidates).toBe(0);
  expect(records.every(r => r.candidates[r.selected].frame.textureId === 0)).toBe(true);
});

test('independent surfaces, missing photos and failed visibility candidates stay independent', () => {
  const records = [record(1, [candidate(0, 4)]), record(1, [candidate(1, 4)], 1),
    record(1, []), record(1, [candidate(2, 4), candidate(1, 5)], -1)];
  selectSurfaceTextures(records);
  expect(records.map(r => r.selected)).toEqual([0, 0, 0, 0]);
  expect(records[0].candidates).toHaveLength(1);
});
