import { buildStructuralRepair } from "./structuralRepair";

const wall = {
  start: { x: 0, z: 0 },
  end: { x: 2, z: 0 },
  bottom: 0,
  height: 2,
  sampleCount: 100,
};

function gridCloud(missing = () => false) {
  const positions = [];
  for (let row = 0; row < 10; row++)
    for (let column = 0; column < 10; column++) {
      if (missing(column, row)) continue;
      positions.push(column * 0.2 + 0.1, row * 0.2 + 0.1, 0);
    }
  return { positions: new Float32Array(positions) };
}

const options = {
  cellSize: 0.2,
  dilationRadius: 0,
  maxHoleArea: 0.3,
  maxWindowArea: 0,
  minAxisCoverage: 0.3,
};

test("repairs a small enclosed dropout on a measured wall plane", () => {
  const repair = buildStructuralRepair(
    [wall],
    gridCloud((column, row) => column === 4 && row === 5),
    options,
  );
  expect(repair.kind).toBe("inferred-structural-repair");
  expect(repair.repairedCellCount).toBe(1);
  expect(repair.triangleCount).toBe(2);
  expect(repair.positions).toBeInstanceOf(Float32Array);
});

test("does not close a gap connected to the wall boundary", () => {
  const repair = buildStructuralRepair(
    [wall],
    gridCloud((column, row) => column === 0 && row >= 3 && row <= 5),
    options,
  );
  expect(repair).toBeNull();
});

test("does not close a floor-connected probable doorway", () => {
  const repair = buildStructuralRepair(
    [wall],
    gridCloud((column, row) => column >= 4 && column <= 5 && row <= 4),
    options,
  );
  expect(repair).toBeNull();
});

test("does not close a large unsupported interior region", () => {
  const repair = buildStructuralRepair(
    [wall],
    gridCloud(
      (column, row) =>
        column >= 3 && column <= 6 && row >= 3 && row <= 6,
    ),
    options,
  );
  expect(repair).toBeNull();
});

test("marks a large enclosed rectangular dropout as a probable window", () => {
  const repair = buildStructuralRepair(
    [wall],
    gridCloud(
      (column, row) =>
        column >= 2 && column <= 7 && row >= 3 && row <= 7,
    ),
    { ...options, maxWindowArea: 2 },
  );
  expect(repair.inferredWindowCount).toBe(1);
  expect(repair.repairedCellCount).toBe(30);
});
