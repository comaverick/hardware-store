const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const SRGB_FALLBACK = [174, 184, 179];
const TETRAHEDRA = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];
const TETRA_EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

const linearByte = (byte) => {
  const value = clamp((Number(byte) || 0) / 255, 0, 1);
  return Math.round(
    255 * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4),
  );
};

/**
 * Converts one selected camera view into a compact, transferable RGB-D grid.
 * It deliberately has no geometry or indices: geometry is created only after
 * all keyframes have been fused together in the reconstruction worker.
 */
export function createRgbdKeyframe(points, options = {}) {
  const columns = options.columns || points[0]?.gridColumns;
  const rows = options.rows || points[0]?.gridRows;
  if (!columns || !rows || !points.length) return null;
  const length = columns * rows;
  const positions = new Float32Array(length * 3);
  positions.fill(Number.NaN);
  const depths = new Float32Array(length);
  const colors = new Uint8Array(length * 3);
  const colorMask = new Uint8Array(length);
  let validCount = 0;
  let coloredCount = 0;
  points.forEach((point) => {
    const x = point.gridX;
    const y = point.gridY;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= columns || y >= rows)
      return;
    const index = y * columns + x;
    const target = index * 3;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return;
    positions[target] = point.x;
    positions[target + 1] = point.y;
    positions[target + 2] = point.z;
    depths[index] = Number.isFinite(point.depth) ? point.depth : 0;
    validCount++;
    if (Array.isArray(point.color) && point.color.length >= 3) {
      colors[target] = clamp(Math.round(point.color[0]), 0, 255);
      colors[target + 1] = clamp(Math.round(point.color[1]), 0, 255);
      colors[target + 2] = clamp(Math.round(point.color[2]), 0, 255);
      colorMask[index] = 1;
      coloredCount++;
    }
  });
  // Keep the capture primitive permissive for supported depth resolutions;
  // the worker applies the meaningful coverage threshold across all frames.
  if (validCount < 6) return null;
  return {
    version: 1,
    columns,
    rows,
    positions,
    depths,
    colors,
    colorMask,
    projectionMatrix: new Float32Array(options.projectionMatrix || []),
    transformMatrix: new Float32Array(options.transformMatrix || []),
    camera: new Float32Array([
      options.camera?.x || 0,
      options.camera?.y || 0,
      options.camera?.z || 0,
    ]),
    timestamp: options.timestamp || 0,
    tracking: true,
    validCount,
    coloredCount,
  };
}

function collectSamples(keyframes, maxSamples = 36000) {
  const available = keyframes.reduce((total, frame) => total + (frame.validCount || 0), 0);
  const stride = Math.max(1, Math.ceil(available / maxSamples));
  const samples = [];
  let cursor = 0;
  keyframes.forEach((frame) => {
    const camera = frame.camera || [0, 0, 0];
    for (let index = 0; index < frame.depths.length; index++) {
      const offset = index * 3;
      const x = frame.positions[offset];
      const y = frame.positions[offset + 1];
      const z = frame.positions[offset + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (cursor++ % stride) continue;
      samples.push({
        x,
        y,
        z,
        cx: camera[0],
        cy: camera[1],
        cz: camera[2],
        color: frame.colorMask?.[index]
          ? [frame.colors[offset], frame.colors[offset + 1], frame.colors[offset + 2]]
          : null,
      });
    }
  });
  return samples;
}

function sampleBounds(samples) {
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  samples.forEach((sample) => {
    ["x", "y", "z"].forEach((axis) => {
      bounds.min[axis] = Math.min(bounds.min[axis], sample[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], sample[axis]);
    });
  });
  return bounds;
}

function makeVolume(bounds, options) {
  const maxRange = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  );
  const maxDimension = clamp(options.maxDimension || 80, 48, 96);
  let voxelSize = Math.max(options.minVoxelSize || 0.055, maxRange / (maxDimension - 5));
  const makeDimensions = () => ["x", "y", "z"].map((axis) =>
    Math.max(4, Math.ceil((bounds.max[axis] - bounds.min[axis] + voxelSize * 4) / voxelSize) + 1),
  );
  let dimensions = makeDimensions();
  const maxCells = options.maxCells || 650000;
  const product = () => dimensions[0] * dimensions[1] * dimensions[2];
  if (product() > maxCells) {
    voxelSize *= Math.cbrt(product() / maxCells);
    dimensions = makeDimensions();
  }
  const origin = {
    x: bounds.min.x - voxelSize * 2,
    y: bounds.min.y - voxelSize * 2,
    z: bounds.min.z - voxelSize * 2,
  };
  const count = product();
  return {
    origin,
    dimensions,
    voxelSize,
    values: new Float32Array(count),
    weights: new Uint16Array(count),
    colors: new Float32Array(count * 3),
    colorWeights: new Uint16Array(count),
  };
}

