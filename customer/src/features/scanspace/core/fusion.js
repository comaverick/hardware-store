const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MIN_ROOM_DEPTH_METERS = 0.45;
const MIN_INDEPENDENT_VIEW_METERS = 0.04;
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
  const transformMatrix = new Float32Array(options.transformMatrix || []);
  const cameraCoordinate = (name, offset) =>
    Number.isFinite(options.camera?.[name])
      ? options.camera[name]
      : Number.isFinite(transformMatrix[offset])
        ? transformMatrix[offset]
        : 0;
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
    transformMatrix,
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
      cameraCoordinate("x", 12),
      cameraCoordinate("y", 13),
      cameraCoordinate("z", 14),
    ]),
    linearSpeed: Number(options.linearSpeed) || 0,
    angularSpeed: Number(options.angularSpeed) || 0,
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
    const measured = sampleProjectiveDepth(second, projected.u, projected.v);
    if (!measured) continue;
    const error = Math.abs(measured - projected.depth);
    errors.push(error);
    if (error <= Math.max(0.06, measured * 0.025)) agreeing++;
  }
  errors.sort((a, b) => a - b);
  return {
    compared: errors.length,
    agreeing,
    medianErrorMeters: errors.length ? errors[Math.floor(errors.length / 2)] : null,
    upperErrorMeters: errors.length ? errors[Math.floor((errors.length - 1) * 0.75)] : null,
  };
}

