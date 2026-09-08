const finitePoint = (point) =>
  Number.isFinite(point?.x) && Number.isFinite(point?.z);

function cloudPositions(cloud) {
  if (!cloud?.positions?.length) return [];
  const points = [];
  for (let offset = 0; offset + 2 < cloud.positions.length; offset += 3)
    points.push({
      x: cloud.positions[offset],
      y: cloud.positions[offset + 1],
      z: cloud.positions[offset + 2],
    });
  return points;
}

function dilate(source, columns, rows, radius) {
  if (!radius) return source;
  const result = new Uint8Array(source.length);
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      let occupied = false;
      for (let dy = -radius; dy <= radius && !occupied; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const x = column + dx;
          const y = row + dy;
          if (
            x >= 0 &&
            x < columns &&
            y >= 0 &&
            y < rows &&
            source[y * columns + x]
          ) {
            occupied = true;
            break;
          }
        }
      result[row * columns + column] = occupied ? 1 : 0;
    }
  return result;
}

function emptyComponents(occupied, columns, rows) {
  const visited = new Uint8Array(occupied.length);
  const components = [];
  for (let seed = 0; seed < occupied.length; seed++) {
    if (occupied[seed] || visited[seed]) continue;
    const cells = [];
    const queue = [seed];
    let head = 0;
    let touchesBoundary = false;
    let touchesFloor = false;
    visited[seed] = 1;
    while (head < queue.length) {
      const index = queue[head++];
      const column = index % columns;
      const row = Math.floor(index / columns);
      cells.push(index);
      if (
        column === 0 ||
        column === columns - 1 ||
        row === rows - 1
      )
        touchesBoundary = true;
      if (row === 0) touchesFloor = true;
      [
        [column - 1, row],
        [column + 1, row],
        [column, row - 1],
        [column, row + 1],
      ].forEach(([x, y]) => {
        if (x < 0 || x >= columns || y < 0 || y >= rows) return;
        const neighbor = y * columns + x;
        if (occupied[neighbor] || visited[neighbor]) return;
        visited[neighbor] = 1;
        queue.push(neighbor);
      });
    }
    components.push({ cells, touchesBoundary, touchesFloor });
  }
  return components;
}

function componentBounds(component, columns, cellWidth, cellHeight) {
  const columnValues = component.cells.map((index) => index % columns);
  const rowValues = component.cells.map((index) => Math.floor(index / columns));
  const minColumn = Math.min(...columnValues);
  const maxColumn = Math.max(...columnValues);
  const minRow = Math.min(...rowValues);
  const maxRow = Math.max(...rowValues);
  const boxCells = (maxColumn - minColumn + 1) * (maxRow - minRow + 1);
  return {
    width: (maxColumn - minColumn + 1) * cellWidth,
    height: (maxRow - minRow + 1) * cellHeight,
    bottom: minRow * cellHeight,
    top: (maxRow + 1) * cellHeight,
    rectangularity: component.cells.length / boxCells,
  };
}

