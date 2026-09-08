const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MIN_ROOM_DEPTH_METERS = 0.45;
const FALLBACK_COLOR = [108, 122, 116];
const CUBE_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const linearByte = (byte) => {
  const value = clamp((Number(byte) || 0) / 255, 0, 1);
  return Math.round(255 * (value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4));
};

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
    if (![point.x, point.y, point.z].every(Number.isFinite)) return;
    const index = y * columns + x;
    const target = index * 3;
    positions[target] = point.x;
    positions[target + 1] = point.y;
    positions[target + 2] = point.z;
    depths[index] = Number.isFinite(point.depth) ? point.depth : 0;
    validCount++;
    if (Array.isArray(point.color) && point.color.slice(0, 3).every(Number.isFinite)) {
      colors[target] = clamp(Math.round(point.color[0]), 0, 255);
      colors[target + 1] = clamp(Math.round(point.color[1]), 0, 255);
      colors[target + 2] = clamp(Math.round(point.color[2]), 0, 255);
      colorMask[index] = 1;
      coloredCount++;
    }
  });
  if (validCount < 6) return null;
  const image = options.colorImage;
  return {
    version: 3,
    geometryMode: options.geometryMode || "view-aligned-v1",
    columns,
    rows,
    positions,
    depths,
    colors,
    colorMask,
    colorImage: image?.data || null,
    colorWidth: image?.width || 0,
    colorHeight: image?.height || 0,
    colorChannels: image?.channels || 4,
    projectionMatrix: new Float32Array(options.projectionMatrix || []),
    transformMatrix: new Float32Array(options.transformMatrix || []),
    // Depth geometry is used for fusion. The XR/color view is retained
    // separately so camera pixels are projected with the camera that produced
    // them when the phone exposes a non-coincident depth sensor.
    viewProjectionMatrix: new Float32Array(
      options.viewProjectionMatrix || options.projectionMatrix || [],
    ),
    viewTransformMatrix: new Float32Array(
      options.viewTransformMatrix || options.transformMatrix || [],
    ),
    nativeDepthWidth: Number(options.nativeDepthWidth) || 0,
    nativeDepthHeight: Number(options.nativeDepthHeight) || 0,
    nativeDepthUvTransform: new Float32Array(
      options.nativeDepthUvTransform?.length === 16
        ? options.nativeDepthUvTransform
        : [],
    ),
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

function selectEvenly(values, limit) {
  if (values.length <= limit) return values;
  return Array.from({ length: limit }, (_, index) =>
    values[Math.floor((index * (values.length - 1)) / (limit - 1))],
  );
}

export function filterDepth(frame) {
  const filtered = new Float32Array(frame.depths.length);
  const confidence = new Uint8Array(frame.depths.length);
  let weakSupportedCount = 0;
  for (let y = 0; y < frame.rows; y++)
    for (let x = 0; x < frame.columns; x++) {
      const index = y * frame.columns + x;
      const center = frame.depths[index];
      if (
        !Number.isFinite(center) ||
        center < MIN_ROOM_DEPTH_METERS ||
        center > 8
      )
        continue;
      const range = Math.max(0.07, center * 0.045);
      let sum = center * 2;
      let weight = 2;
      let support = 0;
      let differenceSum = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY++)
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= frame.columns || nextY >= frame.rows) continue;
          const next = frame.depths[nextY * frame.columns + nextX];
          const difference = Math.abs(next - center);
          if (!Number.isFinite(next) || next <= 0 || difference > range) continue;
          const contribution = Math.exp(-(difference * difference) / (2 * range * range));
          sum += next * contribution;
          weight += contribution;
          differenceSum += difference;
          support++;
        }
      // Keep a real sensor sample when two neighboring pixels agree. These
      // lower-confidence edge samples cannot vote for free space and still
      // need repeated camera views before they become final geometry. Dropping
      // them here created avoidable holes around shelves, curtains, and other
      // thin or partly occluded surfaces.
      if (support >= 2) {
        filtered[index] = sum / weight;
        const agreement = 1 - clamp(differenceSum / support / range, 0, 1);
        confidence[index] = Math.round(255 * clamp((support / 8) * 0.7 + agreement * 0.3, 0.15, 1));
        if (support === 2) weakSupportedCount++;
      }
    }
  const measuredMask = Uint8Array.from(filtered, (depth) => depth > 0 ? 1 : 0);
  // Close only tiny one-pixel holes whose surrounding measurements agree.
  // Repeating this twice softens isolated sensor dropouts but cannot fill a
  // broad unscanned or reflective region.
  for (let pass = 0; pass < 2; pass++) {
    const source = new Float32Array(filtered);
    const sourceConfidence = new Uint8Array(confidence);
    for (let y = 1; y < frame.rows - 1; y++)
      for (let x = 1; x < frame.columns - 1; x++) {
        const index = y * frame.columns + x;
        if (source[index]) continue;
        const neighbors = [];
        for (let offsetY = -1; offsetY <= 1; offsetY++)
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            if (!offsetX && !offsetY) continue;
            const neighbor = (y + offsetY) * frame.columns + x + offsetX;
            if (source[neighbor])
              neighbors.push({
                depth: source[neighbor],
                confidence: sourceConfidence[neighbor],
              });
          }
        if (neighbors.length < 6) continue;
        neighbors.sort((left, right) => left.depth - right.depth);
        const median = neighbors[Math.floor(neighbors.length / 2)].depth;
        const agreement = Math.max(0.06, median * 0.035);
        const agreeing = neighbors.filter(
          (neighbor) => Math.abs(neighbor.depth - median) <= agreement,
        );
        if (agreeing.length < 6) continue;
        filtered[index] = median;
        confidence[index] = Math.round(
          Math.min(...agreeing.map((neighbor) => neighbor.confidence)) * 0.72,
        );
      }
  }
  // Repair modest, fully enclosed dropout islands. A depth sensor often
  // returns no value on a shiny patch even though the same wall is measured on
  // every side. Components touching the image edge, large openings, or depth
  // boundaries are deliberately left empty.
  const visited = new Uint8Array(filtered.length);
  const maximumHole = Math.max(
    12,
    Math.floor(frame.columns * frame.rows * 0.035),
  );
  for (let start = 0; start < filtered.length; start++) {
    if (filtered[start] || visited[start]) continue;
    const component = [];
    const boundary = [];
    const queue = [start];
    visited[start] = 1;
    let touchesEdge = false;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      component.push(index);
      const x = index % frame.columns;
      const y = Math.floor(index / frame.columns);
      if (!x || !y || x === frame.columns - 1 || y === frame.rows - 1)
        touchesEdge = true;
      [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].forEach(([nextX, nextY]) => {
        if (
          nextX < 0 ||
          nextY < 0 ||
          nextX >= frame.columns ||
          nextY >= frame.rows
        )
          return;
        const next = nextY * frame.columns + nextX;
        if (filtered[next]) boundary.push(next);
        else if (!visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      });
      if (component.length > maximumHole) touchesEdge = true;
    }
    if (touchesEdge || component.length > maximumHole || boundary.length < 8)
      continue;
    const depths = boundary
      .map((index) => filtered[index])
      .sort((left, right) => left - right);
    const median = depths[Math.floor(depths.length / 2)];
    if (depths[depths.length - 1] - depths[0] > Math.max(0.12, median * 0.06))
      continue;
    const repairedConfidence = Math.round(
      Math.min(...boundary.map((index) => confidence[index])) * 0.52,
    );
    component.forEach((index) => {
      filtered[index] = median;
      confidence[index] = repairedConfidence;
    });
  }
  return { filtered, confidence, measuredMask, weakSupportedCount };
}