function validateFrameOverlap(frames, diagnostics = {}, limits = {}) {
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
        const agreementRatio = agreeing / Math.max(1, compared);
        const medianError = Math.min(
          forward.medianErrorMeters ?? Infinity,
          backward.medianErrorMeters ?? Infinity,
        );
        const upperError = Math.min(
          forward.upperErrorMeters ?? Infinity,
          backward.upperErrorMeters ?? Infinity,
        );
        const accepted =
          agreeing >= (limits.minimumAgreeing || 12) &&
          agreementRatio >= (limits.minimumAgreementRatio || 0.4) &&
          medianError <= (limits.maximumMedianError || 0.075) &&
          upperError <= (limits.maximumUpperError || 0.14);
        diagnostics.pairs.push({
          firstFrame: frames[left].frameId,
          secondFrame: frames[right].frameId,
          compared,
          agreeing,
          agreementRatio,
          forwardMedianErrorMeters: forward.medianErrorMeters,
          backwardMedianErrorMeters: backward.medianErrorMeters,
          forwardUpperErrorMeters: forward.upperErrorMeters,
          backwardUpperErrorMeters: backward.upperErrorMeters,
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
  const surfaceMode = options.completionMode === "surface";
  const maxDimension = clamp(
    options.maxDimension || (surfaceMode ? 144 : 96),
    64,
    surfaceMode ? 160 : 112,
  );
  let voxelSize = Math.max(
    options.minVoxelSize || (surfaceMode ? 0.025 : 0.04),
    maxRange / (maxDimension - 5),
  );
  const dimensionsFor = () => ranges.map((range) => Math.max(5, Math.ceil((range + voxelSize * 4) / voxelSize) + 1));
  let dimensions = dimensionsFor();
  const maxCells = options.maxCells || (surfaceMode ? 1200000 : 700000);
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
  const firstViewIds = new Uint8Array(count);
  firstViewIds.fill(255);
  return {
    origin,
    dimensions,
    voxelSize,
    values: new Float32Array(count),
    weights: new Uint8Array(count),
    viewpointCounts: new Uint8Array(count),
    firstViewIds,
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

// Samples are at pixel CENTRES. Nearest-pixel sampling makes an angled wall
// into depth steps; camera motion changes those steps and introduces artificial
// disagreement into the variance test. Inverse depth is linear on a plane.
// Interpolate only a complete, continuous measured footprint; missing pixels
// and foreground/background transitions retain the original nearest sample.
export function sampleProjectiveDepth(frame, u, v) {
  const depths = frame.filteredDepth;
  const nearest = depths[gridIndex(frame, u, v)];
  if (!nearest) return 0;
  const px = u * frame.columns - 0.5;
  const py = v * frame.rows - 0.5;
  const x = Math.floor(px), y = Math.floor(py);
  if (x < 0 || y < 0 || x + 1 >= frame.columns || y + 1 >= frame.rows)
    return nearest;
  const i = y * frame.columns + x;
  const a = depths[i], b = depths[i + 1];
  const c = depths[i + frame.columns], d = depths[i + frame.columns + 1];
  if (!a || !b || !c || !d) return nearest;
  const min = Math.min(a, b, c, d);
  if (Math.max(a, b, c, d) - min > Math.max(0.08, min * 0.06))
    return nearest;
  const tx = px - x, ty = py - y;
  return 1 / ((1 - ty) * ((1 - tx) / a + tx / b) +
    ty * ((1 - tx) / c + tx / d));
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
  frames.forEach((frame, frameIndex) => {
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
          const measuredDepth = sampleProjectiveDepth(frame, projected.u, projected.v);
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
          if (!volume.viewpointCounts[index]) {
            volume.viewpointCounts[index] = 1;
            volume.firstViewIds[index] = frameIndex;
          } else if (volume.viewpointCounts[index] === 1) {
            const firstCamera = frames[volume.firstViewIds[index]]?.camera;
            if (
              firstCamera &&
              Math.hypot(
                frame.camera[0] - firstCamera[0],
                frame.camera[1] - firstCamera[1],
                frame.camera[2] - firstCamera[2],
              ) >= MIN_INDEPENDENT_VIEW_METERS
            )
              volume.viewpointCounts[index] = 2;
          }
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
  return volume.viewpointCounts.reduce(
    (count, viewpoints) => count + (viewpoints >= 2 ? 1 : 0),
    0,
  );
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
    viewpoints: volume.viewpointCounts[index],
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

function extractSurfaceNet(volume, report, options = {}) {
  const [width, height, depth] = volume.dimensions;
  const cellWidth = width - 1;
  const cellHeight = height - 1;
  const cellDepth = depth - 1;
  const cellVertices = new Int32Array(cellWidth * cellHeight * cellDepth).fill(-1);
  const positions = [];
  const colors = [];
  const rejectionCounts = {
    insufficientSupport: 0,
    unstable: 0,
    highVariance: 0,
    freeSpace: 0,
    coherentRecovery: 0,
  };
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
          const requiredViews = options.surfaceMode
            // Most real walls have only two useful translated depth views.
            // Requiring a third far-range view discarded large valid regions
            // when the user scanned a wall from one side to the other.
            ? (closeRange ? 4 : 2)
            : (closeRange ? 4 : 2);
          // Partial measured surfaces must not average incompatible depth
          // layers into a smooth-looking but physically bent sheet. The
          // tighter limits are applied only when independent viewpoints exist;
          // uncertain reflective measurements remain open instead.
          const varianceLimit = options.surfaceMode
            ? closeRange
              ? Math.max(0.028, volume.voxelSize * 0.72)
              : Math.max(0.05, volume.voxelSize * 1.2)
            : closeRange
              ? Math.max(0.032, volume.voxelSize * 0.8)
              : Math.max(0.055, volume.voxelSize * 1.35);
          const contradictedByFreeSpace =
            corner.freeSpaceVotes >= Math.max(3, corner.weight * 1.25);
          const repeatedVariance =
            corner.viewpoints >= (options.surfaceMode ? 3 : 2);
          return (
            corner.weight >= requiredViews &&
            corner.viewpoints >= 2 &&
            (!repeatedVariance || corner.variance <= varianceLimit) &&
            !contradictedByFreeSpace
          );
        };
        const confirmed = corners.filter(
          reliable,
        ).length;
        // A partial wall is often intentionally captured from only one or two
        // translated viewpoints. Recover that measured cell when its known
        // corners agree on one local depth layer. This does not bridge an
        // unknown cell: four measured corners, a zero-crossing, and no free
        // space contradiction are still required below.
        const measuredDepths = known
          .map((corner) => corner.meanDepth)
          .filter(Number.isFinite);
        const measuredDepthSpan = measuredDepths.length
          ? Math.max(...measuredDepths) - Math.min(...measuredDepths)
          : Infinity;
        const repeatedContradiction = known.some((corner) => {
          const closeRange = corner.meanDepth < 0.9;
          const varianceLimit = closeRange
            ? Math.max(0.028, volume.voxelSize * 0.72)
            : Math.max(0.05, volume.voxelSize * 1.2);
          return corner.viewpoints >= 3 && corner.variance > varianceLimit;
        });
        const coherentRecovery =
          options.surfaceMode &&
          known.length >= 4 &&
          measuredDepths.length === known.length &&
          measuredDepthSpan <= Math.max(0.12, volume.voxelSize * 5) &&
          !repeatedContradiction &&
          !known.some((corner) =>
            corner.freeSpaceVotes >= Math.max(3, corner.weight * 1.25),
          );
        // Four independently reliable corners are sufficient to retain a
        // boundary cell. Edge intersections below still require measured
        // endpoints, so this cannot span a genuinely unknown opening.
        if (confirmed < 4 && !coherentRecovery) {
          const contradicted = known.some((corner) =>
            corner.freeSpaceVotes >= Math.max(3, corner.weight * 1.25));
          const highVariance = known.some((corner) => {
            const closeRange = corner.meanDepth < 0.9;
            const varianceLimit = options.surfaceMode
              ? closeRange
                ? Math.max(0.028, volume.voxelSize * 0.72)
                : Math.max(0.05, volume.voxelSize * 1.2)
              : closeRange
                ? Math.max(0.032, volume.voxelSize * 0.8)
                : Math.max(0.055, volume.voxelSize * 1.35);
            return corner.viewpoints >= 3 && corner.variance > varianceLimit;
          });
          rejectionCounts[
            contradicted ? "freeSpace" : highVariance ? "highVariance" : "unstable"
          ]++;
          continue;
        }
        if (confirmed < 4) rejectionCounts.coherentRecovery++;
        const negative = known.some((corner) => corner.value < 0);
        const positive = known.some((corner) => corner.value >= 0);
        if (!negative || !positive) continue;
        const intersections = [];
        CUBE_EDGES.forEach(([firstIndex, secondIndex]) => {
          const first = corners[firstIndex];
          const second = corners[secondIndex];
          if (first.weight < 1 || second.weight < 1) return;
          // The cell already has four independently reliable corners. Do not
          // require both edge endpoints to pass the multi-view test: that
          // erased valid boundary triangles when one camera saw an edge or a
          // reflective patch only once.
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

const meshEdgeKey = (first, second) =>
  first < second ? `${first},${second}` : `${second},${first}`;

function meshTriangleNormal(positions, first, second, third) {
  const a = first * 3;
  const b = second * 3;
  const c = third * 3;
  const ab = [
    positions[b] - positions[a],
    positions[b + 1] - positions[a + 1],
    positions[b + 2] - positions[a + 2],
  ];
  const ac = [
    positions[c] - positions[a],
    positions[c + 1] - positions[a + 1],
    positions[c + 2] - positions[a + 2],
  ];
  return [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
}

// Cap only small, closed, nearly planar inner boundary loops. Directed edge
// winding distinguishes an actual hole from a component's outer scan edge, so
// an open capture boundary or doorway cannot be turned into a surface.
export function fillSmallMeshHoles(mesh, options = {}) {
  if (!mesh?.indices?.length || !mesh?.positions?.length)
    return { ...mesh, filledHoleCount: 0, filledHoleTriangles: 0 };
  const edgeRecords = new Map();
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [
      mesh.indices[index],
      mesh.indices[index + 1],
      mesh.indices[index + 2],
    ];
    const normal = meshTriangleNormal(mesh.positions, ...triangle);
    for (let corner = 0; corner < 3; corner++) {
      const first = triangle[corner];
      const second = triangle[(corner + 1) % 3];
      const key = meshEdgeKey(first, second);
      const existing = edgeRecords.get(key);
      if (existing) existing.count++;
      else edgeRecords.set(key, { key, first, second, count: 1, normal });
    }
  }
  const boundary = [...edgeRecords.values()].filter(
    (edge) => edge.count === 1,
  );
  const outgoing = new Map();
  const incoming = new Map();
  boundary.forEach((edge) => {
    const next = outgoing.get(edge.first) || [];
    next.push(edge);
    outgoing.set(edge.first, next);
    incoming.set(edge.second, (incoming.get(edge.second) || 0) + 1);
  });
  const visited = new Set();
  const loops = [];
  boundary.forEach((seed) => {
    if (visited.has(seed.key)) return;
    const vertices = [];
    const edges = [];
    let edge = seed;
    let closed = false;
    for (let step = 0; step <= boundary.length; step++) {
      if (visited.has(edge.key)) break;
      visited.add(edge.key);
      vertices.push(edge.first);
      edges.push(edge);
      if (edge.second === seed.first) {
        closed = true;
        break;
      }
      const candidates = outgoing.get(edge.second) || [];
      if (candidates.length !== 1 || (incoming.get(edge.second) || 0) !== 1)
        break;
      [edge] = candidates;
    }
    if (
      closed &&
      vertices.length >= 3 &&
      vertices.length <= (options.maxVertices || 80)
    )
      loops.push({ vertices, edges });
  });

  const positions = Array.from(mesh.positions);
  const colors = Array.from(mesh.colors || []);
  const indices = Array.from(mesh.indices);
  const maxDiameter = options.maxDiameter || 0.42;
  const maxPerimeter = options.maxPerimeter || maxDiameter * 5.5;
  const maxPlanarity = options.maxPlanarity || 0.055;
  let filledHoleCount = 0;
  let filledHoleTriangles = 0;
  let addedArea = 0;
  loops.forEach((loop) => {
    const points = loop.vertices.map((vertex) => [
      mesh.positions[vertex * 3],
      mesh.positions[vertex * 3 + 1],
      mesh.positions[vertex * 3 + 2],
    ]);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const center = [0, 0, 0];
    points.forEach((point) =>
      point.forEach((value, axis) => {
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
        center[axis] += value / points.length;
      }),
    );
    const diameter = Math.hypot(
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
    );
    let perimeter = 0;
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      perimeter += Math.hypot(
        next[0] - point[0],
        next[1] - point[1],
        next[2] - point[2],
      );
    });
    if (diameter > maxDiameter || perimeter > maxPerimeter) return;
    const referenceNormal = loop.edges.reduce(
      (sum, edge) => sum.map((value, axis) => value + edge.normal[axis]),
      [0, 0, 0],
    );
    const loopNormal = [0, 0, 0];
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      loopNormal[0] += (point[1] - next[1]) * (point[2] + next[2]);
      loopNormal[1] += (point[2] - next[2]) * (point[0] + next[0]);
      loopNormal[2] += (point[0] - next[0]) * (point[1] + next[1]);
    });
    const referenceLength = Math.hypot(...referenceNormal);
    const loopLength = Math.hypot(...loopNormal);
    if (referenceLength < 0.00001 || loopLength < 0.00001) return;
    const winding = loopNormal.reduce(
      (sum, value, axis) => sum + value * referenceNormal[axis],
      0,
    );
    if (winding >= 0) return;
    referenceNormal.forEach((value, axis) => {
      referenceNormal[axis] = value / referenceLength;
    });
    if (
      !points.every(
        (point) =>
          Math.abs(
            (point[0] - center[0]) * referenceNormal[0] +
              (point[1] - center[1]) * referenceNormal[1] +
              (point[2] - center[2]) * referenceNormal[2],
          ) <= maxPlanarity,
      )
    )
      return;
    const centerVertex = positions.length / 3;
    positions.push(...center);
    if (mesh.colors?.length) {
      colors.push(
        ...[0, 1, 2].map((axis) =>
          Math.round(
            loop.vertices.reduce(
              (sum, vertex) => sum + mesh.colors[vertex * 3 + axis],
              0,
            ) / loop.vertices.length,
          ),
        ),
      );
    }
    let holeArea = 0;
    loop.edges.forEach((edge) => {
      indices.push(edge.second, edge.first, centerVertex);
      holeArea +=
        Math.hypot(
          ...meshTriangleNormal(
            positions,
            edge.second,
            edge.first,
            centerVertex,
          ),
        ) * 0.5;
    });
    if (holeArea < 0.0005) {
      positions.splice(centerVertex * 3, 3);
      if (mesh.colors?.length) colors.splice(centerVertex * 3, 3);
      indices.splice(indices.length - loop.edges.length * 3);
      return;
    }
    addedArea += holeArea;
    filledHoleCount++;
    filledHoleTriangles += loop.edges.length;
  });
  return {
    ...mesh,
    positions: new Float32Array(positions),
    colors: mesh.colors?.length ? new Uint8Array(colors) : mesh.colors,
    indices: new Uint32Array(indices),
    surfaceArea: (mesh.surfaceArea || 0) + addedArea,
    filledHoleCount,
    filledHoleTriangles,
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

function pointInsideTriangle2d(px, py, triangle) {
  const [a, b, c] = triangle;
  const denominator =
    (b.y - c.y) * (a.x - c.x) +
    (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 0.0000001) return false;
  const first =
    ((b.y - c.y) * (px - c.x) +
      (c.x - b.x) * (py - c.y)) /
    denominator;
  const second =
    ((c.y - a.y) * (px - c.x) +
      (a.x - c.x) * (py - c.y)) /
    denominator;
  const third = 1 - first - second;
  return first >= -0.001 && second >= -0.001 && third >= -0.001;
}

// Surface completion is intentionally stricter than generic room fusion. It
// must represent one dominant wall layer with reasonably continuous measured
// coverage. This rejects a wide multi-wall sector and duplicated wall sheets;
// it does not fill missing depth or turn the fitted plane into geometry.
export function measuredSurfaceQualityDiagnostics(mesh, gridSize = 20) {
  const records = [];
  let verticalArea = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const vertices = [0, 1, 2].map((corner) => {
      const offset = mesh.indices[index + corner] * 3;
      return {
        x: mesh.positions[offset],
        y: mesh.positions[offset + 1],
        z: mesh.positions[offset + 2],
      };
    });
    const normal = meshTriangleNormal(
      mesh.positions,
      mesh.indices[index],
      mesh.indices[index + 1],
      mesh.indices[index + 2],
    );
    const twiceArea = Math.hypot(...normal);
    if (twiceArea < 0.00001) continue;
    let nx = normal[0] / twiceArea;
    const ny = normal[1] / twiceArea;
    let nz = normal[2] / twiceArea;
    if (Math.abs(ny) > 0.45) continue;
    const horizontalLength = Math.hypot(nx, nz);
    if (horizontalLength < 0.75) continue;
    nx /= horizontalLength;
    nz /= horizontalLength;
    if (nx < 0 || (Math.abs(nx) < 0.0001 && nz < 0)) {
      nx *= -1;
      nz *= -1;
    }
    const area = twiceArea * 0.5;
    verticalArea += area;
    records.push({
      vertices,
      nx,
      nz,
      area,
      center: {
        x: vertices.reduce((sum, point) => sum + point.x / 3, 0),
        y: vertices.reduce((sum, point) => sum + point.y / 3, 0),
        z: vertices.reduce((sum, point) => sum + point.z / 3, 0),
      },
    });
  }
  if (verticalArea < 0.12 || !records.length)
    return {
      assessed: false,
      reason: "No sufficiently large vertical measured surface was found.",
      verticalArea,
    };

  let best = null;
  const alignmentLimit = Math.cos((18 * Math.PI) / 180);
  for (let degree = -90; degree < 90; degree += 3) {
    const angle = (degree * Math.PI) / 180;
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const alignedArea = records.reduce(
      (sum, record) =>
        sum +
        (Math.abs(record.nx * nx + record.nz * nz) >= alignmentLimit
          ? record.area
          : 0),
      0,
    );
    if (!best || alignedArea > best.alignedArea)
      best = { nx, nz, alignedArea };
  }
  const aligned = records.filter(
    (record) =>
      Math.abs(record.nx * best.nx + record.nz * best.nz) >= alignmentLimit,
  );
  const offsets = aligned
    .map((record) => ({
      value: record.center.x * best.nx + record.center.z * best.nz,
      area: record.area,
    }))
    .sort((left, right) => left.value - right.value);
  const halfArea = best.alignedArea / 2;
  let accumulatedArea = 0;
  const wallOffset =
    offsets.find((entry) => {
      accumulatedArea += entry.area;
      return accumulatedArea >= halfArea;
    })?.value || 0;
  const layerTolerance = 0.11;
  const layer = aligned.filter(
    (record) =>
      Math.abs(
        record.center.x * best.nx +
          record.center.z * best.nz -
          wallOffset,
      ) <= layerTolerance,
  );
  const layerArea = layer.reduce((sum, record) => sum + record.area, 0);
  const dominantOrientationRatio = best.alignedArea / verticalArea;
  const dominantLayerRatio = layerArea / Math.max(0.00001, best.alignedArea);

  const tangent = { x: -best.nz, z: best.nx };
  const projected = layer.flatMap((record) =>
    record.vertices.map((point) => ({
      x: point.x * tangent.x + point.z * tangent.z,
      y: point.y,
    })),
  );
  const bounds = projected.reduce(
    (value, point) => ({
      minX: Math.min(value.minX, point.x),
      maxX: Math.max(value.maxX, point.x),
      minY: Math.min(value.minY, point.y),
      maxY: Math.max(value.maxY, point.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!Number.isFinite(width) || width < 0.45 || height < 0.45)
    return {
      assessed: false,
      reason: "The dominant measured wall area is too small.",
      verticalArea,
      dominantOrientationRatio,
      dominantLayerRatio,
      width,
      height,
    };
  const occupied = new Uint8Array(gridSize * gridSize);
  layer.forEach((record) => {
    const triangle = record.vertices.map((point) => ({
      x: point.x * tangent.x + point.z * tangent.z,
      y: point.y,
    }));
    const xs = triangle.map((point) =>
      Math.max(
        0,
        Math.min(
          gridSize - 1,
          Math.floor(((point.x - bounds.minX) / width) * gridSize),
        ),
      ),
    );
    const ys = triangle.map((point) =>
      Math.max(
        0,
        Math.min(
          gridSize - 1,
          Math.floor(((point.y - bounds.minY) / height) * gridSize),
        ),
      ),
    );
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++)
      for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
        const px = bounds.minX + ((x + 0.5) / gridSize) * width;
        const py = bounds.minY + ((y + 0.5) / gridSize) * height;
        if (pointInsideTriangle2d(px, py, triangle))
          occupied[y * gridSize + x] = 1;
      }
  });
  const occupiedCells = occupied.reduce((sum, value) => sum + value, 0);
  const competing = new Uint8Array(gridSize * gridSize);
  aligned.forEach((record) => {
    const distance = Math.abs(
      record.center.x * best.nx +
        record.center.z * best.nz -
        wallOffset,
    );
    // Opposite room walls can legitimately share an orientation. Tracking
    // duplicates and furniture fronts are normally much closer to the
    // consensus wall, so only nearby alternate layers are classified here.
    if (distance <= layerTolerance || distance > 0.75) return;
    const triangle = record.vertices.map((point) => ({
      x: point.x * tangent.x + point.z * tangent.z,
      y: point.y,
    }));
    const xs = triangle.map((point) =>
      Math.max(
        0,
        Math.min(
          gridSize - 1,
          Math.floor(((point.x - bounds.minX) / width) * gridSize),
        ),
      ),
    );
    const ys = triangle.map((point) =>
      Math.max(
        0,
        Math.min(
          gridSize - 1,
          Math.floor(((point.y - bounds.minY) / height) * gridSize),
        ),
      ),
    );
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++)
      for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
        const px = bounds.minX + ((x + 0.5) / gridSize) * width;
        const py = bounds.minY + ((y + 0.5) / gridSize) * height;
        if (pointInsideTriangle2d(px, py, triangle))
          competing[y * gridSize + x] = 1;
      }
  });
  const competingCells = competing.reduce((sum, value) => sum + value, 0);
  let overlappingLayerCells = 0;
  competing.forEach((value, index) => {
    if (value && occupied[index]) overlappingLayerCells++;
  });
  const competingLayerCoverage = competingCells / occupied.length;
  const competingLayerOverlapRatio =
    overlappingLayerCells / Math.max(1, competingCells);
  let enclosedEmptyCells = 0;
  for (let y = 1; y < gridSize - 1; y++)
    for (let x = 1; x < gridSize - 1; x++) {
      if (occupied[y * gridSize + x]) continue;
      let left = false, right = false, above = false, below = false;
      for (let next = 0; next < x; next++)
        left ||= !!occupied[y * gridSize + next];
      for (let next = x + 1; next < gridSize; next++)
        right ||= !!occupied[y * gridSize + next];
      for (let next = 0; next < y; next++)
        above ||= !!occupied[next * gridSize + x];
      for (let next = y + 1; next < gridSize; next++)
        below ||= !!occupied[next * gridSize + x];
      if (left && right && above && below) enclosedEmptyCells++;
    }
  return {
    assessed: true,
    verticalArea,
    dominantNormal: { x: best.nx, z: best.nz },
    dominantOrientationRatio,
    dominantLayerRatio,
    wallOffset,
    bounds,
    width,
    height,
    gridCoverage: occupiedCells / occupied.length,
    competingLayerCoverage,
    competingLayerOverlapRatio,
    duplicateLayerLikely:
      competingLayerCoverage >= 0.2 &&
      competingLayerOverlapRatio >= 0.55,
    enclosedEmptyCells,
    interiorMissingRatio:
      enclosedEmptyCells / Math.max(1, occupiedCells + enclosedEmptyCells),
  };
}

function meshWithoutWallDirection(mesh, normal) {
  const indices = [];
  const alignmentLimit = Math.cos((18 * Math.PI) / 180);
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [
      mesh.indices[index],
      mesh.indices[index + 1],
      mesh.indices[index + 2],
    ];
    const value = meshTriangleNormal(mesh.positions, ...triangle);
    const horizontalLength = Math.hypot(value[0], value[2]);
    if (
      horizontalLength < 0.00001 ||
      Math.abs(
        (value[0] / horizontalLength) * normal.x +
          (value[2] / horizontalLength) * normal.z,
      ) < alignmentLimit
    )
      indices.push(...triangle);
  }
  return { ...mesh, indices: new Uint32Array(indices) };
}

// A partial result may contain one or several walls. Assess every significant
// wall direction independently so "at least one wall" never becomes "exactly
// one wall", while an incomplete secondary wall cannot hide behind a good one.
export function measuredWallSectorQualityDiagnostics(mesh) {
  const totalVerticalArea = meshWallStructureDiagnostics(mesh).verticalArea;
  const minimumWallArea = Math.max(0.12, totalVerticalArea * 0.12);
  const walls = [];
  let remaining = mesh;
  for (let wall = 0; wall < 4; wall++) {
    const quality = measuredSurfaceQualityDiagnostics(remaining);
    if (!quality.assessed || !quality.dominantNormal) break;
    const wallArea = quality.verticalArea * quality.dominantOrientationRatio;
    if (wallArea < minimumWallArea) break;
    walls.push({ ...quality, wallArea });
    remaining = meshWithoutWallDirection(remaining, quality.dominantNormal);
  }
  const remainingVerticalArea =
    meshWallStructureDiagnostics(remaining).verticalArea;
  if (!walls.length)
    return {
      assessed: false,
      reason: "No sufficiently large vertical measured surface was found.",
      wallCount: 0,
      walls,
      totalVerticalArea,
      remainingVerticalArea,
    };
  return {
    assessed: true,
    wallCount: walls.length,
    walls,
    totalVerticalArea,
    remainingVerticalArea,
    unassignedVerticalAreaRatio:
      remainingVerticalArea / Math.max(0.00001, totalVerticalArea),
    dominantLayerRatio: Math.min(
      ...walls.map((wall) => wall.dominantLayerRatio),
    ),
    duplicateLayerLikely: walls.some((wall) => wall.duplicateLayerLikely),
    competingLayerCoverage: Math.max(
      ...walls.map((wall) => wall.competingLayerCoverage),
    ),
    competingLayerOverlapRatio: Math.max(
      ...walls.map((wall) => wall.competingLayerOverlapRatio),
    ),
    gridCoverage: Math.min(...walls.map((wall) => wall.gridCoverage)),
    interiorMissingRatio: Math.max(
      ...walls.map((wall) => wall.interiorMissingRatio),
    ),
  };
}

export function measuredSurfaceGapWarning(quality) {
  if (
    !quality?.assessed ||
    (quality.gridCoverage >= 0.42 && quality.interiorMissingRatio <= 0.18)
  )
    return null;
  return {
    message:
      "Some wall regions have no reliable measured depth. They can remain open in the captured-surface result.",
    gridCoverage: quality.gridCoverage,
    interiorMissingRatio: quality.interiorMissingRatio,
    wallCount: quality.wallCount,
  };
}

export function wallConsensusKeyframes(frames, quality, options = {}) {
  const walls = quality?.walls || [];
  if (!walls.length) return null;
  const scored = frames.map((frame) => {
    let measured = 0;
    let consensus = 0;
    const stride = Math.max(1, Math.ceil(frame.filteredCount / 500));
    let cursor = 0;
    for (let index = 0; index < frame.filteredDepth.length; index++) {
      if (!frame.measuredMask[index] || cursor++ % stride) continue;
      const offset = index * 3;
      const x = frame.positions[offset];
      const z = frame.positions[offset + 2];
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      measured++;
      if (
        walls.some(
          (wall) =>
            Math.abs(
              x * wall.dominantNormal.x +
                z * wall.dominantNormal.z -
                wall.wallOffset,
            ) <= (options.distanceTolerance || 0.09),
        )
      )
        consensus++;
    }
    return {
      frame,
      measured,
      consensus,
      ratio: consensus / Math.max(1, measured),
    };
  });
  const ratios = scored.map((entry) => entry.ratio).sort((a, b) => a - b);
  const medianRatio = ratios[Math.floor(ratios.length / 2)] || 0;
  const minimumRatio = Math.max(
    options.minimumAbsoluteRatio || 0.04,
    medianRatio * (options.minimumRelativeRatio || 0.45),
  );
  const kept = scored.filter(
    (entry) => entry.consensus >= 8 && entry.ratio >= minimumRatio,
  );
  const minimumFrames = Math.max(
    3,
    Math.ceil(frames.length * (options.minimumFramesRatio || 0.45)),
  );
  if (kept.length < minimumFrames || kept.length === frames.length) return null;
  const keptIds = new Set(kept.map((entry) => entry.frame.frameId));
  return {
    keptFrameIds: [...keptIds],
    removedFrameIds: scored
      .filter((entry) => !keptIds.has(entry.frame.frameId))
      .map((entry) => entry.frame.frameId),
    medianConsensusRatio: medianRatio,
    minimumConsensusRatio: minimumRatio,
    frameScores: scored.map((entry) => ({
      frameId: entry.frame.frameId,
      measured: entry.measured,
      consensus: entry.consensus,
      ratio: entry.ratio,
    })),
  };
}

export function meshOutsideRectangularRoomModel(diagnostics) {
  return (
    diagnostics.verticalArea >= 0.4 &&
    diagnostics.verticalShare >= 0.22 &&
    diagnostics.manhattanAlignedRatio < 0.52
  );
}

function stabilizeDominantWalls(mesh, voxelSize, maxPlanes = 3) {
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
    .slice(0, maxPlanes)
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

// Straighten only vertices already measured close to a strongly supported wall
// sector. The fitted plane never creates vertices, bridges openings, or pulls
// foreground objects that sit outside the wall layer tolerance.
export function stabilizeMeasuredWallSectors(mesh, walls = [], voxelSize = 0.03) {
  const supported = walls.filter(
    (wall) =>
      wall?.dominantNormal &&
      Number.isFinite(wall.wallOffset) &&
      wall.bounds &&
      wall.dominantOrientationRatio >= 0.45 &&
      wall.dominantLayerRatio >= 0.5,
  );
  if (!supported.length)
    return { ...mesh, stabilizedPlaneCount: 0, stabilizedVertexCount: 0 };
  const positions = new Float32Array(mesh.positions);
  const normals = computeNormals(mesh);
  const distanceLimit = Math.max(0.035, voxelSize * 1.7);
  const extentMargin = Math.max(0.025, voxelSize * 1.2);
  let stabilizedVertexCount = 0;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const offset = vertex * 3;
    if (Math.abs(normals[offset + 1]) > 0.42) continue;
    let best = null;
    supported.forEach((wall) => {
      const normal = wall.dominantNormal;
      const alignment = Math.abs(
        normals[offset] * normal.x + normals[offset + 2] * normal.z,
      );
      if (alignment < 0.82) return;
      const distance =
        positions[offset] * normal.x +
        positions[offset + 2] * normal.z -
        wall.wallOffset;
      if (Math.abs(distance) > distanceLimit) return;
      const tangentX = -normal.z;
      const tangentZ = normal.x;
      const tangent =
        positions[offset] * tangentX + positions[offset + 2] * tangentZ;
      if (
        tangent < wall.bounds.minX - extentMargin ||
        tangent > wall.bounds.maxX + extentMargin ||
        positions[offset + 1] < wall.bounds.minY - extentMargin ||
        positions[offset + 1] > wall.bounds.maxY + extentMargin
      )
        return;
      if (!best || Math.abs(distance) < Math.abs(best.distance))
        best = { normal, distance };
    });
    if (!best) continue;
    positions[offset] -= best.normal.x * best.distance * 0.88;
    positions[offset + 2] -= best.normal.z * best.distance * 0.88;
    stabilizedVertexCount++;
  }
  return {
    ...mesh,
    positions,
    stabilizedPlaneCount: supported.length,
    stabilizedVertexCount,
  };
}

// Flatten only horizontal triangles that already form a substantial measured
// plane. This corrects bowed shelf/floor measurements without extending their
// boundary or adding a single triangle across an unmeasured opening.
export function stabilizeMeasuredHorizontalSurfaces(
  mesh,
  voxelSize = 0.03,
  maxPlanes = 5,
) {
  const samples = [];
  let horizontalArea = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.indices[index] * 3;
    const b = mesh.indices[index + 1] * 3;
    const c = mesh.indices[index + 2] * 3;
    const ab = [
      mesh.positions[b] - mesh.positions[a],
      mesh.positions[b + 1] - mesh.positions[a + 1],
      mesh.positions[b + 2] - mesh.positions[a + 2],
    ];
    const ac = [
      mesh.positions[c] - mesh.positions[a],
      mesh.positions[c + 1] - mesh.positions[a + 1],
      mesh.positions[c + 2] - mesh.positions[a + 2],
    ];
    const nx = ab[1] * ac[2] - ab[2] * ac[1];
    const ny = ab[2] * ac[0] - ab[0] * ac[2];
    const nz = ab[0] * ac[1] - ab[1] * ac[0];
    const twiceArea = Math.hypot(nx, ny, nz);
    if (twiceArea < 0.00001 || Math.abs(ny / twiceArea) < 0.88) continue;
    const area = twiceArea * 0.5;
    const height =
      (mesh.positions[a + 1] + mesh.positions[b + 1] + mesh.positions[c + 1]) /
      3;
    samples.push({ height, area });
    horizontalArea += area;
  }
  if (!samples.length)
    return {
      ...mesh,
      stabilizedHorizontalPlaneCount: 0,
      stabilizedHorizontalVertexCount: 0,
    };

  samples.sort((left, right) => left.height - right.height);
  const clusters = [];
  const clusterDistance = Math.max(0.045, voxelSize * 1.8);
  samples.forEach((sample) => {
    const cluster = clusters[clusters.length - 1];
    if (!cluster || Math.abs(sample.height - cluster.height) > clusterDistance) {
      clusters.push({
        height: sample.height,
        weightedHeight: sample.height * sample.area,
        area: sample.area,
      });
      return;
    }
    cluster.area += sample.area;
    cluster.weightedHeight += sample.height * sample.area;
    cluster.height = cluster.weightedHeight / cluster.area;
  });
  const planes = clusters
    .filter((cluster) => cluster.area >= Math.max(0.055, horizontalArea * 0.035))
    .sort((left, right) => right.area - left.area)
    .slice(0, maxPlanes)
    .map((cluster) => cluster.height);
  if (!planes.length)
    return {
      ...mesh,
      stabilizedHorizontalPlaneCount: 0,
      stabilizedHorizontalVertexCount: 0,
    };

  const positions = new Float32Array(mesh.positions);
  const normals = computeNormals(mesh);
  const distanceLimit = Math.max(0.035, voxelSize * 1.55);
  let stabilizedHorizontalVertexCount = 0;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const offset = vertex * 3;
    if (Math.abs(normals[offset + 1]) < 0.78) continue;
    let closest = null;
    planes.forEach((height) => {
      const distance = positions[offset + 1] - height;
      if (Math.abs(distance) > distanceLimit) return;
      if (closest === null || Math.abs(distance) < Math.abs(closest))
        closest = distance;
    });
    if (closest === null) continue;
    positions[offset + 1] -= closest * 0.92;
    stabilizedHorizontalVertexCount++;
  }
  return {
    ...mesh,
    positions,
    stabilizedHorizontalPlaneCount: planes.length,
    stabilizedHorizontalVertexCount,
  };
}

export function smoothPositions(mesh, passes = 2, voxelSize = 0.03) {
  const count = mesh.positions.length / 3;
  const neighbors = Array.from({ length: count }, () => new Set());
  const edgeUse = new Map();
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
    triangle.forEach((vertex, corner) => {
      const next = triangle[(corner + 1) % 3];
      neighbors[vertex].add(next);
      neighbors[vertex].add(triangle[(corner + 2) % 3]);
      const key = vertex < next ? `${vertex},${next}` : `${next},${vertex}`;
      edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
    });
  }
  const boundary = new Uint8Array(count);
  edgeUse.forEach((uses, key) => {
    if (uses !== 1) return;
    key.split(",").forEach((vertex) => {
      boundary[Number(vertex)] = 1;
    });
  });
  const referenceNormals = computeNormals(mesh);
  const maximumEdge = Math.max(0.06, voxelSize * 3.4);
  let positions = new Float32Array(mesh.positions);
  const move = (source, factor) => {
    const target = new Float32Array(source);
    neighbors.forEach((adjacent, vertex) => {
      if (adjacent.size < 5 || boundary[vertex]) return;
      const accepted = [];
      adjacent.forEach((next) => {
        if (boundary[next]) return;
        const dx = source[next * 3] - source[vertex * 3];
        const dy = source[next * 3 + 1] - source[vertex * 3 + 1];
        const dz = source[next * 3 + 2] - source[vertex * 3 + 2];
        if (Math.hypot(dx, dy, dz) > maximumEdge) return;
        const alignment =
          referenceNormals[vertex * 3] * referenceNormals[next * 3] +
          referenceNormals[vertex * 3 + 1] * referenceNormals[next * 3 + 1] +
          referenceNormals[vertex * 3 + 2] * referenceNormals[next * 3 + 2];
        if (alignment >= 0.86) accepted.push(next);
      });
      if (accepted.length < 3) return;
      for (let axis = 0; axis < 3; axis++) {
        let average = 0;
        accepted.forEach((next) => {
          average += source[next * 3 + axis] / accepted.length;
        });
        target[vertex * 3 + axis] += (average - source[vertex * 3 + axis]) * factor;
      }
    });
    return target;
  };
  for (let pass = 0; pass < passes; pass++) {
    positions = move(positions, 0.24);
    positions = move(positions, -0.245);
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

export function imageColorStatistics(frame) {
  if (!frame?.colorImage?.length) return null;
  const channels = frame.colorChannels || 4;
  const sums = [0, 0, 0];
  let luminance = 0;
  let count = 0;
  const pixelCount = frame.colorImage.length / channels;
  const baseStride = Math.max(1, Math.floor(pixelCount / 4096));
  const sampleStride = baseStride % 2 ? baseStride : baseStride + 1;
  for (
    let index = 0;
    index < frame.colorImage.length;
    index += channels * sampleStride
  ) {
    const red = frame.colorImage[index];
    const green = frame.colorImage[index + 1];
    const blue = frame.colorImage[index + 2];
    const value = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    // Ignore nearly black and clipped pixels; they are commonly unmeasured
    // borders, deep shadows, or glare and destabilize exposure calibration.
    if (value < 8 || value > 247) continue;
    sums[0] += red;
    sums[1] += green;
    sums[2] += blue;
    luminance += value;
    count++;
  }
  if (!count) return null;
  return {
    channels: sums.map((sum) => sum / count),
    luminance: luminance / count,
    samples: count,
  };
}

export function imageSharpness(frame) {
  if (
    !frame?.colorImage?.length ||
    frame.colorWidth < 3 ||
    frame.colorHeight < 3
  )
    return 0;
  const channels = frame.colorChannels || 4;
  const luminanceAt = (x, y) => {
    const offset = (y * frame.colorWidth + x) * channels;
    return (
      frame.colorImage[offset] * 0.2126 +
      frame.colorImage[offset + 1] * 0.7152 +
      frame.colorImage[offset + 2] * 0.0722
    );
  };
  const step = Math.max(1, Math.floor(Math.min(frame.colorWidth, frame.colorHeight) / 120));
  let detail = 0;
  let clipped = 0;
  let samples = 0;
  for (let y = 1; y < frame.colorHeight - 1; y += step)
    for (let x = 1; x < frame.colorWidth - 1; x += step) {
      const center = luminanceAt(x, y);
      detail +=
        Math.abs(luminanceAt(x + 1, y) - center) +
        Math.abs(luminanceAt(x, y + 1) - center);
      if (center < 5 || center > 250) clipped++;
      samples++;
    }
  if (!samples) return 0;
  const clippingPenalty = 1 - Math.min(0.75, clipped / samples);
  return (detail / samples) * clippingPenalty;
}

function buildAtlas(frames) {
  const images = frames.filter((frame) => frame.colorImage?.length && frame.colorWidth && frame.colorHeight);
  if (!images.length) return null;
  images.forEach((frame) => {
    frame.textureSharpness = imageSharpness(frame);
    frame.textureColorStatistics = imageColorStatistics(frame);
  });
  const rankedSharpness = images
    .map((frame) => frame.textureSharpness)
    .sort((left, right) => left - right);
  const referenceSharpness =
    rankedSharpness[Math.floor(rankedSharpness.length / 2)] || 1;
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
  const validStatistics = images
    .map((frame) => frame.textureColorStatistics)
    .filter(Boolean);
  const globalLuminance = validStatistics.length
    ? validStatistics.reduce((sum, stats) => sum + stats.luminance, 0) /
      validStatistics.length
    : images.reduce((sum, frame) => sum + imageLuminance(frame), 0) /
      images.length;
  const globalChannels = [0, 1, 2].map((channel) =>
    validStatistics.length
      ? validStatistics.reduce(
          (sum, stats) => sum + stats.channels[channel],
          0,
        ) / validStatistics.length
      : globalLuminance,
  );
  images.forEach((frame, tile) => {
    const statistics = frame.textureColorStatistics;
    const frameLuminance = statistics?.luminance || imageLuminance(frame);
    const exposure = clamp(
      globalLuminance / Math.max(24, frameLuminance),
      0.8,
      1.22,
    );
    const channelScales = [0, 1, 2].map((channel) => {
      if (!statistics) return exposure;
      const globalChromaticity =
        globalChannels[channel] / Math.max(1, globalLuminance);
      const frameChromaticity =
        statistics.channels[channel] / Math.max(1, frameLuminance);
      const whiteBalance = clamp(
        globalChromaticity / Math.max(0.01, frameChromaticity),
        0.9,
        1.1,
      );
      return clamp(exposure * whiteBalance, 0.78, 1.25);
    });
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
        data[target] = clamp(
          Math.round(frame.colorImage[source] * channelScales[0]),
          0,
          255,
        );
        data[target + 1] = clamp(
          Math.round(frame.colorImage[source + 1] * channelScales[1]),
          0,
          255,
        );
        data[target + 2] = clamp(
          Math.round(frame.colorImage[source + 2] * channelScales[2]),
          0,
          255,
        );
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
    referenceSharpness,
    photometricNormalization: "bounded-exposure-white-balance",
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

function projectedTexturePenalty(frame, projections) {
  if (
    !frame.colorImage ||
    !frame.colorWidth ||
    !frame.colorHeight ||
    !frame.colorChannels
  )
    return 0;
  let overexposed = 0;
  let underexposed = 0;
  let coloredHighlight = 0;
  let sampled = 0;
  projections.forEach((projection) => {
    if (!projection) return;
    const x = clamp(
      Math.round(projection.u * (frame.colorWidth - 1)),
      0,
      frame.colorWidth - 1,
    );
    const y = clamp(
      Math.round(projection.v * (frame.colorHeight - 1)),
      0,
      frame.colorHeight - 1,
    );
    const offset = (y * frame.colorWidth + x) * frame.colorChannels;
    const red = frame.colorImage[offset];
    const green = frame.colorImage[offset + 1];
    const blue = frame.colorImage[offset + 2];
    if (![red, green, blue].every(Number.isFinite)) return;
    const minimum = Math.min(red, green, blue);
    const maximum = Math.max(red, green, blue);
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    if (luminance >= 246 && minimum >= 218) overexposed++;
    if (luminance <= 7) underexposed++;
    if (maximum >= 235 && maximum - minimum >= 105) coloredHighlight++;
    sampled++;
  });
  if (!sampled) return 0;
  return (
    overexposed / sampled +
    (underexposed / sampled) * 0.45 +
    (coloredHighlight / sampled) * 0.35
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
    const first = triangle[0] * 3;
    const second = triangle[1] * 3;
    const third = triangle[2] * 3;
    const ab = [
      mesh.positions[second] - mesh.positions[first],
      mesh.positions[second + 1] - mesh.positions[first + 1],
      mesh.positions[second + 2] - mesh.positions[first + 2],
    ];
    const ac = [
      mesh.positions[third] - mesh.positions[first],
      mesh.positions[third + 1] - mesh.positions[first + 1],
      mesh.positions[third + 2] - mesh.positions[first + 2],
    ];
    const faceNormal = {
      x: ab[1] * ac[2] - ab[2] * ac[1],
      y: ab[2] * ac[0] - ab[0] * ac[2],
      z: ab[0] * ac[1] - ab[1] * ac[0],
    };
    const faceNormalLength =
      Math.hypot(faceNormal.x, faceNormal.y, faceNormal.z) || 1;
    faceNormal.x /= faceNormalLength;
    faceNormal.y /= faceNormalLength;
    faceNormal.z /= faceNormalLength;
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
          if (Math.abs(offsetX) + Math.abs(offsetY) > 1) continue;
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
      const strictTextureLimit = Math.max(0.055, closestDepth * 0.03);
      // TSDF smoothing can move a valid triangle a few centimeters away from
      // the source depth pixel. Permit a bounded soft match only when no
      // strict camera exists; large disagreements still receive no texture.
      const softTextureLimit = Math.max(0.09, closestDepth * 0.05);
      if (!closestDepth || closestAgreement > softTextureLimit)
        return;
      const softVisibility = closestAgreement > strictTextureLimit;
      const dx = frame.transformMatrix[12] - center.x;
      const dy = frame.transformMatrix[13] - center.y;
      const dz = frame.transformMatrix[14] - center.z;
      const distance = Math.hypot(dx, dy, dz) || 1;
      const facing = Math.abs((normal.x * dx + normal.y * dy + normal.z * dz) / distance);
      const sharpness = clamp(
        frame.textureSharpness / atlas.referenceSharpness,
        0.35,
        1.65,
      );
      const motionPenalty = clamp(
        (frame.linearSpeed || 0) / 0.75 +
          (frame.angularSpeed || 0) / 0.8,
        0,
        1.5,
      );
      const texturePenalty = projectedTexturePenalty(frame, [
        colorProjection,
        ...colorProjections,
      ]);
      candidates.push({
        frame,
        projections: colorProjections,
        score:
          facing * 2 +
          1 / distance +
          sharpness * 0.65 -
          closestAgreement * 5 -
          motionPenalty * 0.4 -
          texturePenalty * 0.85 -
          (softVisibility ? 1.15 : 0),
        softVisibility,
      });
    });
    const strictCandidates = candidates.filter(
      (candidate) => !candidate.softVisibility,
    );
    const acceptedCandidates = strictCandidates.length
      ? strictCandidates
      : candidates;
    acceptedCandidates.sort((left, right) => right.score - left.score);
    const record = {
      triangle,
      faceNormal,
      candidates: acceptedCandidates.slice(0, 3),
      selected: 0,
    };
    const recordIndex = records.length;
    records.push(record);
    triangle.forEach((vertex) => vertexTriangles[vertex].push(recordIndex));
  }
  // Neighboring triangles prefer the same one of their valid top-three
  // camera views. Four passes remove most per-triangle exposure seams without
  // ever selecting a frame that failed the depth/visibility checks.
  for (let pass = 0; pass < 4; pass++)
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
        const score =
          candidate.score +
          (votes.get(candidate.frame.textureId) || 0) * 0.68;
        if (score > selectedScore) {
          selected = candidateIndex;
          selectedScore = score;
        }
      });
      record.selected = selected;
    });
  // Select texture cameras coherently across connected, similarly oriented
  // measured patches. A camera still has to be one of each triangle's valid
  // depth-tested candidates, so this reduces color seams without painting
  // through occluders or inventing texture for missing geometry.
  const visitedRecords = new Uint8Array(records.length);
  let texturePatchCount = 0;
  for (let start = 0; start < records.length; start++) {
    if (visitedRecords[start]) continue;
    const component = [];
    const queue = [start];
    visitedRecords[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const currentIndex = queue[cursor];
      const current = records[currentIndex];
      component.push(currentIndex);
      current.triangle.forEach((vertex) =>
        vertexTriangles[vertex].forEach((neighborIndex) => {
          if (visitedRecords[neighborIndex]) return;
          const neighbor = records[neighborIndex];
          const alignment = Math.abs(
            current.faceNormal.x * neighbor.faceNormal.x +
              current.faceNormal.y * neighbor.faceNormal.y +
              current.faceNormal.z * neighbor.faceNormal.z,
          );
          if (alignment < 0.94) return;
          visitedRecords[neighborIndex] = 1;
          queue.push(neighborIndex);
        }),
      );
    }
    if (component.length < 4) continue;
    texturePatchCount++;
    const frameCoverage = new Map();
    component.forEach((recordIndex) =>
      records[recordIndex].candidates.forEach((candidate) => {
        const textureId = candidate.frame.textureId;
        frameCoverage.set(textureId, (frameCoverage.get(textureId) || 0) + 1);
      }),
    );
    component.forEach((recordIndex) => {
      const record = records[recordIndex];
      if (record.candidates.length < 2) return;
      const bestLocalScore = record.candidates[0].score;
      let selected = record.selected;
      let selectedScore = -Infinity;
      record.candidates.forEach((candidate, candidateIndex) => {
        if (candidate.score < bestLocalScore - 0.65) return;
        const coverage =
          (frameCoverage.get(candidate.frame.textureId) || 0) /
          component.length;
        const score = candidate.score + Math.min(1, coverage) * 0.95;
        if (score > selectedScore) {
          selected = candidateIndex;
          selectedScore = score;
        }
      });
      record.selected = selected;
    });
  }
  const positions = [];
  const normals = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  let texturedTriangles = 0;
  let textureFallbackTriangles = 0;
  records.forEach((record) => {
    const triangle = record.triangle;
    const best = record.candidates[record.selected] || null;
    if (best) {
      texturedTriangles++;
      if (best.softVisibility) textureFallbackTriangles++;
    }
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
    textureFallbackTriangles,
    texturePatchCount,
    photometricNormalization: atlas.photometricNormalization,
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
  let overlapping = validateFrameOverlap(prepared, alignment);
  if (options.completionMode === "surface" && overlapping.length >= 3) {
    const strictDiagnostics = {};
    const consistent = validateFrameOverlap(overlapping, strictDiagnostics, {
      minimumAgreeing: 16,
      minimumAgreementRatio: 0.5,
      maximumMedianError: 0.045,
      maximumUpperError: 0.09,
    });
    const enoughConsistentFrames =
      consistent.length >= 3 &&
      consistent.length >= Math.ceil(overlapping.length * 0.4);
    alignment.surfaceConsistency = {
      ...strictDiagnostics,
      applied: enoughConsistentFrames,
      fallbackToGeneralOverlap: !enoughConsistentFrames,
    };
    if (enoughConsistentFrames) overlapping = consistent;
  }
  alignment.poseRefinement = "disabled-until-independently-validated";
  const usable = selectEvenly(
    overlapping,
    options.maxKeyframes || 40,
  );
  const stages = {
    algorithmVersion: 22,
    completionMode: options.completionMode === "surface" ? "surface" : "room",
    reconstructionProfile: options.reconstructionProfile || "quality",
    supportMode: "translated-camera-viewpoints",
    depthSampling: "continuous-inverse-depth",
    coordinateMode: "view-aligned-v1",
    inputKeyframes: keyframes.length,
    ambiguousLegacyKeyframes,
    preparedKeyframes: prepared.length,
    inputDepthSamples: keyframes.reduce((sum, frame) => sum + (frame?.validCount || 0), 0),
    filteredDepthSamples: prepared.reduce((sum, frame) => sum + frame.filteredCount, 0),
    frameSamples: prepared.map((frame) => ({
      frameId: frame.frameId,
      input: frame.validCount,
      retainedMeasured: frame.measuredMask.reduce((sum, value) => sum + value, 0),
      afterRepair: frame.filteredCount,
    })),
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
  if (
    options.completionMode !== "surface" &&
    Number.isFinite(options.headingCoverage) &&
    options.headingCoverage < 75
  )
    return failure(
      `Only ${Math.round(options.headingCoverage)}% of the room-direction sweep has reliable depth. Reach at least 75% before finishing.`,
      { headingCoverage: options.headingCoverage, minimumHeadingCoverage: 75 },
    );
  if (usable.length < 2)
    return failure("At least two overlapping depth views are required. Keep scanning from nearby translated positions.", {
      keyframes: usable.length,
      overlappingKeyframes: usable.length,
    });
  const samples = collectBoundsSamples(usable);
  if (samples.length < 400)
    return failure("Not enough filtered RGB-D samples for a reliable surface. Keep scanning the weak areas.", {
      keyframes: usable.length,
      samples: samples.length,
    });
  const bounds = sampleBounds(samples);
  let volume = makeVolume(bounds, options);
  const volumeVoxelSize = volume.voxelSize;
  const volumeDimensions = volume.dimensions;
  const volumeCells = volume.values.length;
  report?.("fusing", 16, { voxelSize: volume.voxelSize, dimensions: volume.dimensions });
  const confirmedVoxels = integrateProjective(volume, usable, report);
  if (confirmedVoxels < 120)
    return failure("The captured views do not overlap enough for a reliable surface. Keep each wall visible while moving sideways.", {
      keyframes: usable.length,
      confirmedVoxels,
      voxelSize: volume.voxelSize,
    });
  regularizeVolume(volume);
  propagateSurfaceColors(volume);
  report?.("meshing", 68);
  const surfaceCompletion = options.completionMode === "surface";
  let surface = extractSurfaceNet(volume, report, { surfaceMode: surfaceCompletion });
  stages.cellRejections = surface.rejectionCounts;
  stages.trianglesBeforeCleanup = surface.indices.length / 3;
  surface = removeSmallComponents(surface);
  stages.trianglesAfterCleanup = surface.indices.length / 3;
  stages.componentCount = surface.componentCount;
  stages.keptComponentCount = surface.keptComponentCount;
  stages.dominantAreaRatio = surface.dominantAreaRatio;
  surface = fillSmallMeshHoles(surface, {
    // A partial measured result may close only tiny meshing cracks. Broad
    // unmeasured regions remain open and never become replacement walls.
    maxDiameter: surfaceCompletion
      ? clamp(volume.voxelSize * 3, 0.08, 0.12)
      : clamp(volume.voxelSize * 9, 0.3, 0.45),
    maxPlanarity: surfaceCompletion
      ? Math.max(0.025, volume.voxelSize * 0.8)
      : Math.max(0.04, volume.voxelSize * 1.2),
  });
  stages.filledHoleCount = surface.filledHoleCount;
  stages.filledHoleTriangles = surface.filledHoleTriangles;
  const highlyFragmented = meshFragmentationIsUnacceptable(surface);
  const wallStructure = meshWallStructureDiagnostics(surface);
  stages.wallStructure = wallStructure;
  const measuredSurfaceQuality =
    options.completionMode === "surface"
      ? measuredWallSectorQualityDiagnostics(surface)
      : null;
  stages.measuredSurfaceQuality = measuredSurfaceQuality;
  stages.measuredGapWarning = measuredSurfaceGapWarning(
    measuredSurfaceQuality,
  );
  stages.rectangularRoomModelCompatible =
    !meshOutsideRectangularRoomModel(wallStructure);
  // A wall-ratio consensus pass is useful for a detected duplicate layer,
  // but it is unsafe as a general coverage filter: legitimate side-to-side
  // views often see different portions of one wall. Keep those views unless
  // the measured result actually reports competing layers.
  if (
    surfaceCompletion &&
    options.globalSurfaceConsensus !== false &&
    measuredSurfaceQuality?.duplicateLayerLikely
  ) {
    const repair = wallConsensusKeyframes(usable, measuredSurfaceQuality, {
      distanceTolerance: 0.055,
      minimumAbsoluteRatio: 0.06,
      minimumRelativeRatio: 0.68,
      minimumFramesRatio: 0.5,
    });
    if (repair?.keptFrameIds.length >= 3) {
      const keptIds = new Set(repair.keptFrameIds);
      volume = null;
      const repaired = fuseRgbdKeyframes(
        keyframes.filter((_, index) => keptIds.has(index)),
        { ...options, globalSurfaceConsensus: false },
        report,
      );
      const globalSurfaceConsensus = {
        attempted: true,
        succeeded: !!repaired.mesh,
        removedFrameIds: repair.removedFrameIds,
        keptFrameIds: repair.keptFrameIds,
        medianConsensusRatio: repair.medianConsensusRatio,
        minimumConsensusRatio: repair.minimumConsensusRatio,
        frameScores: repair.frameScores,
      };
      repaired.diagnostics.globalSurfaceConsensus = globalSurfaceConsensus;
      if (repaired.mesh) return repaired;
      stages.globalSurfaceConsensus = globalSurfaceConsensus;
    } else {
      stages.globalSurfaceConsensus = {
        attempted: false,
        succeeded: false,
        removedFrameIds: repair?.removedFrameIds || [],
      };
    }
  }
  const measuredSurfaceWarnings = [];
  if (stages.measuredGapWarning)
    measuredSurfaceWarnings.push({
      code: "missing-depth",
      message: stages.measuredGapWarning.message,
    });
  if (measuredSurfaceQuality && !measuredSurfaceQuality.assessed)
    measuredSurfaceWarnings.push({
      code: "limited-wall-evidence",
      message: `${measuredSurfaceQuality.reason} The available measured geometry can still be reviewed.`,
    });
  if (measuredSurfaceQuality?.duplicateLayerLikely) {
    const repair =
      options.autoLayerRepair === false
        ? null
        : wallConsensusKeyframes(usable, measuredSurfaceQuality);
    if (repair?.keptFrameIds.length >= 3) {
      const keptIds = new Set(repair.keptFrameIds);
      // The retry builds another dense fusion volume. Drop the first volume's
      // final strong reference before recursing so mobile browsers can reclaim
      // it instead of briefly retaining two full reconstruction grids.
      volume = null;
      const repaired = fuseRgbdKeyframes(
        keyframes.filter((_, index) => keptIds.has(index)),
        { ...options, autoLayerRepair: false },
        report,
      );
      repaired.diagnostics.autoLayerRepair = {
        attempted: true,
        succeeded: !!repaired.mesh,
        removedFrameIds: repair.removedFrameIds,
        keptFrameIds: repair.keptFrameIds,
        medianConsensusRatio: repair.medianConsensusRatio,
        minimumConsensusRatio: repair.minimumConsensusRatio,
        frameScores: repair.frameScores,
      };
      if (repaired.mesh) return repaired;
      measuredSurfaceWarnings.push({
        code: "possible-overlapping-layers",
        message:
          "Automatic layer repair could not isolate one wall layer. The measured result may contain overlapping depth surfaces.",
      });
      stages.autoLayerRepair = repaired.diagnostics.autoLayerRepair;
    } else {
      measuredSurfaceWarnings.push({
        code: "possible-overlapping-layers",
        message:
          "The depth views may contain overlapping wall layers. Review the measured result before accepting it.",
      });
      stages.autoLayerRepair = {
        attempted: options.autoLayerRepair !== false,
        succeeded: false,
        removedFrameIds: repair?.removedFrameIds || [],
      };
    }
  }
  if (!stages.rectangularRoomModelCompatible && !surfaceCompletion)
    return failure("The measured views create curled or overlapping wall layers. Keep scanning the affected wall from overlapping sideways positions.", {
      ...stages,
      confirmedVoxels,
      voxelSize: volumeVoxelSize,
      fusedSurfaceArea: surface.surfaceArea,
      fusedTriangles: surface.indices.length / 3,
      rejectedUnsafeFusion: true,
    });
  if (!stages.rectangularRoomModelCompatible)
    measuredSurfaceWarnings.push({
      code: "possible-curved-or-overlapping-surface",
      message:
        "Room-shape analysis marked parts of this measured surface as curved or overlapping. This can be a false positive for a partial wall; inspect the result before accepting it.",
    });
  const surfaceFailureReason = highlyFragmented
    ? "multi-view fusion only produced disconnected fragments."
    : "multi-view fusion did not produce enough reliable surface area.";
  if (
    !surface.indices.length ||
    surface.surfaceArea < 0.04 ||
    (highlyFragmented && !surfaceCompletion)
  )
    return failure(`${surfaceFailureReason} Keep scanning until the missing sections have repeated depth overlap.`, {
      keyframes: usable.length,
      confirmedVoxels,
      voxelSize: volumeVoxelSize,
      fusedSurfaceArea: surface.surfaceArea,
      fusedTriangles: surface.indices.length / 3,
      fragmented: highlyFragmented,
      rectangularRoomModelCompatible:
        stages.rectangularRoomModelCompatible,
    });
  if (highlyFragmented)
    measuredSurfaceWarnings.push({
      code: "fragmented-measured-surface",
      message:
        "The reconstruction contains disconnected measured pieces. Missing space remains open; inspect the result before accepting it.",
    });
  stages.measuredSurfaceWarnings = measuredSurfaceWarnings;
  stages.measuredReviewWarning = measuredSurfaceWarnings.length
    ? {
        message:
          "The measured mesh was reconstructed, but automatic review found possible gaps or alignment issues. You can inspect and finish it without generating replacement walls.",
        issues: measuredSurfaceWarnings,
      }
    : null;
  if (surfaceCompletion && measuredSurfaceQuality?.assessed)
    surface = stabilizeMeasuredWallSectors(
      surface,
      measuredSurfaceQuality.walls,
      volumeVoxelSize,
    );
  else if (stages.rectangularRoomModelCompatible)
    surface = stabilizeDominantWalls(
        surface,
        volumeVoxelSize,
        3,
      );
  else surface = { ...surface, stabilizedPlaneCount: 0 };
  surface = smoothPositions(
    surface,
    options.smoothingPasses ??
      (options.completionMode === "surface" ? 2 : 3),
    volumeVoxelSize,
  );
  if (surfaceCompletion)
    surface = stabilizeMeasuredHorizontalSurfaces(
      surface,
      volumeVoxelSize,
      5,
    );
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
      voxelSize: volumeVoxelSize,
      dimensions: volumeDimensions,
      cells: volumeCells,
      coherentRecoveryCells: surface.rejectionCounts?.coherentRecovery || 0,
      highVarianceRejectedCells: surface.rejectionCounts?.highVariance || 0,
      triangles: mesh.triangleCount,
      surfaceArea: surface.surfaceArea,
      stabilizedPlanes:
        (surface.stabilizedPlaneCount || 0) +
        (surface.stabilizedHorizontalPlaneCount || 0),
      stabilizedVertices: surface.stabilizedVertexCount || 0,
      stabilizedHorizontalPlanes:
        surface.stabilizedHorizontalPlaneCount || 0,
      stabilizedHorizontalVertices:
        surface.stabilizedHorizontalVertexCount || 0,
      components: surface.componentCount || 1,
      keptComponents: surface.keptComponentCount || 1,
      dominantAreaRatio: surface.dominantAreaRatio ?? 1,
      wallStructure,
      removedComponents: surface.removedComponentCount || 0,
      filledHoleCount: surface.filledHoleCount || 0,
      filledHoleTriangles: surface.filledHoleTriangles || 0,
      textureCoverage: mesh.textureCoverage,
      textureFallbackTriangles: mesh.textureFallbackTriangles || 0,
      texturePatchCount: mesh.texturePatchCount || 0,
      photometricNormalization: mesh.photometricNormalization || "none",
    },
  };
}