function addCell(
  geometry,
  wall,
  tangent,
  column,
  row,
  cellWidth,
  cellHeight,
  color,
) {
  const along0 = column * cellWidth;
  const along1 = Math.min(wall.length, along0 + cellWidth);
  const y0 = wall.bottom + row * cellHeight;
  const y1 = Math.min(wall.bottom + wall.height, y0 + cellHeight);
  const at = (along, y) => [
    wall.start.x + tangent.x * along,
    y,
    wall.start.z + tangent.z * along,
  ];
  const base = geometry.positions.length / 3;
  const vertices = [
    at(along0, y0),
    at(along1, y0),
    at(along1, y1),
    at(along0, y1),
  ];
  vertices.forEach((vertex) => {
    geometry.positions.push(...vertex);
    geometry.colors.push(...color);
    ["x", "y", "z"].forEach((axis, axisIndex) => {
      geometry.bounds.min[axis] = Math.min(
        geometry.bounds.min[axis],
        vertex[axisIndex],
      );
      geometry.bounds.max[axis] = Math.max(
        geometry.bounds.max[axis],
        vertex[axisIndex],
      );
    });
  });
  geometry.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function emptyGeometry() {
  return {
    positions: [],
    colors: [],
    indices: [],
    bounds: {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
    },
  };
}

function wallColor(wall) {
  const value = wall?.material?.color;
  const match = typeof value === "string" && value.match(/^#([0-9a-f]{6})$/i);
  return match
    ? [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16))
    : [198, 204, 200];
}

function typedSurface(geometry, kind) {
  return {
    version: 1,
    kind,
    inferred: true,
    positions: new Float32Array(geometry.positions),
    colors: new Uint8Array(geometry.colors),
    indices: new Uint32Array(geometry.indices),
    triangleCount: geometry.indices.length / 3,
    bounds: geometry.bounds,
  };
}

// Build a clean planar presentation constrained to robust measured wall bounds,
// plus a conservative patch-only layer for diagnostics. No panel extends into
// a room direction for which a wall plane was not detected.
export function buildStructuralRepair(walls, cloud, options = {}) {
  const points = cloudPositions(cloud);
  if (!Array.isArray(walls) || !walls.length || !points.length) return null;
  const cellSize = options.cellSize || 0.16;
  const planeDistance = options.planeDistance || 0.16;
  const dilationRadius = options.dilationRadius ?? 0;
  const maxHoleArea = options.maxHoleArea || 0.8;
  const maxWindowArea = options.maxWindowArea ?? 3.5;
  const minAxisCoverage = options.minAxisCoverage || 0.3;
  const geometry = emptyGeometry();
  const cleanGeometry = emptyGeometry();
  let wallCount = 0;
  let repairedCellCount = 0;
  let repairedArea = 0;
  let inferredWindowCount = 0;
  let preservedOpeningCount = 0;

  walls.forEach((sourceWall) => {
    if (
      !finitePoint(sourceWall?.start) ||
      !finitePoint(sourceWall?.end) ||
      !Number.isFinite(sourceWall?.bottom) ||
      !Number.isFinite(sourceWall?.height) ||
      sourceWall.height < 0.5 ||
      (sourceWall.sampleCount || 0) < (options.minSamples || 50)
    )
      return;
    const dx = sourceWall.end.x - sourceWall.start.x;
    const dz = sourceWall.end.z - sourceWall.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.5) return;
    const tangent = { x: dx / length, z: dz / length };
    const normal = { x: -tangent.z, z: tangent.x };
    // The clean representation is a planar rectangle constrained to the
    // measured wall's robust 2nd-98th percentile bounds. It fills sensor
    // dropouts without extending the wall into an unobserved room sector.
    addCell(
      cleanGeometry,
      { ...sourceWall, length },
      tangent,
      0,
      0,
      length,
      sourceWall.height,
      wallColor(sourceWall),
    );
    const columns = Math.max(3, Math.ceil(length / cellSize));
    const rows = Math.max(3, Math.ceil(sourceWall.height / cellSize));
    const cellWidth = length / columns;
    const cellHeight = sourceWall.height / rows;
    const occupied = new Uint8Array(columns * rows);
    points.forEach((point) => {
      const relativeX = point.x - sourceWall.start.x;
      const relativeZ = point.z - sourceWall.start.z;
      const along = relativeX * tangent.x + relativeZ * tangent.z;
      const across = Math.abs(relativeX * normal.x + relativeZ * normal.z);
      const aboveBottom = point.y - sourceWall.bottom;
      if (
        across > planeDistance ||
        along < 0 ||
        along >= length ||
        aboveBottom < 0 ||
        aboveBottom >= sourceWall.height
      )
        return;
      const column = Math.min(columns - 1, Math.floor(along / cellWidth));
      const row = Math.min(rows - 1, Math.floor(aboveBottom / cellHeight));
      occupied[row * columns + column] = 1;
    });
    const supportedColumns = new Set();
    const supportedRows = new Set();
    occupied.forEach((value, index) => {
      if (!value) return;
      supportedColumns.add(index % columns);
      supportedRows.add(Math.floor(index / columns));
    });
    if (
      supportedColumns.size / columns < minAxisCoverage ||
      supportedRows.size / rows < minAxisCoverage
    )
      return;
    const supported = dilate(occupied, columns, rows, dilationRadius);
    let repairedThisWall = 0;
    emptyComponents(supported, columns, rows).forEach((component) => {
      const area = component.cells.length * cellWidth * cellHeight;
      const shape = componentBounds(
        component,
        columns,
        cellWidth,
        cellHeight,
      );
      const probableWindow =
        !component.touchesBoundary &&
        !component.touchesFloor &&
        area > maxHoleArea &&
        area <= maxWindowArea &&
        shape.width >= 0.4 &&
        shape.width <= 2.8 &&
        shape.height >= 0.35 &&
        shape.height <= 2.2 &&
        shape.bottom >= 0.35 &&
        shape.top <= sourceWall.height - 0.1 &&
        shape.rectangularity >= 0.62;
      const safeToRepair =
        !component.touchesBoundary &&
        !component.touchesFloor &&
        area <= maxHoleArea;
      if (!safeToRepair && !probableWindow) {
        if (area >= cellWidth * cellHeight * 2) preservedOpeningCount++;
        return;
      }
      const color = probableWindow ? [92, 151, 178] : [126, 179, 157];
      component.cells.forEach((index) => {
        addCell(
          geometry,
          { ...sourceWall, length },
          tangent,
          index % columns,
          Math.floor(index / columns),
          cellWidth,
          cellHeight,
          color,
        );
      });
      if (probableWindow) inferredWindowCount++;
      repairedThisWall += component.cells.length;
      repairedArea += area;
    });
    if (repairedThisWall) wallCount++;
    repairedCellCount += repairedThisWall;
  });

  if (!cleanGeometry.indices.length) return null;
  const cleanSurface = typedSurface(
    cleanGeometry,
    "inferred-planar-wall-surface",
  );
  return {
    ...typedSurface(geometry, "inferred-structural-repair"),
    cleanSurface,
    wallCount,
    repairedCellCount,
    repairedArea,
    inferredWindowCount,
    preservedOpeningCount,
    bounds: geometry.indices.length ? geometry.bounds : cleanSurface.bounds,
  };
}