export function depthPosition(frame, index, depth) {
  const p = frame.projectionMatrix;
  const m = frame.transformMatrix;
  // Keyframe storage is a normalized XR-view grid. Its cell centre is the
  // single source of truth for depth sampling, unprojection, filtering,
  // overlap checks, visibility checks, and hole repair.
  const u = ((index % frame.columns) + 0.5) / frame.columns;
  const v = (Math.floor(index / frame.columns) + 0.5) / frame.rows;
  const nx = u * 2 - 1;
  const ny = 1 - v * 2;
  const z = -depth;
  // Solve the projection at the measured camera-space Z, including off-axis
  // projections. Positions and filtered depths must describe the same surface.
  const a = p[0] - nx * p[3], b = p[4] - nx * p[7];
  const c = -(p[8] - nx * p[11]) * z - (p[12] - nx * p[15]);
  const d = p[1] - ny * p[3], e = p[5] - ny * p[7];
  const f = -(p[9] - ny * p[11]) * z - (p[13] - ny * p[15]);
  const determinant = a * e - b * d;
  if (Math.abs(determinant) < 1e-8) return null;
  const x = (c * e - b * f) / determinant;
  const y = (a * f - c * d) / determinant;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function prepareFrame(frame, frameId) {
  const projection = frame.projectionMatrix;
  const transform = frame.transformMatrix;
  if (projection?.length !== 16 || transform?.length !== 16) return null;
  if (![...projection, ...transform].every(Number.isFinite)) return null;
  const filtered = filterDepth(frame);
  const filteredDepth = filtered.filtered;
  const positions = new Float32Array(frame.positions.length).fill(NaN);
  const freeSpaceMask = new Uint8Array(filteredDepth.length);
  let valid = 0;
  filteredDepth.forEach((depth, index) => {
    if (!depth) return;
    const point = depthPosition(frame, index, depth);
    if (!point?.every(Number.isFinite)) {
      filteredDepth[index] = 0;
      return;
    }
    positions.set(point, index * 3);
    valid++;
    // An interpolated pixel or a silhouette must never erase real geometry.
    if (!filtered.measuredMask[index] || filtered.confidence[index] < 140) return;
    const x = index % frame.columns, y = Math.floor(index / frame.columns);
    if (!x || !y || x === frame.columns - 1 || y === frame.rows - 1) return;
    let agrees = true;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const neighbor = (y + dy) * frame.columns + x + dx;
        if (!filtered.measuredMask[neighbor] ||
            Math.abs(filteredDepth[neighbor] - depth) > Math.max(0.06, depth * 0.03))
          agrees = false;
      }
    if (agrees) freeSpaceMask[index] = 1;
  });
  if (valid < Math.max(40, frame.validCount * 0.18)) return null;
  return {
    ...frame,
    frameId,
    transformMatrix: new Float32Array(frame.transformMatrix),
    viewTransformMatrix:
      frame.viewTransformMatrix?.length === 16
        ? new Float32Array(frame.viewTransformMatrix)
        : new Float32Array(frame.transformMatrix),
    camera: new Float32Array(
      frame.camera || frame.transformMatrix.slice(12, 15),
    ),
    positions,
    filteredDepth,
    measuredMask: filtered.measuredMask,
    freeSpaceMask,
    depthConfidence: filtered.confidence,
    weakSupportedCount: filtered.weakSupportedCount,
    filteredCount: valid,
  };
}

function collectBoundsSamples(frames, limit = 42000) {
  const total = frames.reduce((sum, frame) => sum + frame.filteredCount, 0);
  const stride = Math.max(1, Math.ceil(total / limit));
  const samples = [];
  let cursor = 0;
  frames.forEach((frame) => {
    for (let index = 0; index < frame.filteredDepth.length; index++) {
      if (!frame.filteredDepth[index]) continue;
      const offset = index * 3;
      const sample = {
        x: frame.positions[offset],
        y: frame.positions[offset + 1],
        z: frame.positions[offset + 2],
      };
      if (![sample.x, sample.y, sample.z].every(Number.isFinite)) continue;
      if (cursor++ % stride === 0) samples.push(sample);
    }
  });
  return samples;
}

function buildAcceptedObservations(frames, limit = 20000) {
  const total = frames.reduce(
    (sum, frame) =>
      sum +
      frame.measuredMask.reduce((count, measured) => count + measured, 0),
    0,
  );
  const stride = Math.max(1, Math.ceil(total / limit));
  const positions = [];
  const colors = [];
  const colorMask = [];
  let cursor = 0;
  frames.forEach((frame) => {
    for (let index = 0; index < frame.measuredMask.length; index++) {
      if (!frame.measuredMask[index] || cursor++ % stride) continue;
      const offset = index * 3;
      const point = [
        frame.positions[offset],
        frame.positions[offset + 1],
        frame.positions[offset + 2],
      ];
      if (!point.every(Number.isFinite)) continue;
      positions.push(...point);
      if (frame.colorMask?.[index]) {
        colors.push(
          frame.colors[offset],
          frame.colors[offset + 1],
          frame.colors[offset + 2],
        );
        colorMask.push(1);
      } else {
        colors.push(0, 0, 0);
        colorMask.push(0);
      }
    }
  });
  return {
    version: 1,
    coordinateMode: "view-aligned-v1",
    count: positions.length / 3,
    sourceMeasuredCount: total,
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    colorMask: new Uint8Array(colorMask),
  };
}

function frameRoundTripDiagnostics(frame, limit = 160) {
  const stride = Math.max(1, Math.ceil(frame.filteredCount / limit));
  let cursor = 0;
  let checked = 0;
  let indexMismatches = 0;
  let maxDepthErrorMeters = 0;
  for (let index = 0; index < frame.filteredDepth.length; index++) {
    if (!frame.filteredDepth[index] || cursor++ % stride) continue;
    const offset = index * 3;
    const projected = projectWorld(
      frame,
      frame.positions[offset],
      frame.positions[offset + 1],
      frame.positions[offset + 2],
    );
    checked++;
    if (!projected || gridIndex(frame, projected.u, projected.v) !== index) {
      indexMismatches++;
      continue;
    }
    maxDepthErrorMeters = Math.max(
      maxDepthErrorMeters,
      Math.abs(projected.depth - frame.filteredDepth[index]),
    );
  }
  return {
    frameId: frame.frameId,
    checked,
    indexMismatches,
    maxDepthErrorMeters,
  };
}

function compareFrameDepths(first, second) {
  const errors = [];
  let agreeing = 0;
  const stride = Math.max(1, Math.ceil(first.filteredDepth.length / 180));
  for (let index = 0; index < first.filteredDepth.length; index += stride) {
    if (!first.measuredMask[index]) continue;
    const offset = index * 3;
    const projected = projectWorld(second,
      first.positions[offset], first.positions[offset + 1], first.positions[offset + 2]);
    if (!projected) continue;
    const target = gridIndex(second, projected.u, projected.v);
    if (!second.measuredMask[target]) continue;
    const measured = second.filteredDepth[target];
    const error = Math.abs(measured - projected.depth);
    errors.push(error);
    if (error <= Math.max(0.06, measured * 0.025)) agreeing++;
  }
  errors.sort((a, b) => a - b);
  return {
    compared: errors.length,
    agreeing,
    medianErrorMeters: errors.length ? errors[Math.floor(errors.length / 2)] : null,
  };
}

function validateFrameOverlap(frames, diagnostics = {}) {
  diagnostics.pairs = [];
  diagnostics.poseCorrectionApplied = false;
  if (frames.length < 2) return frames;
  const cellSize = 0.14;
  const cell = (x, y, z) => [
    Math.floor(x / cellSize),
    Math.floor(y / cellSize),
    Math.floor(z / cellSize),
  ];
  const key = (coordinates) => coordinates.join(",");
  const hasNeighbor = (occupied, coordinates) => {
    for (let z = -1; z <= 1; z++)
      for (let y = -1; y <= 1; y++)
        for (let x = -1; x <= 1; x++)
          if (occupied.has(key([
            coordinates[0] + x,
            coordinates[1] + y,
            coordinates[2] + z,
          ]))) return true;
    return false;
  };
  const spatialFrames = frames.map((frame) => {
    const occupied = new Set();
    const coordinates = [];
    const stride = Math.max(1, Math.ceil(frame.filteredCount / 260));
    let cursor = 0;
    for (let index = 0; index < frame.filteredDepth.length; index++) {
      if (!frame.filteredDepth[index]) continue;
      const offset = index * 3;
      const point = [
        frame.positions[offset],
        frame.positions[offset + 1],
        frame.positions[offset + 2],
      ];
      if (!point.every(Number.isFinite) || cursor++ % stride) continue;
      const next = cell(...point);
      const nextKey = key(next);
      if (!occupied.has(nextKey)) coordinates.push(next);
      occupied.add(nextKey);
    }
    return { occupied, coordinates };
  });
  const adjacency = Array.from({ length: frames.length }, () => []);
  for (let left = 0; left < frames.length; left++)
    for (let right = left + 1; right < frames.length; right++) {
      const first = spatialFrames[left];
      const second = spatialFrames[right];
      const source = first.coordinates.length <= second.coordinates.length
        ? first
        : second;
      const target = source === first ? second : first;
      if (!source.coordinates.length || !target.coordinates.length) continue;
      let overlap = 0;
      source.coordinates.forEach((coordinates) => {
        if (hasNeighbor(target.occupied, coordinates)) overlap++;
      });
      if (overlap / source.coordinates.length >= 0.025) {
        // Spatial proximity alone admits slightly shifted duplicate walls.
        // Require a shared surface to agree in projected depth as well. Hidden
        // parts may disagree; they are not treated as evidence of free space.
        const forward = compareFrameDepths(frames[left], frames[right]);
        const backward = compareFrameDepths(frames[right], frames[left]);
        const compared = forward.compared + backward.compared;
        const agreeing = forward.agreeing + backward.agreeing;
        const accepted = agreeing >= 12 && agreeing / Math.max(1, compared) >= 0.2;
        diagnostics.pairs.push({
          firstFrame: frames[left].frameId,
          secondFrame: frames[right].frameId,
          compared,
          agreeing,
          forwardMedianErrorMeters: forward.medianErrorMeters,
          backwardMedianErrorMeters: backward.medianErrorMeters,
          accepted,
        });
        if (!accepted) continue;
        adjacency[left].push(right);
        adjacency[right].push(left);
      }
    }
  const visited = new Uint8Array(frames.length);
  const components = [];
  for (let start = 0; start < frames.length; start++) {
    if (visited[start]) continue;
    const component = [];
    const queue = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      component.push(current);
      adjacency[current].forEach((next) => {
        if (visited[next]) return;
        visited[next] = 1;
        queue.push(next);
      });
    }
    components.push(component);
  }
  // A weak or corrupt first frame must not poison the entire scan. Keep the
  // largest mutually connected capture sequence, with valid sample count as a
  // tie breaker, and restore chronological order for fusion.
  const strongest = components.sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length;
    const samples = (component) => component.reduce(
      (sum, index) => sum + frames[index].filteredCount,
      0,
    );
    return samples(right) - samples(left);
  })[0] || [];
  diagnostics.selectedFrameIds = strongest.map((index) => frames[index].frameId);
  diagnostics.rejectedFrameIds = frames
    .filter((_, index) => !strongest.includes(index)).map((frame) => frame.frameId);
  return strongest.sort((left, right) => left - right).map((index) => frames[index]);
}