function volumeIndex(volume, x, y, z) {
  const [width, height] = volume.dimensions;
  return x + y * width + z * width * height;
}

function integrate(volume, samples, report) {
  const [width, height, depth] = volume.dimensions;
  const voxel = volume.voxelSize;
  const truncation = voxel * 2.2;
  const radius = Math.min(3, Math.ceil(truncation / voxel));
  samples.forEach((sample, sampleIndex) => {
    const dx = sample.x - sample.cx;
    const dy = sample.y - sample.cy;
    const dz = sample.z - sample.cz;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 0.15) return;
    const rx = dx / distance;
    const ry = dy / distance;
    const rz = dz / distance;
    const bx = Math.floor((sample.x - volume.origin.x) / voxel);
    const by = Math.floor((sample.y - volume.origin.y) / voxel);
    const bz = Math.floor((sample.z - volume.origin.z) / voxel);
    for (let z = Math.max(0, bz - radius); z <= Math.min(depth - 1, bz + radius); z++)
      for (let y = Math.max(0, by - radius); y <= Math.min(height - 1, by + radius); y++)
        for (let x = Math.max(0, bx - radius); x <= Math.min(width - 1, bx + radius); x++) {
          const px = volume.origin.x + (x + 0.5) * voxel;
          const py = volume.origin.y + (y + 0.5) * voxel;
          const pz = volume.origin.z + (z + 0.5) * voxel;
          const qx = px - sample.cx;
          const qy = py - sample.cy;
          const qz = pz - sample.cz;
          const along = qx * rx + qy * ry + qz * rz;
          const lateral = Math.hypot(qx - along * rx, qy - along * ry, qz - along * rz);
          const signedDistance = distance - along;
          if (Math.abs(signedDistance) > truncation || lateral > voxel * 1.45) continue;
          const index = volumeIndex(volume, x, y, z);
          const previous = volume.weights[index];
          const weight = previous < 32 ? 1 : 0;
          if (!weight) continue;
          volume.values[index] = (volume.values[index] * previous + signedDistance / truncation) / (previous + weight);
          volume.weights[index] = previous + weight;
          if (sample.color && Math.abs(signedDistance) <= voxel * 0.9) {
            const colorWeight = volume.colorWeights[index];
            const target = index * 3;
            const color = sample.color.map(linearByte);
            volume.colors[target] = (volume.colors[target] * colorWeight + color[0]) / (colorWeight + 1);
            volume.colors[target + 1] = (volume.colors[target + 1] * colorWeight + color[1]) / (colorWeight + 1);
            volume.colors[target + 2] = (volume.colors[target + 2] * colorWeight + color[2]) / (colorWeight + 1);
            volume.colorWeights[index] = Math.min(255, colorWeight + 1);
          }
        }
    if (sampleIndex % 3000 === 0) report?.("fusing", 20 + Math.round((sampleIndex / samples.length) * 45));
  });
}

function corner(volume, x, y, z) {
  const index = volumeIndex(volume, x, y, z);
  const offset = index * 3;
  return {
    x: volume.origin.x + (x + 0.5) * volume.voxelSize,
    y: volume.origin.y + (y + 0.5) * volume.voxelSize,
    z: volume.origin.z + (z + 0.5) * volume.voxelSize,
    value: volume.values[index],
    weight: volume.weights[index],
    color: volume.colorWeights[index]
      ? [volume.colors[offset], volume.colors[offset + 1], volume.colors[offset + 2]]
      : SRGB_FALLBACK.map(linearByte),
  };
}

function addTriangle(vertices, indices, vertexCache, triangle) {
  const ids = triangle.map((point) => {
    const key = `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)},${Math.round(point.z * 1000)}`;
    const existing = vertexCache.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.positions.length / 3;
    vertices.positions.push(point.x, point.y, point.z);
    vertices.colors.push(...point.color.map((value) => clamp(Math.round(value), 0, 255)));
    vertexCache.set(key, index);
    return index;
  });
  if (ids[0] !== ids[1] && ids[1] !== ids[2] && ids[0] !== ids[2]) indices.push(...ids);
}

