const clampByte = (value) =>
  Math.max(0, Math.min(255, Math.round(Number(value) || 0)));

const hasColor = (point) =>
  Array.isArray(point.color) &&
  point.color.length >= 3 &&
  point.color.slice(0, 3).every(Number.isFinite);

const sampleEvenly = (values, count) => {
  if (values.length <= count) return values;
  const step = values.length / count;
  return Array.from({ length: count }, (_, index) =>
    values[Math.floor(index * step)],
  );
};

const srgbByteToLinearByte = (value) => {
  const channel = clampByte(value) / 255;
  const linear =
    channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  return Math.round(linear * 255);
};

function fallbackFloor(points) {
  const values = points.map((point) => point.y).sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * 0.02))];
}

export function buildScanCloud(points, options = {}) {
  const finite = points.filter(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.z),
  );
  if (!finite.length) return null;
  const limit = Math.max(1000, Math.min(40000, options.limit || 30000));
  const colored = finite.filter(hasColor);
  const uncolored = finite.filter((point) => !hasColor(point));
  let colorBudget = Math.min(colored.length, Math.floor(limit * 0.72));
  const plainBudget = Math.min(uncolored.length, limit - colorBudget);
  colorBudget = Math.min(colored.length, limit - plainBudget);
  const chosenColors = sampleEvenly(colored, colorBudget);
  const chosenPlain = sampleEvenly(uncolored, plainBudget);
  const selected = [...chosenColors, ...chosenPlain];
  const floorY = Number.isFinite(options.floorY)
    ? options.floorY
    : fallbackFloor(finite);

  // A nearby color sample can safely color the same small surface patch. The
  // search radius stays below typical wall/furniture separation to avoid broad
  // color filling or inventing textures.
  const colorCellSize = 0.14;
  const colorCells = new Map();
  chosenColors.forEach((point) => {
    const key = [point.x, point.y, point.z]
      .map((value) => Math.floor(value / colorCellSize))
      .join(",");
    const cell = colorCells.get(key) || { sum: [0, 0, 0], count: 0 };
    point.color.slice(0, 3).forEach((value, index) => {
      cell.sum[index] += clampByte(value);
    });
    cell.count++;
    colorCells.set(key, cell);
  });
  const nearbyColor = (point) => {
    const cell = [point.x, point.y, point.z].map((value) =>
      Math.floor(value / colorCellSize),
    );
    for (let radius = 0; radius <= 1; radius++)
      for (let x = -radius; x <= radius; x++)
        for (let y = -radius; y <= radius; y++)
          for (let z = -radius; z <= radius; z++) {
            const found = colorCells.get(
              `${cell[0] + x},${cell[1] + y},${cell[2] + z}`,
            );
            if (found)
              return found.sum.map((value) => value / found.count);
          }
    return null;
  };

  const positions = new Float32Array(selected.length * 3);
  const colors = new Uint8Array(selected.length * 3);
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  selected.forEach((point, index) => {
    const position = { x: point.x, y: point.y - floorY, z: point.z };
    positions.set([position.x, position.y, position.z], index * 3);
    ["x", "y", "z"].forEach((axis) => {
      bounds.min[axis] = Math.min(bounds.min[axis], position[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], position[axis]);
    });
    const color = (hasColor(point) ? point.color : nearbyColor(point)) || [
      174, 184, 179,
    ];
    colors.set(color.slice(0, 3).map(srgbByteToLinearByte), index * 3);
  });
  const voxelSize = Number.isFinite(options.voxelSize)
    ? options.voxelSize
    : 0.08;
  return {
    version: 1,
    positions,
    colors,
    count: selected.length,
    sourcePointCount: finite.length,
    capturedColorCount: colored.length,
    colorCoverage: Math.round((colored.length / finite.length) * 100),
    pointSize: Math.max(0.035, Math.min(0.11, voxelSize * 0.8)),
    floorY,
    bounds,
    observer: {
      x: Number.isFinite(options.observer?.x)
        ? options.observer.x
        : (bounds.min.x + bounds.max.x) / 2,
      y: 1.6,
      z: Number.isFinite(options.observer?.z)
        ? options.observer.z
        : (bounds.min.z + bounds.max.z) / 2,
    },
  };
}