function percentile(values, fraction) {
  return values[Math.round((values.length - 1) * fraction)];
}

function sampleBounds(samples) {
  const bounds = { min: {}, max: {} };
  ["x", "y", "z"].forEach((axis) => {
    const values = samples.map((sample) => sample[axis]).sort((a, b) => a - b);
    bounds.min[axis] = percentile(values, 0.01);
    bounds.max[axis] = percentile(values, 0.99);
    if (bounds.max[axis] - bounds.min[axis] < 0.12) {
      const center = (bounds.min[axis] + bounds.max[axis]) / 2;
      bounds.min[axis] = center - 0.06;
      bounds.max[axis] = center + 0.06;
    }
  });
  return bounds;
}

function makeVolume(bounds, options) {
  const ranges = ["x", "y", "z"].map((axis) => bounds.max[axis] - bounds.min[axis]);
  const maxRange = Math.max(...ranges);
  const maxDimension = clamp(options.maxDimension || 96, 64, 112);
  let voxelSize = Math.max(options.minVoxelSize || 0.04, maxRange / (maxDimension - 5));
  const dimensionsFor = () => ranges.map((range) => Math.max(5, Math.ceil((range + voxelSize * 4) / voxelSize) + 1));
  let dimensions = dimensionsFor();
  const maxCells = options.maxCells || 700000;
  const cellCount = () => dimensions[0] * dimensions[1] * dimensions[2];
  if (cellCount() > maxCells) {
    voxelSize *= Math.cbrt(cellCount() / maxCells) * 1.01;
    dimensions = dimensionsFor();
  }
  const origin = {
    x: bounds.min.x - voxelSize * 2,
    y: bounds.min.y - voxelSize * 2,
    z: bounds.min.z - voxelSize * 2,
  };
  const count = cellCount();
  return {
    origin,
    dimensions,
    voxelSize,
    values: new Float32Array(count),
    weights: new Uint8Array(count),
    weightSums: new Float32Array(count),
    varianceSums: new Float32Array(count),
    depthSums: new Float32Array(count),
    freeSpaceVotes: new Uint8Array(count),
    colors: new Float32Array(count * 3),
    colorWeights: new Uint8Array(count),
  };
}

function volumeIndex(volume, x, y, z) {
  const [width, height] = volume.dimensions;
  return x + y * width + z * width * height;
}

function worldToView(frame, x, y, z) {
  const matrix = frame.transformMatrix;
  const dx = x - matrix[12];
  const dy = y - matrix[13];
  const dz = z - matrix[14];
  return {
    x: matrix[0] * dx + matrix[1] * dy + matrix[2] * dz,
    y: matrix[4] * dx + matrix[5] * dy + matrix[6] * dz,
    z: matrix[8] * dx + matrix[9] * dy + matrix[10] * dz,
  };
}

function projectView(frame, point) {
  const matrix = frame.projectionMatrix;
  const clipX = matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12];
  const clipY = matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13];
  const clipW = matrix[3] * point.x + matrix[7] * point.y + matrix[11] * point.z + matrix[15];
  if (!Number.isFinite(clipW) || clipW <= 0.00001) return null;
  const u = clipX / clipW * 0.5 + 0.5;
  const v = 0.5 - clipY / clipW * 0.5;
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
  return { u, v, depth: -point.z };
}

export function gridIndex(frame, u, v) {
  const x = clamp(Math.floor(u * frame.columns), 0, frame.columns - 1);
  const y = clamp(Math.floor(v * frame.rows), 0, frame.rows - 1);
  return y * frame.columns + x;
}

function sampleFrameColor(frame, u, v, depthIndex) {
  if (frame.colorImage?.length && frame.colorWidth && frame.colorHeight) {
    const x = clamp(Math.floor(u * frame.colorWidth), 0, frame.colorWidth - 1);
    const y = clamp(Math.floor((1 - v) * frame.colorHeight), 0, frame.colorHeight - 1);
    const offset = (y * frame.colorWidth + x) * frame.colorChannels;
    return [frame.colorImage[offset], frame.colorImage[offset + 1], frame.colorImage[offset + 2]];
  }
  if (!frame.colorMask?.[depthIndex]) return null;
  const offset = depthIndex * 3;
  return [frame.colors[offset], frame.colors[offset + 1], frame.colors[offset + 2]];
}

function integrateProjective(volume, frames, report) {
  const [width, height, depth] = volume.dimensions;
  const truncation = volume.voxelSize * 3.2;
  volume.truncation = truncation;
  const total = frames.length * depth;
  let completed = 0;
  frames.forEach((frame) => {
    for (let z = 0; z < depth; z++) {
      const worldZ = volume.origin.z + (z + 0.5) * volume.voxelSize;
      for (let y = 0; y < height; y++) {
        const worldY = volume.origin.y + (y + 0.5) * volume.voxelSize;
        for (let x = 0; x < width; x++) {
          const worldX = volume.origin.x + (x + 0.5) * volume.voxelSize;
          const view = worldToView(frame, worldX, worldY, worldZ);
          const projected = projectView(frame, view);
          if (!projected || projected.depth < 0.2) continue;
          const depthIndex = gridIndex(frame, projected.u, projected.v);
          const measuredDepth = frame.filteredDepth[depthIndex];
          if (!measuredDepth) continue;
          const signedDistance = measuredDepth - projected.depth;
          const index = volumeIndex(volume, x, y, z);
          // A ray proves that the space in front of its measured surface is
          // empty. Space behind that surface is merely occluded and must not be
          // used to delete a legitimate back wall behind shelves or furniture.
          if (signedDistance > truncation) {
            if (frame.freeSpaceMask[depthIndex])
              volume.freeSpaceVotes[index] = Math.min(
                255,
                volume.freeSpaceVotes[index] + 1,
              );
            continue;
          }
          // Hidden space is unknown regardless of its distance behind the
          // visible surface. It cannot invalidate an earlier wall observation.
          if (signedDistance < -truncation) continue;
          const previousViews = volume.weights[index];
          const previousWeight = volume.weightSums[index];
          const normalized = signedDistance / truncation;
          const localConfidence = (frame.depthConfidence[depthIndex] || 0) / 255;
          const distanceWeight = clamp(1.15 - projected.depth / 8, 0.25, 1);
          const sampleWeight = clamp(localConfidence * distanceWeight, 0.08, 1);
          const nextWeight = previousWeight + sampleWeight;
          const delta = normalized - volume.values[index];
          const nextMean = volume.values[index] + delta * sampleWeight / nextWeight;
          volume.varianceSums[index] += sampleWeight * delta * (normalized - nextMean);
          volume.values[index] = nextMean;
          volume.weightSums[index] = nextWeight;
          volume.depthSums[index] += projected.depth * sampleWeight;
          volume.weights[index] = Math.min(32, previousViews + 1);
          if (Math.abs(signedDistance) <= volume.voxelSize * 1.15) {
            const colorProjection = projectColorWorld(
              frame,
              worldX,
              worldY,
              worldZ,
            );
            const color = colorProjection
              ? sampleFrameColor(
                  frame,
                  colorProjection.u,
                  colorProjection.v,
                  depthIndex,
                )
              : null;
            if (color) {
              const colorWeight = volume.colorWeights[index];
              const offset = index * 3;
              color.forEach((channel, channelIndex) => {
                volume.colors[offset + channelIndex] =
                  (volume.colors[offset + channelIndex] * colorWeight + linearByte(channel)) /
                  (colorWeight + 1);
              });
              volume.colorWeights[index] = Math.min(32, colorWeight + 1);
            }
          }
        }
      }
      completed++;
      if (completed % 8 === 0)
        report?.("fusing", 18 + Math.round((completed / total) * 48));
    }
  });
  return volume.weights.reduce((count, weight) => count + (weight >= 2 ? 1 : 0), 0);
}