function polygonizeTetra(vertices) {
  const intersections = [];
  TETRA_EDGES.forEach(([a, b]) => {
    const first = vertices[a];
    const second = vertices[b];
    if ((first.value < 0) === (second.value < 0)) return;
    const t = clamp(first.value / (first.value - second.value), 0, 1);
    intersections.push({
      x: first.x + (second.x - first.x) * t,
      y: first.y + (second.y - first.y) * t,
      z: first.z + (second.z - first.z) * t,
      color: first.color.map((value, index) => value + (second.color[index] - value) * t),
    });
  });
  return intersections.length >= 3 ? intersections : null;
}

function extractMesh(volume, floorY, observer, report) {
  const [width, height, depth] = volume.dimensions;
  const vertices = { positions: [], colors: [] };
  const indices = [];
  const vertexCache = new Map();
  const total = Math.max(1, (width - 1) * (height - 1) * (depth - 1));
  let processed = 0;
  const maxTriangles = 140000;
  for (let z = 0; z < depth - 1; z++)
    for (let y = 0; y < height - 1; y++)
      for (let x = 0; x < width - 1; x++) {
        const cube = [
          corner(volume, x, y, z), corner(volume, x + 1, y, z),
          corner(volume, x + 1, y + 1, z), corner(volume, x, y + 1, z),
          corner(volume, x, y, z + 1), corner(volume, x + 1, y, z + 1),
          corner(volume, x + 1, y + 1, z + 1), corner(volume, x, y + 1, z + 1),
        ];
        const observed = cube.filter((point) => point.weight > 0).length;
        const hasNegative = cube.some((point) => point.value < 0 && point.weight > 0);
        const hasPositive = cube.some((point) => point.value >= 0 && point.weight > 0);
        if (observed >= 6 && hasNegative && hasPositive && indices.length / 3 < maxTriangles)
          TETRAHEDRA.forEach((tetra) => {
            const polygon = polygonizeTetra(tetra.map((index) => cube[index]));
            if (!polygon || indices.length / 3 >= maxTriangles) return;
            for (let index = 1; index < polygon.length - 1; index++)
              addTriangle(vertices, indices, vertexCache, [polygon[0], polygon[index], polygon[index + 1]]);
          });
        processed++;
        if (processed % 100000 === 0) report?.("meshing", 66 + Math.round((processed / total) * 30));
      }
  if (indices.length < 12) return null;
  const positions = new Float32Array(vertices.positions);
  for (let index = 1; index < positions.length; index += 3) positions[index] -= floorY;
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (let index = 0; index < positions.length; index += 3)
    ["x", "y", "z"].forEach((axis, axisIndex) => {
      bounds.min[axis] = Math.min(bounds.min[axis], positions[index + axisIndex]);
      bounds.max[axis] = Math.max(bounds.max[axis], positions[index + axisIndex]);
    });
  return {
    version: 2,
    kind: "fused-rgbd-tsdf",
    positions,
    colors: new Uint8Array(vertices.colors),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    colorCoverage: 0,
    floorY,
    bounds,
    observer: { x: observer?.x || 0, y: 1.6, z: observer?.z || 0 },
  };
}

export function fuseRgbdKeyframes(keyframes, options = {}, report) {
  const usable = keyframes.filter((frame) => frame?.positions?.length && frame?.depths?.length && frame?.tracking !== false);
  report?.("preparing", 5);
  const samples = collectSamples(usable, options.maxSamples || 36000);
  if (samples.length < 400)
    return { mesh: null, diagnostics: { reason: "Not enough stable RGB-D samples for a surface.", keyframes: usable.length, samples: samples.length } };
  const bounds = sampleBounds(samples);
  const volume = makeVolume(bounds, options);
  report?.("fusing", 20, { voxelSize: volume.voxelSize, dimensions: volume.dimensions });
  integrate(volume, samples, report);
  report?.("meshing", 66);
  const mesh = extractMesh(volume, Number.isFinite(options.floorY) ? options.floorY : 0, options.observer, report);
  if (mesh) {
    const colored = usable.reduce((sum, frame) => sum + (frame.coloredCount || 0), 0);
    const observed = usable.reduce((sum, frame) => sum + (frame.validCount || 0), 0);
    mesh.colorCoverage = observed ? Math.round((colored / observed) * 100) : 0;
  }
  return {
    mesh,
    diagnostics: {
      reason: mesh ? "Fused measured RGB-D surfaces." : "Depth was captured, but no stable connected surface could be extracted.",
      keyframes: usable.length,
      samples: samples.length,
      voxelSize: volume.voxelSize,
      dimensions: volume.dimensions,
      cells: volume.values.length,
      triangles: mesh?.triangleCount || 0,
    },
  };
}
