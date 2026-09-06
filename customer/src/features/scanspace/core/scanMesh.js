const byte = (value) =>
  Math.max(0, Math.min(255, Math.round(Number(value) || 0)));

const linearByte = (value) => {
  const channel = byte(value) / 255;
  const linear =
    channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  return Math.round(linear * 255);
};

const distance = (a, b) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function triangleAllowed(a, b, c, camera) {
  if (!a || !b || !c) return false;
  const averageDepth = camera
    ? (distance(a, camera) + distance(b, camera) + distance(c, camera)) / 3
    : 2;
  const limit = Math.max(0.13, Math.min(0.42, averageDepth * 0.105));
  if (
    distance(a, b) > limit ||
    distance(b, c) > limit ||
    distance(c, a) > limit * 1.45
  )
    return false;
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const cross = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  return Math.hypot(cross.x, cross.y, cross.z) > 0.00008;
}

export function buildDepthMeshFrame(points, options = {}) {
  if (!points.length) return null;
  const columns = options.columns || points[0].gridColumns;
  const rows = options.rows || points[0].gridRows;
  if (!columns || !rows) return null;
  const grid = new Int32Array(columns * rows).fill(-1);
  const positions = [];
  const colors = [];
  let capturedColorCount = 0;
  points.forEach((point) => {
    if (
      !Number.isInteger(point.gridX) ||
      !Number.isInteger(point.gridY) ||
      point.gridX < 0 ||
      point.gridX >= columns ||
      point.gridY < 0 ||
      point.gridY >= rows
    )
      return;
    const index = positions.length / 3;
    grid[point.gridY * columns + point.gridX] = index;
    positions.push(point.x, point.y, point.z);
    const captured = Array.isArray(point.color);
    if (captured) capturedColorCount++;
    const color = captured ? point.color : [174, 184, 179];
    colors.push(...color.slice(0, 3).map(linearByte));
  });
  const vertex = (index) =>
    index < 0
      ? null
      : {
          x: positions[index * 3],
          y: positions[index * 3 + 1],
          z: positions[index * 3 + 2],
        };
  const indices = [];
  for (let y = 0; y < rows - 1; y++)
    for (let x = 0; x < columns - 1; x++) {
      const topLeft = grid[y * columns + x];
      const topRight = grid[y * columns + x + 1];
      const bottomLeft = grid[(y + 1) * columns + x];
      const bottomRight = grid[(y + 1) * columns + x + 1];
      if (
        triangleAllowed(
          vertex(topLeft),
          vertex(bottomLeft),
          vertex(topRight),
          options.camera,
        )
      )
        indices.push(topLeft, bottomLeft, topRight);
      if (
        triangleAllowed(
          vertex(topRight),
          vertex(bottomLeft),
          vertex(bottomRight),
          options.camera,
        )
      )
        indices.push(topRight, bottomLeft, bottomRight);
    }
  if (indices.length < 6) return null;
  return {
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    capturedColorCount,
  };
}

function floorFromFrames(frames) {
  const values = [];
  frames.forEach((frame) => {
    for (let index = 1; index < frame.positions.length; index += 3)
      values.push(frame.positions[index]);
  });
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * 0.02))];
}

export function mergeScanMesh(frames, options = {}) {
  const usable = frames.filter(
    (frame) => frame?.vertexCount && frame?.triangleCount,
  );
  if (!usable.length) return null;
  const vertexCount = usable.reduce((sum, frame) => sum + frame.vertexCount, 0);
  const indexCount = usable.reduce(
    (sum, frame) => sum + frame.indices.length,
    0,
  );
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Uint8Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const floorY = Number.isFinite(options.floorY)
    ? options.floorY
    : floorFromFrames(usable);
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  let vertexOffset = 0;
  let indexOffset = 0;
  usable.forEach((frame) => {
    for (let index = 0; index < frame.vertexCount; index++) {
      const x = frame.positions[index * 3];
      const y = frame.positions[index * 3 + 1] - floorY;
      const z = frame.positions[index * 3 + 2];
      const target = (vertexOffset + index) * 3;
      positions[target] = x;
      positions[target + 1] = y;
      positions[target + 2] = z;
      colors[target] = frame.colors[index * 3];
      colors[target + 1] = frame.colors[index * 3 + 1];
      colors[target + 2] = frame.colors[index * 3 + 2];
      bounds.min.x = Math.min(bounds.min.x, x);
      bounds.min.y = Math.min(bounds.min.y, y);
      bounds.min.z = Math.min(bounds.min.z, z);
      bounds.max.x = Math.max(bounds.max.x, x);
      bounds.max.y = Math.max(bounds.max.y, y);
      bounds.max.z = Math.max(bounds.max.z, z);
    }
    for (let index = 0; index < frame.indices.length; index++)
      indices[indexOffset + index] = frame.indices[index] + vertexOffset;
    vertexOffset += frame.vertexCount;
    indexOffset += frame.indices.length;
  });
  return {
    version: 1,
    positions,
    colors,
    indices,
    vertexCount,
    triangleCount: indexCount / 3,
    capturedColorCount: usable.reduce(
      (sum, frame) => sum + (frame.capturedColorCount || 0),
      0,
    ),
    colorCoverage: Math.round(
      (usable.reduce(
        (sum, frame) => sum + (frame.capturedColorCount || 0),
        0,
      ) /
        vertexCount) *
        100,
    ),
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