function regularizeVolume(volume) {
  const [width, height, depth] = volume.dimensions;
  const sourceValues = new Float32Array(volume.values);
  const sourceWeights = new Uint8Array(volume.weights);
  const directions = [
    [-1, 0, 0], [1, 0, 0], [0, -1, 0],
    [0, 1, 0], [0, 0, -1], [0, 0, 1],
  ];
  for (let z = 1; z < depth - 1; z++)
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const index = volumeIndex(volume, x, y, z);
        let valueSum = 0;
        let colorCount = 0;
        const colorSum = [0, 0, 0];
        let support = 0;
        directions.forEach(([dx, dy, dz]) => {
          const neighbor = volumeIndex(volume, x + dx, y + dy, z + dz);
          if (sourceWeights[neighbor] < 2) return;
          support++;
          valueSum += sourceValues[neighbor];
          if (volume.colorWeights[neighbor]) {
            const offset = neighbor * 3;
            colorSum[0] += volume.colors[offset];
            colorSum[1] += volume.colors[offset + 1];
            colorSum[2] += volume.colors[offset + 2];
            colorCount++;
          }
        });
        if (sourceWeights[index] >= 2 && support >= 4) {
          volume.values[index] = sourceValues[index] * 0.72 + valueSum / support * 0.28;
        } else if (!sourceWeights[index] && support >= 5) {
          // Repair only a one-voxel hole enclosed by measured neighbors. This
          // cannot bridge a doorway or a broad unscanned part of the room.
          volume.values[index] = valueSum / support;
          volume.weights[index] = 1;
          volume.weightSums[index] = 0.35;
          if (colorCount) {
            const offset = index * 3;
            volume.colors[offset] = colorSum[0] / colorCount;
            volume.colors[offset + 1] = colorSum[1] / colorCount;
            volume.colors[offset + 2] = colorSum[2] / colorCount;
            volume.colorWeights[index] = 1;
          }
        }
      }
}

function propagateSurfaceColors(volume, passes = 2) {
  const [width, height, depth] = volume.dimensions;
  const directions = [];
  for (let z = -1; z <= 1; z++)
    for (let y = -1; y <= 1; y++)
      for (let x = -1; x <= 1; x++)
        if (x || y || z) directions.push([x, y, z]);
  for (let pass = 0; pass < passes; pass++) {
    const sourceColors = new Float32Array(volume.colors);
    const sourceWeights = new Uint8Array(volume.colorWeights);
    for (let z = 1; z < depth - 1; z++)
      for (let y = 1; y < height - 1; y++)
        for (let x = 1; x < width - 1; x++) {
          const index = volumeIndex(volume, x, y, z);
          if (!volume.weights[index] || sourceWeights[index]) continue;
          let support = 0;
          const sum = [0, 0, 0];
          directions.forEach(([dx, dy, dz]) => {
            const neighbor = volumeIndex(volume, x + dx, y + dy, z + dz);
            if (!sourceWeights[neighbor]) return;
            // Propagate only along the same local signed-distance band so a
            // nearby object cannot paint across onto a wall.
            if (Math.abs(volume.values[neighbor] - volume.values[index]) > 0.22) return;
            const offset = neighbor * 3;
            sum[0] += sourceColors[offset];
            sum[1] += sourceColors[offset + 1];
            sum[2] += sourceColors[offset + 2];
            support++;
          });
          if (support < 4) continue;
          const offset = index * 3;
          volume.colors[offset] = sum[0] / support;
          volume.colors[offset + 1] = sum[1] / support;
          volume.colors[offset + 2] = sum[2] / support;
          volume.colorWeights[index] = 1;
        }
  }
}

function volumeCorner(volume, x, y, z) {
  const index = volumeIndex(volume, x, y, z);
  const colorOffset = index * 3;
  return {
    x: volume.origin.x + (x + 0.5) * volume.voxelSize,
    y: volume.origin.y + (y + 0.5) * volume.voxelSize,
    z: volume.origin.z + (z + 0.5) * volume.voxelSize,
    value: volume.values[index],
    weight: volume.weights[index],
    variance: volume.weightSums[index] > 0
      ? Math.sqrt(Math.max(0, volume.varianceSums[index] / volume.weightSums[index])) * volume.truncation
      : Infinity,
    meanDepth: volume.weightSums[index] > 0
      ? volume.depthSums[index] / volume.weightSums[index]
      : Infinity,
    freeSpaceVotes: volume.freeSpaceVotes[index],
    color: volume.colorWeights[index]
      ? [volume.colors[colorOffset], volume.colors[colorOffset + 1], volume.colors[colorOffset + 2]]
      : FALLBACK_COLOR.map(linearByte),
  };
}

function cellIndex(width, height, x, y, z) {
  return x + y * width + z * width * height;
}

function extractSurfaceNet(volume, report) {
  const [width, height, depth] = volume.dimensions;
  const cellWidth = width - 1;
  const cellHeight = height - 1;
  const cellDepth = depth - 1;
  const cellVertices = new Int32Array(cellWidth * cellHeight * cellDepth).fill(-1);
  const positions = [];
  const colors = [];
  const rejectionCounts = { insufficientSupport: 0, unstable: 0, freeSpace: 0 };
  for (let z = 0; z < cellDepth; z++)
    for (let y = 0; y < cellHeight; y++)
      for (let x = 0; x < cellWidth; x++) {
        const corners = CUBE_CORNERS.map(([dx, dy, dz]) => volumeCorner(volume, x + dx, y + dy, z + dz));
        // An unknown corner is not evidence of empty space. Allow a supported
        // boundary cell, but intersect only edges with measured endpoints.
        const known = corners.filter((corner) => corner.weight >= 1);
        if (known.length < 4) {
          rejectionCounts.insufficientSupport++;
          continue;
        }
        const reliable = (corner) => {
          const closeRange = corner.meanDepth < 0.9;
          const requiredViews = closeRange ? 4 : 2;
          const varianceLimit = closeRange
            ? Math.max(0.032, volume.voxelSize * 0.8)
            : Math.max(0.055, volume.voxelSize * 1.35);
          const contradictedByFreeSpace =
            corner.freeSpaceVotes >= Math.max(3, corner.weight * 1.25);
          return (
            corner.weight >= requiredViews &&
            corner.variance <= varianceLimit &&
            !contradictedByFreeSpace
          );
        };
        const confirmed = corners.filter(
          reliable,
        ).length;
        // Four independently reliable corners are sufficient to retain a
        // boundary cell. Edge intersections below still require measured
        // endpoints, so this cannot span a genuinely unknown opening.
        if (confirmed < 4) {
          const contradicted = known.some((corner) =>
            corner.freeSpaceVotes >= Math.max(3, corner.weight * 1.25));
          rejectionCounts[contradicted ? "freeSpace" : "unstable"]++;
          continue;
        }
        const negative = known.some((corner) => corner.value < 0);
        const positive = known.some((corner) => corner.value >= 0);
        if (!negative || !positive) continue;
        const intersections = [];
        CUBE_EDGES.forEach(([firstIndex, secondIndex]) => {
          const first = corners[firstIndex];
          const second = corners[secondIndex];
          if (first.weight < 1 || second.weight < 1) return;
          if ((first.value < 0) === (second.value < 0)) return;
          const amount = clamp(first.value / (first.value - second.value), 0, 1);
          intersections.push({
            x: first.x + (second.x - first.x) * amount,
            y: first.y + (second.y - first.y) * amount,
            z: first.z + (second.z - first.z) * amount,
            color: first.color.map((channel, index) => channel + (second.color[index] - channel) * amount),
          });
        });
        if (!intersections.length) continue;
        const vertex = intersections.reduce(
          (sum, point) => ({
            x: sum.x + point.x / intersections.length,
            y: sum.y + point.y / intersections.length,
            z: sum.z + point.z / intersections.length,
            color: sum.color.map((channel, index) => channel + point.color[index] / intersections.length),
          }),
          { x: 0, y: 0, z: 0, color: [0, 0, 0] },
        );
        const vertexIndex = positions.length / 3;
        positions.push(vertex.x, vertex.y, vertex.z);
        colors.push(...vertex.color.map((channel) => clamp(Math.round(channel), 0, 255)));
        cellVertices[cellIndex(cellWidth, cellHeight, x, y, z)] = vertexIndex;
      }
  report?.("meshing", 78);
  const indices = [];
  const addQuad = (a, b, c, d, reverse) => {
    if ([a, b, c, d].some((index) => index < 0)) return;
    if (reverse) indices.push(a, d, c, a, c, b);
    else indices.push(a, b, c, a, c, d);
  };
  const cell = (x, y, z) => cellVertices[cellIndex(cellWidth, cellHeight, x, y, z)];
  for (let z = 1; z < depth - 1; z++)
    for (let y = 1; y < height - 1; y++)
      for (let x = 0; x < width - 1; x++) {
        const first = volumeCorner(volume, x, y, z);
        const second = volumeCorner(volume, x + 1, y, z);
        if (first.weight >= 1 && second.weight >= 1 && (first.value < 0) !== (second.value < 0))
          addQuad(cell(x, y - 1, z - 1), cell(x, y, z - 1), cell(x, y, z), cell(x, y - 1, z), first.value < 0);
      }
  for (let z = 1; z < depth - 1; z++)
    for (let y = 0; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const first = volumeCorner(volume, x, y, z);
        const second = volumeCorner(volume, x, y + 1, z);
        if (first.weight >= 1 && second.weight >= 1 && (first.value < 0) !== (second.value < 0))
          addQuad(cell(x - 1, y, z - 1), cell(x - 1, y, z), cell(x, y, z), cell(x, y, z - 1), first.value < 0);
      }
  for (let z = 0; z < depth - 1; z++)
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const first = volumeCorner(volume, x, y, z);
        const second = volumeCorner(volume, x, y, z + 1);
        if (first.weight >= 1 && second.weight >= 1 && (first.value < 0) !== (second.value < 0))
          addQuad(cell(x - 1, y - 1, z), cell(x, y - 1, z), cell(x, y, z), cell(x - 1, y, z), first.value < 0);
      }
  return { positions: new Float32Array(positions), colors: new Uint8Array(colors), indices: new Uint32Array(indices), rejectionCounts };
}

function removeSmallComponents(mesh) {
  const vertexCount = mesh.positions.length / 3;
  const parent = new Int32Array(vertexCount);
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const join = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  for (let index = 0; index < vertexCount; index++) parent[index] = index;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    join(mesh.indices[index], mesh.indices[index + 1]);
    join(mesh.indices[index], mesh.indices[index + 2]);
  }
  const components = new Map();
  const triangleArea = (index) => {
    const a = mesh.indices[index] * 3;
    const b = mesh.indices[index + 1] * 3;
    const c = mesh.indices[index + 2] * 3;
    const abX = mesh.positions[b] - mesh.positions[a];
    const abY = mesh.positions[b + 1] - mesh.positions[a + 1];
    const abZ = mesh.positions[b + 2] - mesh.positions[a + 2];
    const acX = mesh.positions[c] - mesh.positions[a];
    const acY = mesh.positions[c + 1] - mesh.positions[a + 1];
    const acZ = mesh.positions[c + 2] - mesh.positions[a + 2];
    return Math.hypot(
      abY * acZ - abZ * acY,
      abZ * acX - abX * acZ,
      abX * acY - abY * acX,
    ) * 0.5;
  };
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const root = find(mesh.indices[index]);
    const component = components.get(root) || {
      area: 0,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    component.area += triangleArea(index);
    for (let corner = 0; corner < 3; corner++) {
      const offset = mesh.indices[index + corner] * 3;
      for (let axis = 0; axis < 3; axis++) {
        component.min[axis] = Math.min(component.min[axis], mesh.positions[offset + axis]);
        component.max[axis] = Math.max(component.max[axis], mesh.positions[offset + axis]);
      }
    }
    components.set(root, component);
  }
  const entries = [...components.entries()];
  if (!entries.length)
    return {
      ...mesh,
      indices: new Uint32Array(),
      surfaceArea: 0,
      componentCount: 0,
      keptComponentCount: 0,
      removedComponentCount: 0,
      dominantArea: 0,
      dominantAreaRatio: 0,
    };
  const totalArea = entries.reduce((sum, [, component]) => sum + component.area, 0);
  const minimumArea = Math.max(0.012, totalArea * 0.001);
  const [dominantRoot, dominant] = entries.reduce(
    (best, entry) => (!best[1] || entry[1].area > best[1].area ? entry : best),
    [null, null],
  );
  const boundsGap = (left, right) => Math.hypot(
    ...[0, 1, 2].map((axis) =>
      Math.max(0, left.min[axis] - right.max[axis], right.min[axis] - left.max[axis]),
    ),
  );
  const keptRoots = new Set(
    entries
      .filter(([root, component]) =>
        component.area >= minimumArea &&
        (root === dominantRoot ||
          component.area >= dominant.area * 0.12 ||
          (component.area >= dominant.area * 0.025 &&
            boundsGap(component, dominant) <= 0.22)),
      )
      .map(([root]) => root),
  );
  const kept = [];
  for (let index = 0; index < mesh.indices.length; index += 3)
    if (keptRoots.has(find(mesh.indices[index])))
      kept.push(mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]);
  const keptArea = entries
    .filter(([root]) => keptRoots.has(root))
    .reduce((sum, [, component]) => sum + component.area, 0);
  const dominantAreaRatio = keptArea
    ? Math.min(1, dominant.area / keptArea)
    : 0;
  return {
    ...mesh,
    indices: new Uint32Array(kept),
    surfaceArea: keptArea,
    componentCount: components.size,
    keptComponentCount: keptRoots.size,
    removedComponentCount: components.size - keptRoots.size,
    dominantArea: dominant.area,
    dominantAreaRatio,
  };
}

export function meshFragmentationIsUnacceptable(surface) {
  return (
    (surface.keptComponentCount || 0) > 8 &&
    (surface.dominantAreaRatio || 0) < 0.72
  );
}

export function meshWallStructureDiagnostics(mesh) {
  const triangles = [];
  let totalArea = 0;
  let verticalArea = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const offsets = [0, 1, 2].map(
      (corner) => mesh.indices[index + corner] * 3,
    );
    const ab = [0, 1, 2].map(
      (axis) =>
        mesh.positions[offsets[1] + axis] -
        mesh.positions[offsets[0] + axis],
    );
    const ac = [0, 1, 2].map(
      (axis) =>
        mesh.positions[offsets[2] + axis] -
        mesh.positions[offsets[0] + axis],
    );
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const twiceArea = Math.hypot(...normal);
    if (twiceArea < 0.00001) continue;
    const triangleArea = twiceArea * 0.5;
    totalArea += triangleArea;
    const nx = normal[0] / twiceArea;
    const ny = normal[1] / twiceArea;
    const nz = normal[2] / twiceArea;
    if (Math.abs(ny) > 0.45) continue;
    const horizontalLength = Math.hypot(nx, nz);
    if (horizontalLength < 0.75) continue;
    verticalArea += triangleArea;
    triangles.push({
      nx: nx / horizontalLength,
      nz: nz / horizontalLength,
      area: triangleArea,
    });
  }
  let bestAlignedArea = 0;
  let bestYawRadians = 0;
  const alignmentLimit = Math.cos((18 * Math.PI) / 180);
  for (let degree = 0; degree < 90; degree++) {
    const yaw = (degree * Math.PI) / 180;
    const ux = Math.cos(yaw);
    const uz = Math.sin(yaw);
    const vx = -uz;
    const vz = ux;
    let alignedArea = 0;
    triangles.forEach((triangle) => {
      const alignment = Math.max(
        Math.abs(triangle.nx * ux + triangle.nz * uz),
        Math.abs(triangle.nx * vx + triangle.nz * vz),
      );
      if (alignment >= alignmentLimit) alignedArea += triangle.area;
    });
    if (alignedArea > bestAlignedArea) {
      bestAlignedArea = alignedArea;
      bestYawRadians = yaw;
    }
  }
  return {
    totalArea,
    verticalArea,
    verticalShare: totalArea ? verticalArea / totalArea : 0,
    manhattanAlignedRatio: verticalArea
      ? bestAlignedArea / verticalArea
      : 1,
    bestYawRadians,
  };
}

export function meshOutsideRectangularRoomModel(diagnostics) {
  return (
    diagnostics.verticalArea >= 0.4 &&
    diagnostics.verticalShare >= 0.22 &&
    diagnostics.manhattanAlignedRatio < 0.52
  );
}

function stabilizeDominantWalls(mesh, voxelSize) {
  const groups = new Map();
  let verticalArea = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const offsets = [
      mesh.indices[index] * 3,
      mesh.indices[index + 1] * 3,
      mesh.indices[index + 2] * 3,
    ];
    const ab = [
      mesh.positions[offsets[1]] - mesh.positions[offsets[0]],
      mesh.positions[offsets[1] + 1] - mesh.positions[offsets[0] + 1],
      mesh.positions[offsets[1] + 2] - mesh.positions[offsets[0] + 2],
    ];
    const ac = [
      mesh.positions[offsets[2]] - mesh.positions[offsets[0]],
      mesh.positions[offsets[2] + 1] - mesh.positions[offsets[0] + 1],
      mesh.positions[offsets[2] + 2] - mesh.positions[offsets[0] + 2],
    ];
    let nx = ab[1] * ac[2] - ab[2] * ac[1];
    let ny = ab[2] * ac[0] - ab[0] * ac[2];
    let nz = ab[0] * ac[1] - ab[1] * ac[0];
    const twiceArea = Math.hypot(nx, ny, nz);
    if (twiceArea < 0.00001) continue;
    nx /= twiceArea;
    ny /= twiceArea;
    nz /= twiceArea;
    if (Math.abs(ny) > 0.28) continue;
    if (nx < 0 || (Math.abs(nx) < 0.0001 && nz < 0)) {
      nx *= -1;
      ny *= -1;
      nz *= -1;
    }
    const center = {
      x: offsets.reduce((sum, offset) => sum + mesh.positions[offset] / 3, 0),
      y: offsets.reduce((sum, offset) => sum + mesh.positions[offset + 1] / 3, 0),
      z: offsets.reduce((sum, offset) => sum + mesh.positions[offset + 2] / 3, 0),
    };
    const offset = nx * center.x + ny * center.y + nz * center.z;
    const area = twiceArea * 0.5;
    const angleBin = Math.round(Math.atan2(nz, nx) / (Math.PI / 36));
    const offsetBin = Math.round(offset / 0.08);
    const key = `${angleBin},${offsetBin}`;
    const group = groups.get(key) || { area: 0, nx: 0, ny: 0, nz: 0, offset: 0 };
    group.area += area;
    group.nx += nx * area;
    group.ny += ny * area;
    group.nz += nz * area;
    group.offset += offset * area;
    groups.set(key, group);
    verticalArea += area;
  }
  const planes = [...groups.values()]
    .filter((group) => group.area >= Math.max(0.22, verticalArea * 0.1))
    .sort((left, right) => right.area - left.area)
    .slice(0, 3)
    .map((group) => {
      const length = Math.hypot(group.nx, group.ny, group.nz) || 1;
      return {
        nx: group.nx / length,
        ny: group.ny / length,
        nz: group.nz / length,
        offset: group.offset / group.area,
      };
    });
  if (!planes.length) return { ...mesh, stabilizedPlaneCount: 0 };
  const positions = new Float32Array(mesh.positions);
  const normals = computeNormals(mesh);
  const distanceLimit = Math.max(0.035, voxelSize * 0.8);
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const normalOffset = vertex * 3;
    if (Math.abs(normals[normalOffset + 1]) > 0.38) continue;
    let best = null;
    planes.forEach((plane) => {
      const alignment = Math.abs(
        normals[normalOffset] * plane.nx +
        normals[normalOffset + 1] * plane.ny +
        normals[normalOffset + 2] * plane.nz,
      );
      if (alignment < 0.82) return;
      const distance =
        positions[normalOffset] * plane.nx +
        positions[normalOffset + 1] * plane.ny +
        positions[normalOffset + 2] * plane.nz -
        plane.offset;
      if (Math.abs(distance) > distanceLimit) return;
      if (!best || Math.abs(distance) < Math.abs(best.distance)) best = { plane, distance };
    });
    if (!best) continue;
    positions[normalOffset] -= best.plane.nx * best.distance * 0.78;
    positions[normalOffset + 1] -= best.plane.ny * best.distance * 0.78;
    positions[normalOffset + 2] -= best.plane.nz * best.distance * 0.78;
  }
  return { ...mesh, positions, stabilizedPlaneCount: planes.length };
}

function smoothPositions(mesh, passes = 2) {
  const count = mesh.positions.length / 3;
  const neighbors = Array.from({ length: count }, () => new Set());
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
    triangle.forEach((vertex, corner) => {
      neighbors[vertex].add(triangle[(corner + 1) % 3]);
      neighbors[vertex].add(triangle[(corner + 2) % 3]);
    });
  }
  let positions = new Float32Array(mesh.positions);
  const move = (source, factor) => {
    const target = new Float32Array(source);
    neighbors.forEach((adjacent, vertex) => {
      if (adjacent.size < 5) return;
      for (let axis = 0; axis < 3; axis++) {
        let average = 0;
        adjacent.forEach((next) => { average += source[next * 3 + axis] / adjacent.size; });
        target[vertex * 3 + axis] += (average - source[vertex * 3 + axis]) * factor;
      }
    });
    return target;
  };
  for (let pass = 0; pass < passes; pass++) {
    positions = move(positions, 0.34);
    positions = move(positions, -0.35);
  }
  return { ...mesh, positions };
}

function computeNormals(mesh) {
  const normals = new Float32Array(mesh.positions.length);
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.indices[index] * 3;
    const b = mesh.indices[index + 1] * 3;
    const c = mesh.indices[index + 2] * 3;
    const ab = [mesh.positions[b] - mesh.positions[a], mesh.positions[b + 1] - mesh.positions[a + 1], mesh.positions[b + 2] - mesh.positions[a + 2]];
    const ac = [mesh.positions[c] - mesh.positions[a], mesh.positions[c + 1] - mesh.positions[a + 1], mesh.positions[c + 2] - mesh.positions[a + 2]];
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    [a, b, c].forEach((offset) => normal.forEach((value, axis) => { normals[offset + axis] += value; }));
  }
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(normals[index], normals[index + 1], normals[index + 2]) || 1;
    normals[index] /= length;
    normals[index + 1] /= length;
    normals[index + 2] /= length;
  }
  return normals;
}

function imageLuminance(frame) {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < frame.colorImage.length; index += frame.colorChannels * 32) {
    sum += frame.colorImage[index] * 0.2126 + frame.colorImage[index + 1] * 0.7152 + frame.colorImage[index + 2] * 0.0722;
    count++;
  }
  return count ? sum / count : 128;
}

function buildAtlas(frames) {
  const images = frames.filter((frame) => frame.colorImage?.length && frame.colorWidth && frame.colorHeight);
  if (!images.length) return null;
  // Normalize differently sized/oriented keyframe copies into equal atlas
  // tiles. UVs remain normalized per frame, so this resampling preserves
  // correspondence while keeping atlas addressing uniform.
  const tileWidth = Math.max(...images.map((frame) => frame.colorWidth));
  const tileHeight = Math.max(...images.map((frame) => frame.colorHeight));
  const padding = 4;
  const strideX = tileWidth + padding * 2;
  const strideY = tileHeight + padding * 2;
  const columns = Math.ceil(Math.sqrt(images.length + 1));
  const rows = Math.ceil((images.length + 1) / columns);
  const width = columns * strideX;
  const height = rows * strideY;
  const data = new Uint8Array(width * height * 4).fill(255);
  const globalLuminance = images.reduce((sum, frame) => sum + imageLuminance(frame), 0) / images.length;
  images.forEach((frame, tile) => {
    const scale = clamp(globalLuminance / Math.max(24, imageLuminance(frame)), 0.78, 1.25);
    const tileX = tile % columns;
    const tileY = Math.floor(tile / columns);
    // Duplicate edge pixels through a gutter so mipmapping never blends one
    // camera keyframe into the neighboring atlas tile.
    for (let y = -padding; y < tileHeight + padding; y++)
      for (let x = -padding; x < tileWidth + padding; x++) {
        const tileSourceX = clamp(x, 0, tileWidth - 1);
        const tileSourceY = clamp(y, 0, tileHeight - 1);
        const sourceX = Math.round(
          (tileSourceX / Math.max(1, tileWidth - 1)) *
            (frame.colorWidth - 1),
        );
        const sourceY = Math.round(
          (tileSourceY / Math.max(1, tileHeight - 1)) *
            (frame.colorHeight - 1),
        );
        const source =
          (sourceY * frame.colorWidth + sourceX) * frame.colorChannels;
        const target = ((tileY * strideY + y + padding) * width + tileX * strideX + x + padding) * 4;
        data[target] = clamp(Math.round(frame.colorImage[source] * scale), 0, 255);
        data[target + 1] = clamp(Math.round(frame.colorImage[source + 1] * scale), 0, 255);
        data[target + 2] = clamp(Math.round(frame.colorImage[source + 2] * scale), 0, 255);
        data[target + 3] = 255;
      }
    frame.atlasTile = tile;
  });
  return {
    data,
    width,
    height,
    tileWidth,
    tileHeight,
    strideX,
    strideY,
    padding,
    columns,
    frames: images,
  };
}

export function projectWorld(frame, x, y, z) {
  return projectView(frame, worldToView(frame, x, y, z));
}

function projectColorWorld(frame, x, y, z) {
  if (
    frame.viewProjectionMatrix?.length !== 16 ||
    frame.viewTransformMatrix?.length !== 16
  )
    return projectWorld(frame, x, y, z);
  return projectView(
    {
      projectionMatrix: frame.viewProjectionMatrix,
    },
    worldToView(
      {
        transformMatrix: frame.viewTransformMatrix,
      },
      x,
      y,
      z,
    ),
  );
}

function texturedMesh(mesh, frames) {
  const atlas = buildAtlas(frames);
  const sharedNormals = computeNormals(mesh);
  if (!atlas) return { ...mesh, normals: sharedNormals, textureCoverage: 0 };
  atlas.frames.forEach((frame, textureId) => { frame.textureId = textureId; });
  const records = [];
  const vertexTriangles = Array.from(
    { length: mesh.positions.length / 3 },
    () => [],
  );
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
    const center = triangle.reduce((value, vertex) => ({
      x: value.x + mesh.positions[vertex * 3] / 3,
      y: value.y + mesh.positions[vertex * 3 + 1] / 3,
      z: value.z + mesh.positions[vertex * 3 + 2] / 3,
    }), { x: 0, y: 0, z: 0 });
    const normal = triangle.reduce((value, vertex) => ({
      x: value.x + sharedNormals[vertex * 3] / 3,
      y: value.y + sharedNormals[vertex * 3 + 1] / 3,
      z: value.z + sharedNormals[vertex * 3 + 2] / 3,
    }), { x: 0, y: 0, z: 0 });
    const candidates = [];
    atlas.frames.forEach((frame) => {
      const colorProjection = projectColorWorld(
        frame,
        center.x,
        center.y,
        center.z,
      );
      const depthProjection = projectWorld(
        frame,
        center.x,
        center.y,
        center.z,
      );
      if (
        !colorProjection ||
        !depthProjection ||
        colorProjection.u < 0.015 ||
        colorProjection.v < 0.015 ||
        colorProjection.u > 0.985 ||
        colorProjection.v > 0.985 ||
        depthProjection.u < 0.015 ||
        depthProjection.v < 0.015 ||
        depthProjection.u > 0.985 ||
        depthProjection.v > 0.985
      )
        return;
      const colorProjections = triangle.map((vertex) => projectColorWorld(
        frame,
        mesh.positions[vertex * 3],
        mesh.positions[vertex * 3 + 1],
        mesh.positions[vertex * 3 + 2],
      ));
      if (colorProjections.some((value) =>
        !value || value.u < 0.01 || value.v < 0.01 || value.u > 0.99 || value.v > 0.99)) return;
      // Visibility belongs to the depth camera/grid. Color UVs are only used
      // after the surface has passed that independent occlusion check.
      const depthIndex = gridIndex(
        frame,
        depthProjection.u,
        depthProjection.v,
      );
      const centerX = depthIndex % frame.columns;
      const centerY = Math.floor(depthIndex / frame.columns);
      let closestAgreement = Infinity;
      let closestDepth = 0;
      // Mesh vertices can land just across a depth-pixel boundary after TSDF
      // smoothing. Check the immediate neighborhood rather than incorrectly
      // declaring that otherwise visible triangle untextured.
      for (let offsetY = -1; offsetY <= 1; offsetY++)
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const x = centerX + offsetX;
          const y = centerY + offsetY;
          if (x < 0 || y < 0 || x >= frame.columns || y >= frame.rows) continue;
          const measured = frame.filteredDepth[y * frame.columns + x];
          if (!measured) continue;
          const difference = Math.abs(measured - depthProjection.depth);
          if (difference < closestAgreement) {
            closestAgreement = difference;
            closestDepth = measured;
          }
        }
      if (
        !closestDepth ||
        closestAgreement > Math.max(0.2, closestDepth * 0.09)
      )
        return;
      const dx = frame.transformMatrix[12] - center.x;
      const dy = frame.transformMatrix[13] - center.y;
      const dz = frame.transformMatrix[14] - center.z;
      const distance = Math.hypot(dx, dy, dz) || 1;
      const facing = Math.abs((normal.x * dx + normal.y * dy + normal.z * dz) / distance);
      candidates.push({
        frame,
        projections: colorProjections,
        score: facing * 2 + 1 / distance,
      });
    });
    candidates.sort((left, right) => right.score - left.score);
    const record = { triangle, candidates: candidates.slice(0, 3), selected: 0 };
    const recordIndex = records.length;
    records.push(record);
    triangle.forEach((vertex) => vertexTriangles[vertex].push(recordIndex));
  }
  // Neighboring triangles prefer the same one of their valid top-three
  // camera views. Two passes remove most per-triangle exposure seams without
  // ever selecting a frame that failed the depth/visibility checks.
  for (let pass = 0; pass < 2; pass++)
    records.forEach((record, recordIndex) => {
      if (record.candidates.length < 2) return;
      const votes = new Map();
      record.triangle.forEach((vertex) =>
        vertexTriangles[vertex].forEach((neighborIndex) => {
          if (neighborIndex === recordIndex) return;
          const neighbor = records[neighborIndex];
          const frame = neighbor.candidates[neighbor.selected]?.frame;
          if (frame) votes.set(frame.textureId, (votes.get(frame.textureId) || 0) + 1);
        }),
      );
      let selected = 0;
      let selectedScore = -Infinity;
      record.candidates.forEach((candidate, candidateIndex) => {
        const score = candidate.score + (votes.get(candidate.frame.textureId) || 0) * 0.32;
        if (score > selectedScore) {
          selected = candidateIndex;
          selectedScore = score;
        }
      });
      record.selected = selected;
    });
  const positions = [];
  const normals = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  let texturedTriangles = 0;
  records.forEach((record) => {
    const triangle = record.triangle;
    const best = record.candidates[record.selected] || null;
    if (best) texturedTriangles++;
    triangle.forEach((vertex, corner) => {
      const target = positions.length / 3;
      positions.push(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
      normals.push(sharedNormals[vertex * 3], sharedNormals[vertex * 3 + 1], sharedNormals[vertex * 3 + 2]);
      if (best) {
        const projected = best.projections[corner];
        const tileX = best.frame.atlasTile % atlas.columns;
        const tileY = Math.floor(best.frame.atlasTile / atlas.columns);
        const u = projected ? projected.u : 0.5;
        const v = projected ? 1 - projected.v : 0.5;
        uvs.push((tileX * atlas.strideX + atlas.padding + u * (atlas.tileWidth - 1) + 0.5) / atlas.width);
        uvs.push((tileY * atlas.strideY + atlas.padding + v * (atlas.tileHeight - 1) + 0.5) / atlas.height);
        colors.push(255, 255, 255);
      } else {
        const blankTile = atlas.frames.length;
        const tileX = blankTile % atlas.columns;
        const tileY = Math.floor(blankTile / atlas.columns);
        uvs.push(
          (tileX * atlas.strideX + atlas.strideX * 0.5) / atlas.width,
          (tileY * atlas.strideY + atlas.strideY * 0.5) / atlas.height,
        );
        colors.push(mesh.colors[vertex * 3], mesh.colors[vertex * 3 + 1], mesh.colors[vertex * 3 + 2]);
      }
      indices.push(target);
    });
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Uint8Array(colors),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    texture: { data: atlas.data, width: atlas.width, height: atlas.height },
    textureCoverage: mesh.indices.length ? Math.round(texturedTriangles / (mesh.indices.length / 3) * 100) : 0,
  };
}

function meshBounds(positions, floorY) {
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (let index = 0; index < positions.length; index += 3) {
    positions[index + 1] -= floorY;
    ["x", "y", "z"].forEach((axis, offset) => {
      bounds.min[axis] = Math.min(bounds.min[axis], positions[index + offset]);
      bounds.max[axis] = Math.max(bounds.max[axis], positions[index + offset]);
    });
  }
  return bounds;
}

// When conservative multi-view fusion cannot close enough TSDF cells, retain a
// continuous surface from the strongest measured RGB-D view. This is deliberately
// a single-view fallback: combining unregistered frame meshes is what previously
// produced layered shards. Depth discontinuities stay open, so this does not
// bridge doors, furniture edges, or unscanned areas.
function measuredDepthFallback(frames, options, failureReason, details = {}) {
  if (frames.length < 2) return null;
  const frame = [...frames].sort((left, right) => {
    const score = (value) => {
      const depths = [];
      const stride = Math.max(1, Math.ceil(value.filteredCount / 320));
      let cursor = 0;
      value.filteredDepth.forEach((depth) => {
        if (depth && cursor++ % stride === 0) depths.push(depth);
      });
      depths.sort((a, b) => a - b);
      const medianDepth = depths[Math.floor(depths.length / 2)] || 1;
      const colorCoverage =
        (value.coloredCount || 0) / Math.max(1, value.validCount);
      // At equal pixel coverage, a farther frame observes more physical wall
      // area and is a better room fallback than a narrow close-up.
      return value.filteredCount * medianDepth * medianDepth * (1 + colorCoverage);
    };
    return score(right) - score(left);
  })[0];
  const vertexMap = new Int32Array(frame.columns * frame.rows).fill(-1);
  const positions = [];
  const colors = [];
  for (let index = 0; index < frame.filteredDepth.length; index++) {
    if (!frame.filteredDepth[index]) continue;
    const offset = index * 3;
    const point = [
      frame.positions[offset],
      frame.positions[offset + 1],
      frame.positions[offset + 2],
    ];
    if (!point.every(Number.isFinite)) continue;
    vertexMap[index] = positions.length / 3;
    positions.push(...point);
    const color = sampleFrameColor(
      frame,
      ((index % frame.columns) + 0.5) / frame.columns,
      (Math.floor(index / frame.columns) + 0.5) / frame.rows,
      index,
    );
    colors.push(...(color ? color.map(linearByte) : FALLBACK_COLOR.map(linearByte)));
  }
  const indices = [];
  const triangleIsContinuous = (gridIndices) => {
    if (gridIndices.some((index) => vertexMap[index] < 0)) return false;
    const depths = gridIndices.map((index) => frame.filteredDepth[index]);
    const nearest = Math.min(...depths);
    const depthRange = Math.max(...depths) - nearest;
    if (depthRange > Math.max(0.1, nearest * 0.065)) return false;
    const vertices = gridIndices.map((index) => vertexMap[index] * 3);
    for (let edge = 0; edge < 3; edge++) {
      const first = vertices[edge];
      const second = vertices[(edge + 1) % 3];
      const distance = Math.hypot(
        positions[first] - positions[second],
        positions[first + 1] - positions[second + 1],
        positions[first + 2] - positions[second + 2],
      );
      if (distance > Math.max(0.18, nearest * 0.22)) return false;
    }
    return true;
  };
  const addTriangle = (a, b, c) => {
    if (!triangleIsContinuous([a, b, c])) return;
    indices.push(vertexMap[a], vertexMap[b], vertexMap[c]);
  };
  for (let y = 0; y < frame.rows - 1; y++)
    for (let x = 0; x < frame.columns - 1; x++) {
      const topLeft = y * frame.columns + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + frame.columns;
      const bottomRight = bottomLeft + 1;
      addTriangle(topLeft, bottomLeft, topRight);
      addTriangle(topRight, bottomLeft, bottomRight);
    }
  let surface = removeSmallComponents({
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
  });
  if (surface.indices.length < 24 || surface.surfaceArea < 0.025) return null;
  const textured = texturedMesh(surface, [frame]);
  const floorY = Number.isFinite(options.floorY) ? options.floorY : 0;
  const mesh = {
    version: 3,
    kind: "measured-depth-surface",
    ...textured,
    vertexCount: textured.positions.length / 3,
    triangleCount: textured.indices.length / 3,
    floorY,
    bounds: meshBounds(textured.positions, floorY),
    observer: {
      x: options.observer?.x || 0,
      y: 1.6,
      z: options.observer?.z || 0,
    },
  };
  return {
    mesh,
    observations: buildAcceptedObservations([frame]),
    diagnostics: {
      ...details,
      reason: `A continuous measured depth surface was used because ${failureReason}`,
      fallback: "strongest-measured-view",
      keyframes: frames.length,
      triangles: mesh.triangleCount,
      surfaceArea: surface.surfaceArea,
      textureCoverage: mesh.textureCoverage,
    },
  };
}

export function fuseRgbdKeyframes(keyframes, options = {}, report) {
  report?.("preparing", 3);
  const ambiguousLegacyKeyframes = keyframes.filter(
    (frame) => frame?.legacyGeometryAmbiguous,
  ).length;
  const prepared = keyframes
    .map((frame, frameId) => ({ frame, frameId }))
    .filter(
      ({ frame }) =>
        frame?.tracking !== false && !frame?.legacyGeometryAmbiguous,
    )
    .map(({ frame, frameId }) => prepareFrame(frame, frameId))
    .filter(Boolean);
  const alignment = {};
  const overlapping = validateFrameOverlap(prepared, alignment);
  alignment.poseRefinement = "disabled-until-independently-validated";
  const usable = selectEvenly(
    overlapping,
    options.maxKeyframes || 40,
  );
  const stages = {
    algorithmVersion: 7,
    coordinateMode: "view-aligned-v1",
    inputKeyframes: keyframes.length,
    ambiguousLegacyKeyframes,
    preparedKeyframes: prepared.length,
    inputDepthSamples: keyframes.reduce((sum, frame) => sum + (frame?.validCount || 0), 0),
    filteredDepthSamples: prepared.reduce((sum, frame) => sum + frame.filteredCount, 0),
    weakDepthSamplesRetained: prepared.reduce(
      (sum, frame) => sum + (frame.weakSupportedCount || 0),
      0,
    ),
    roundTrip: prepared.map((frame) => frameRoundTripDiagnostics(frame)),
    alignment,
    fusedFrameIds: usable.map((frame) => frame.frameId),
  };
  const failure = (reason, details = {}) => ({
    mesh: null,
    observations: buildAcceptedObservations(usable.length ? usable : prepared),
    diagnostics: { ...stages, ...details, reason },
  });
  if (ambiguousLegacyKeyframes && !prepared.length)
    return failure(
      "This older diagnostic capture used ambiguous depth-buffer coordinates. Record a fresh scan with the repaired view-aligned geometry format.",
    );
  if (usable.length < 2)
    return measuredDepthFallback(
      prepared,
      options,
      "the captured views could not be aligned for multi-view fusion.",
      { ...stages, overlappingKeyframes: usable.length },
    ) || failure("At least two overlapping depth views are required.", { keyframes: usable.length });
  const samples = collectBoundsSamples(usable);
  if (samples.length < 400)
    return measuredDepthFallback(
      usable,
      options,
      "there were not enough samples for multi-view fusion.",
      { ...stages, samples: samples.length },
    ) || failure("Not enough filtered RGB-D samples for a surface.", { keyframes: usable.length, samples: samples.length });
  const bounds = sampleBounds(samples);
  const volume = makeVolume(bounds, options);
  report?.("fusing", 16, { voxelSize: volume.voxelSize, dimensions: volume.dimensions });
  const confirmedVoxels = integrateProjective(volume, usable, report);
  if (confirmedVoxels < 120)
    return measuredDepthFallback(
      usable,
      options,
      "the captured views did not overlap enough for full fusion.",
      { ...stages, confirmedVoxels, voxelSize: volume.voxelSize },
    ) || failure("The captured views do not overlap enough for a reliable surface.", { keyframes: usable.length, confirmedVoxels, voxelSize: volume.voxelSize });
  regularizeVolume(volume);
  propagateSurfaceColors(volume);
  report?.("meshing", 68);
  let surface = extractSurfaceNet(volume, report);
  stages.cellRejections = surface.rejectionCounts;
  stages.trianglesBeforeCleanup = surface.indices.length / 3;
  surface = removeSmallComponents(surface);
  stages.trianglesAfterCleanup = surface.indices.length / 3;
  stages.componentCount = surface.componentCount;
  stages.keptComponentCount = surface.keptComponentCount;
  stages.dominantAreaRatio = surface.dominantAreaRatio;
  const highlyFragmented = meshFragmentationIsUnacceptable(surface);
  const wallStructure = meshWallStructureDiagnostics(surface);
  stages.wallStructure = wallStructure;
  stages.rectangularRoomModelCompatible =
    !meshOutsideRectangularRoomModel(wallStructure);
  const surfaceFailureReason = highlyFragmented
    ? "multi-view fusion only produced disconnected fragments."
    : "multi-view fusion did not produce enough reliable surface area.";
  if (
    !surface.indices.length ||
    surface.surfaceArea < 0.04 ||
    highlyFragmented
  )
    return measuredDepthFallback(
      usable,
      options,
      surfaceFailureReason,
      {
        ...stages,
        confirmedVoxels,
        voxelSize: volume.voxelSize,
        fusedSurfaceArea: surface.surfaceArea,
        fusedTriangles: surface.indices.length / 3,
        fragmented: highlyFragmented,
        rectangularRoomModelCompatible:
          stages.rectangularRoomModelCompatible,
      },
    ) || failure("The fused surface did not pass measured-surface quality checks.", { keyframes: usable.length, confirmedVoxels, surfaceArea: surface.surfaceArea, triangles: surface.indices.length / 3, fragmented: highlyFragmented, rectangularRoomModelCompatible: stages.rectangularRoomModelCompatible });
  surface = stages.rectangularRoomModelCompatible
    ? stabilizeDominantWalls(surface, volume.voxelSize)
    : { ...surface, stabilizedPlaneCount: 0 };
  surface = smoothPositions(surface, options.smoothingPasses ?? 3);
  report?.("texturing", 88);
  const textured = texturedMesh(surface, usable);
  const floorY = Number.isFinite(options.floorY) ? options.floorY : 0;
  const mesh = {
    version: 3,
    kind: "projective-tsdf-surface-net",
    ...textured,
    vertexCount: textured.positions.length / 3,
    triangleCount: textured.indices.length / 3,
    floorY,
    bounds: meshBounds(textured.positions, floorY),
    observer: { x: options.observer?.x || 0, y: 1.6, z: options.observer?.z || 0 },
  };
  return {
    mesh,
    observations: buildAcceptedObservations(usable),
    diagnostics: {
      ...stages,
      reason: "Projective RGB-D fusion completed.",
      keyframes: usable.length,
      rejectedKeyframes: prepared.length - usable.length,
      samples: samples.length,
      confirmedVoxels,
      voxelSize: volume.voxelSize,
      dimensions: volume.dimensions,
      cells: volume.values.length,
      triangles: mesh.triangleCount,
      surfaceArea: surface.surfaceArea,
      stabilizedPlanes: surface.stabilizedPlaneCount || 0,
      components: surface.componentCount || 1,
      keptComponents: surface.keptComponentCount || 1,
      dominantAreaRatio: surface.dominantAreaRatio ?? 1,
      wallStructure,
      removedComponents: surface.removedComponentCount || 0,
      textureCoverage: mesh.textureCoverage,
    },
  };
}
