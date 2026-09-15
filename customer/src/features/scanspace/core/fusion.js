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
  const keepColor = options.keepColor !== false;
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
    if (
      keepColor &&
      Array.isArray(point.color) &&
      point.color.slice(0, 3).every(Number.isFinite)
    ) {
      colors[target] = clamp(Math.round(point.color[0]), 0, 255);
      colors[target + 1] = clamp(Math.round(point.color[1]), 0, 255);
      colors[target + 2] = clamp(Math.round(point.color[2]), 0, 255);
      colorMask[index] = 1;
      coloredCount++;
    }
  });
  if (validCount < 6) return null;
  const image = keepColor ? options.colorImage : null;
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
    // Captured with the image so texture selection can reject motion-blurred
    // or heavily clipped views without rescanning the pixels in the worker.
    colorSharpness: Number(options.colorSharpness) || Number(image?.sharpness) || 0,
    colorClippedRatio:
      Number(options.colorClippedRatio) || Number(image?.clippedRatio) || 0,
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

function frameCameraPosition(frame) {
  const camera = frame?.camera;
  if (camera?.length >= 3 && [camera[0], camera[1], camera[2]].every(Number.isFinite))
    return [camera[0], camera[1], camera[2]];
  const matrix = frame?.transformMatrix;
  if (matrix?.length >= 15 && [matrix[12], matrix[13], matrix[14]].every(Number.isFinite))
    return [matrix[12], matrix[13], matrix[14]];
  return [0, 0, 0];
}

// Keep the scanner's bounded color set intact, then spend the remaining
// fusion budget on the least-represented camera poses. A distance-only path
// sample dropped ceiling/floor views captured while the user rotated in place
// and could independently discard four of the scanner's fifteen RGB frames.
export function selectFusionKeyframes(values, limit) {
  if (values.length <= limit) return values;
  const boundedLimit = Math.max(2, Math.floor(limit));
  const poses = values.map((frame, index) => {
    const position = frameCameraPosition(frame);
    const matrix = frame?.transformMatrix;
    const direction = matrix?.length >= 11
      ? [-matrix[8], -matrix[9], -matrix[10]]
      : [0, 0, -1];
    const directionLength = Math.hypot(...direction) || 1;
    return {
      position,
      direction: direction.map((value) => value / directionLength),
      time: Number(frame?.timestamp) || index,
    };
  });
  const selected = new Set();
  const colored = values
    .map((frame, index) => (frame.colorImage?.length ? index : -1))
    .filter((index) => index >= 0);
  const novelty = (candidate) => {
    if (!selected.size) return Infinity;
    const pose = poses[candidate];
    let nearest = Infinity;
    selected.forEach((chosen) => {
      const other = poses[chosen];
      const spatial = Math.hypot(
        pose.position[0] - other.position[0],
        pose.position[1] - other.position[1],
        pose.position[2] - other.position[2],
      );
      const directionDot = clamp(
        pose.direction[0] * other.direction[0] +
          pose.direction[1] * other.direction[1] +
          pose.direction[2] * other.direction[2],
        -1,
        1,
      );
      const angular = Math.acos(directionDot);
      nearest = Math.min(nearest, spatial + angular * 0.42);
    });
    return nearest;
  };
  const addMostNovel = (candidates) => {
    let best = -1;
    let bestNovelty = -Infinity;
    candidates.forEach((candidate) => {
      if (selected.has(candidate)) return;
      const score = novelty(candidate);
      if (score > bestNovelty) {
        best = candidate;
        bestNovelty = score;
      }
    });
    if (best >= 0) selected.add(best);
    return best >= 0;
  };
  // Normal capture stores at most fifteen RGB frames, below both worker
  // budgets. Keep every one. The fallback handles imported/debug captures
  // with a larger color set by selecting pose-diverse color views first.
  if (colored.length <= boundedLimit) colored.forEach((index) => selected.add(index));
  else {
    selected.add(
      colored.reduce((best, candidate) =>
        (Number(values[candidate].colorSharpness) || 0) >
        (Number(values[best].colorSharpness) || 0)
          ? candidate
          : best,
      ),
    );
    while (selected.size < boundedLimit) {
      if (!addMostNovel(colored)) break;
    }
  }
  if (selected.size < boundedLimit) selected.add(0);
  if (selected.size < boundedLimit) selected.add(values.length - 1);
  const everyIndex = values.map((_, index) => index);
  while (selected.size < boundedLimit) {
    if (!addMostNovel(everyIndex)) break;
  }
  return [...selected]
    .sort((left, right) => left - right)
    .slice(0, boundedLimit)
    .map((index) => values[index]);
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
      // The runtime's smoothed depth can put a foreground edge and its wall
      // background inside the broad noise band above. Do not average those
      // layers together: at two metres a six-centimetre shelf/curtain edge is
      // already a real surface discontinuity, not sensor noise. Keep this
      // threshold distance-aware, but substantially narrower than the full
      // smoothing band used for a continuous wall.
      const discontinuity = Math.max(
        0.035,
        Math.min(range * 0.62, center * 0.028),
      );
      // Keep the measured centre dominant. A symmetric mean softens sensor
      // noise on a wall, but it also pulls a shelf edge toward the foreground
      // whenever one side of the 3x3 footprint contains a different layer.
      let sum = center * 3;
      let weight = 3;
      let support = 0;
      let differenceSum = 0;
      let minimum = center;
      let maximum = center;
      for (let offsetY = -1; offsetY <= 1; offsetY++)
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= frame.columns || nextY >= frame.rows) continue;
          const next = frame.depths[nextY * frame.columns + nextX];
          const difference = Math.abs(next - center);
          if (!Number.isFinite(next) || next <= 0 || difference > range) continue;
          if (difference > discontinuity) continue;
          const contribution = Math.exp(-(difference * difference) / (2 * range * range));
          sum += next * contribution;
          weight += contribution;
          differenceSum += difference;
          minimum = Math.min(minimum, next);
          maximum = Math.max(maximum, next);
          support++;
        }
      // Keep a real sensor sample when two neighboring pixels agree. These
      // lower-confidence edge samples cannot vote for free space and still
      // need repeated camera views before they become final geometry. Dropping
      // them here created avoidable holes around shelves, curtains, and other
      // thin or partly occluded surfaces.
      if (support >= 2) {
        const average = sum / weight;
        const edgeTransition = maximum - minimum > range * 0.82;
        filtered[index] = edgeTransition
          ? center * 0.78 + average * 0.22
          : average;
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

function depthPositionAt(frame, u, v, depth) {
  const p = frame.projectionMatrix;
  const m = frame.transformMatrix;
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

export function depthPosition(frame, index, depth) {
  // Keyframe storage is a normalized XR-view grid. Its cell centre is the
  // single source of truth for depth sampling, unprojection, filtering,
  // overlap checks, visibility checks, and hole repair.
  const u = ((index % frame.columns) + 0.5) / frame.columns;
  const v = (Math.floor(index / frame.columns) + 0.5) / frame.rows;
  return depthPositionAt(frame, u, v, depth);
}

function prepareFrame(frame, frameId, options = {}) {
  const projection = frame.projectionMatrix;
  const transform = frame.transformMatrix;
  if (projection?.length !== 16 || transform?.length !== 16) return null;
  if (![...projection, ...transform].every(Number.isFinite)) return null;
  const filtered = filterDepth(frame);
  const filteredDepth = filtered.filtered;
  const positions = new Float32Array(frame.positions.length).fill(NaN);
  const freeSpaceMask = new Uint8Array(filteredDepth.length);
  const floorY = Number.isFinite(options.floorY)
    ? Number(options.floorY)
    : NaN;
  const floorOutlierTolerance = Number(options.floorOutlierTolerance);
  const rejectFloorOutliers =
    Number.isFinite(floorY) &&
    Number.isFinite(floorOutlierTolerance) &&
    floorOutlierTolerance > 0;
  let floorOutlierCount = 0;
  let valid = 0;
  filteredDepth.forEach((depth, index) => {
    if (!depth) return;
    const point = depthPosition(frame, index, depth);
    if (!point?.every(Number.isFinite)) {
      filteredDepth[index] = 0;
      return;
    }
    // A hit-test floor is allowed a small amount of error, but a measured
    // point far below it cannot be a wall or floor sample. Keeping these
    // points lets a bad depth ray pull the TSDF volume downward and produces
    // bent lower edges and long bridge triangles. Apply this only when the
    // caller supplies an explicit tolerance so synthetic/replayed captures
    // without a trustworthy floor retain their original geometry.
    if (rejectFloorOutliers && point[1] < floorY - floorOutlierTolerance) {
      filteredDepth[index] = 0;
      filtered.measuredMask[index] = 0;
      filtered.confidence[index] = 0;
      floorOutlierCount++;
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
    floorOutlierCount,
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
        const forwardAgreementRatio =
          forward.agreeing / Math.max(1, forward.compared);
        const backwardAgreementRatio =
          backward.agreeing / Math.max(1, backward.compared);
        const combineDirectionalError = (firstError, secondError) => {
          const errors = [firstError, secondError].filter(Number.isFinite);
          if (!errors.length) return Infinity;
          return limits.requireBidirectional
            ? Math.max(...errors)
            : Math.min(...errors);
        };
        const medianError = combineDirectionalError(
          forward.medianErrorMeters,
          backward.medianErrorMeters,
        );
        const upperError = combineDirectionalError(
          forward.upperErrorMeters,
          backward.upperErrorMeters,
        );
        const minimumDirectionalSamples =
          limits.minimumDirectionalSamples || 8;
        const minimumDirectionalAgreementRatio =
          limits.minimumDirectionalAgreementRatio || 0.34;
        // A one-way match is not enough for a final partial-surface result.
        // Foreground clutter can agree in one projection while a shifted wall
        // sheet fails in the reverse direction. Requiring both directions in
        // the strict pass prevents that sheet from joining the fusion core.
        const bidirectionalAccepted =
          !limits.requireBidirectional ||
          (forward.compared >= minimumDirectionalSamples &&
            backward.compared >= minimumDirectionalSamples &&
            forwardAgreementRatio >= minimumDirectionalAgreementRatio &&
            backwardAgreementRatio >= minimumDirectionalAgreementRatio);
        const accepted =
          agreeing >= (limits.minimumAgreeing || 12) &&
          agreementRatio >= (limits.minimumAgreementRatio || 0.4) &&
          medianError <= (limits.maximumMedianError || 0.075) &&
          upperError <= (limits.maximumUpperError || 0.14) &&
          bidirectionalAccepted;
        diagnostics.pairs.push({
          firstFrame: frames[left].frameId,
          secondFrame: frames[right].frameId,
          compared,
          agreeing,
          agreementRatio,
          forwardAgreementRatio,
          backwardAgreementRatio,
          forwardMedianErrorMeters: forward.medianErrorMeters,
          backwardMedianErrorMeters: backward.medianErrorMeters,
          forwardUpperErrorMeters: forward.upperErrorMeters,
          backwardUpperErrorMeters: backward.upperErrorMeters,
          bidirectionalAccepted,
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
  const samples = (component) =>
    component.reduce(
      (sum, index) => sum + frames[index].filteredCount,
      0,
    );
  let strongest;
  if (limits.selectionMode === "anchor-core") {
    // Connected components permit a long A-B-C-D chain even when A and D no
    // longer describe the same wall. A partial scan is safer when every kept
    // frame directly agrees with one common anchor. This trades a little
    // marginal coverage for a globally coherent surface instead of a curl.
    const cores = frames.map((_, anchor) => [
      anchor,
      ...adjacency[anchor],
    ]);
    strongest = cores.sort((left, right) => {
      if (right.length !== left.length) return right.length - left.length;
      return samples(right) - samples(left);
    })[0] || [];
    diagnostics.selectionMode = "anchor-core";
    diagnostics.anchorFrameId = strongest.length
      ? frames[strongest[0]].frameId
      : null;
  } else strongest = components.sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length;
    return samples(right) - samples(left);
  })[0] || [];
  diagnostics.selectedFrameIds = strongest.map((index) => frames[index].frameId);
  diagnostics.rejectedFrameIds = frames
    .filter((_, index) => !strongest.includes(index)).map((frame) => frame.frameId);
  return strongest.sort((left, right) => left - right).map((index) => frames[index]);
}

function transformPointByRigidDelta(point, delta) {
  const { rotation, translation } = delta;
  return {
    x:
      rotation[0] * point.x +
      rotation[1] * point.y +
      rotation[2] * point.z +
      translation[0],
    y:
      rotation[3] * point.x +
      rotation[4] * point.y +
      rotation[5] * point.z +
      translation[1],
    z:
      rotation[6] * point.x +
      rotation[7] * point.y +
      rotation[8] * point.z +
      translation[2],
  };
}

function rigidDeltaRotationAngle(delta) {
  return 2 * Math.acos(clamp(Math.abs(delta.quaternion[0]), -1, 1));
}

function cloneFrameForPoseRefinement(frame) {
  return {
    ...frame,
    positions: new Float32Array(frame.positions),
    transformMatrix: new Float32Array(frame.transformMatrix),
    viewTransformMatrix:
      frame.viewTransformMatrix?.length === 16
        ? new Float32Array(frame.viewTransformMatrix)
        : new Float32Array(frame.transformMatrix),
    camera: new Float32Array(frame.camera || frame.transformMatrix.slice(12, 15)),
  };
}

function applyRigidDeltaToFrame(frame, delta) {
  const multiply = (matrix) => {
    const result = new Float32Array(matrix);
    for (let column = 0; column < 3; column++) {
      const offset = column * 4;
      const x = matrix[offset];
      const y = matrix[offset + 1];
      const z = matrix[offset + 2];
      result[offset] =
        delta.rotation[0] * x + delta.rotation[1] * y + delta.rotation[2] * z;
      result[offset + 1] =
        delta.rotation[3] * x + delta.rotation[4] * y + delta.rotation[5] * z;
      result[offset + 2] =
        delta.rotation[6] * x + delta.rotation[7] * y + delta.rotation[8] * z;
    }
    const x = matrix[12],
      y = matrix[13],
      z = matrix[14];
    result[12] =
      delta.rotation[0] * x +
      delta.rotation[1] * y +
      delta.rotation[2] * z +
      delta.translation[0];
    result[13] =
      delta.rotation[3] * x +
      delta.rotation[4] * y +
      delta.rotation[5] * z +
      delta.translation[1];
    result[14] =
      delta.rotation[6] * x +
      delta.rotation[7] * y +
      delta.rotation[8] * z +
      delta.translation[2];
    return result;
  };
  const positions = new Float32Array(frame.positions);
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index],
      y = positions[index + 1],
      z = positions[index + 2];
    if (![x, y, z].every(Number.isFinite)) continue;
    const transformed = transformPointByRigidDelta({ x, y, z }, delta);
    positions[index] = transformed.x;
    positions[index + 1] = transformed.y;
    positions[index + 2] = transformed.z;
  }
  const transformMatrix = multiply(frame.transformMatrix);
  const viewTransformMatrix = multiply(
    frame.viewTransformMatrix?.length === 16
      ? frame.viewTransformMatrix
      : frame.transformMatrix,
  );
  return {
    ...frame,
    positions,
    transformMatrix,
    viewTransformMatrix,
    camera: new Float32Array([
      transformMatrix[12],
      transformMatrix[13],
      transformMatrix[14],
    ]),
  };
}

function rigidCorrespondences(source, target, limit = 420) {
  if (
    !source?.filteredDepth?.length ||
    !target?.filteredDepth?.length ||
    !source.measuredMask?.length ||
    !target.measuredMask?.length
  )
    return [];
  const stride = Math.max(1, Math.ceil((source.filteredCount || 0) / limit));
  const pairs = [];
  let cursor = 0;
  for (let index = 0; index < source.filteredDepth.length; index++) {
    if (!source.measuredMask[index] || cursor++ % stride) continue;
    const offset = index * 3;
    const sourcePoint = {
      x: source.positions[offset],
      y: source.positions[offset + 1],
      z: source.positions[offset + 2],
    };
    if (![sourcePoint.x, sourcePoint.y, sourcePoint.z].every(Number.isFinite))
      continue;
    const projection = projectWorld(target, sourcePoint.x, sourcePoint.y, sourcePoint.z);
    if (!projection) continue;
    const measured = sampleProjectiveDepth(
      target,
      projection.u,
      projection.v,
    );
    if (!measured) continue;
    // Keep the correspondence search broad enough to recover a small AR pose
    // drift, but never use a different depth layer as a rigid anchor.
    if (
      Math.abs(measured - projection.depth) >
      Math.max(0.16, measured * 0.085)
    )
      continue;
    const targetPoint = depthPositionAt(
      target,
      projection.u,
      projection.v,
      measured,
    );
    if (!targetPoint?.every(Number.isFinite)) continue;
    pairs.push({ source: sourcePoint, target: {
      x: targetPoint[0],
      y: targetPoint[1],
      z: targetPoint[2],
    } });
  }
  return pairs;
}

function estimateRigidDelta(pairs) {
  if (pairs.length < 18) return null;
  const sourceCenter = [0, 0, 0];
  const targetCenter = [0, 0, 0];
  pairs.forEach(({ source, target }) => {
    sourceCenter[0] += source.x;
    sourceCenter[1] += source.y;
    sourceCenter[2] += source.z;
    targetCenter[0] += target.x;
    targetCenter[1] += target.y;
    targetCenter[2] += target.z;
  });
  for (let axis = 0; axis < 3; axis++) {
    sourceCenter[axis] /= pairs.length;
    targetCenter[axis] /= pairs.length;
  }
  // Horn's quaternion form of the absolute orientation problem. The
  // covariance maps the current target points onto the source points; the
  // largest eigenvector is the least-squares rigid rotation.
  let sxx = 0, sxy = 0, sxz = 0;
  let syx = 0, syy = 0, syz = 0;
  let szx = 0, szy = 0, szz = 0;
  pairs.forEach(({ source, target }) => {
    const tx = target.x - targetCenter[0];
    const ty = target.y - targetCenter[1];
    const tz = target.z - targetCenter[2];
    const sx = source.x - sourceCenter[0];
    const sy = source.y - sourceCenter[1];
    const sz = source.z - sourceCenter[2];
    sxx += tx * sx; sxy += tx * sy; sxz += tx * sz;
    syx += ty * sx; syy += ty * sy; syz += ty * sz;
    szx += tz * sx; szy += tz * sy; szz += tz * sz;
  });
  const matrix = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  let quaternion = [1, 0, 0, 0];
  for (let pass = 0; pass < 18; pass++) {
    const next = [0, 0, 0, 0];
    for (let rowIndex = 0; rowIndex < 4; rowIndex++) {
      const row = matrix[rowIndex];
      for (let columnIndex = 0; columnIndex < 4; columnIndex++)
        next[rowIndex] += row[columnIndex] * quaternion[columnIndex];
    }
    const length = Math.hypot(...next) || 1;
    quaternion = next.map((value) => value / length);
  }
  const [qw, qx, qy, qz] = quaternion;
  const rotation = [
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy - qz * qw),
    2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw),
    1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw),
    2 * (qy * qz + qx * qw),
    1 - 2 * (qx * qx + qy * qy),
  ];
  const rotatedTarget = {
    x: rotation[0] * targetCenter[0] + rotation[1] * targetCenter[1] + rotation[2] * targetCenter[2],
    y: rotation[3] * targetCenter[0] + rotation[4] * targetCenter[1] + rotation[5] * targetCenter[2],
    z: rotation[6] * targetCenter[0] + rotation[7] * targetCenter[1] + rotation[8] * targetCenter[2],
  };
  const translation = [
    sourceCenter[0] - rotatedTarget.x,
    sourceCenter[1] - rotatedTarget.y,
    sourceCenter[2] - rotatedTarget.z,
  ];
  const beforeErrors = pairs.map(({ source, target }) =>
    Math.hypot(
      source.x - target.x,
      source.y - target.y,
      source.z - target.z,
    ),
  );
  const delta = { quaternion, rotation, translation };
  const afterErrors = pairs.map(({ source, target }) => {
    const corrected = transformPointByRigidDelta(target, delta);
    return Math.hypot(
      source.x - corrected.x,
      source.y - corrected.y,
      source.z - corrected.z,
    );
  });
  const median = (values) => {
    const sorted = values.slice().sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  };
  const beforeMedian = median(beforeErrors);
  const upperAfter = afterErrors
    .slice()
    .sort((left, right) => left - right)[Math.floor((afterErrors.length - 1) * 0.75)] || 0;
  return {
    ...delta,
    beforeMedian,
    afterMedian: median(afterErrors),
    upperAfter,
    beforeErrors,
    afterErrors,
  };
}

function refineRigidPair(source, target, options = {}) {
  let pairs = rigidCorrespondences(
    source,
    target,
    options.samples || 420,
  );
  if (pairs.length < 24) return null;
  let estimate = estimateRigidDelta(pairs);
  if (!estimate) return null;
  const trimLimit = Math.max(
    options.trimError || 0.045,
    estimate.upperAfter * 1.8,
  );
  const inliers = pairs.filter((_, index) => estimate.afterErrors[index] <= trimLimit);
  if (inliers.length >= 24 && inliers.length < pairs.length) {
    pairs = inliers;
    estimate = estimateRigidDelta(pairs) || estimate;
  }
  const translationMagnitude = Math.hypot(...estimate.translation);
  const rotationAngle = rigidDeltaRotationAngle(estimate);
  const improved =
    estimate.beforeMedian > 0.008 &&
    estimate.afterMedian < estimate.beforeMedian * 0.92;
  if (
    !improved ||
    translationMagnitude > (options.maxTranslation || 0.085) ||
    rotationAngle > (options.maxRotation || 0.095) ||
    estimate.afterMedian > (options.maxResidual || 0.055)
  )
    return null;
  return {
    delta: estimate,
    pairCount: pairs.length,
    translationMagnitude,
    rotationAngle,
  };
}

// AR tracking is usually good enough for a single frame, but small pose drift
// between depth frames bends a long wall and creates doubled shelf edges. Use
// only depth correspondences that already agree in visibility, apply bounded
// rigid corrections, and leave a frame untouched unless the residual improves
// substantially. This is deliberately an opt-in validated pass so legacy
// diagnostics and synthetic callers retain their original poses.
export function refineFramePoses(frames, options = {}) {
  const diagnostics = {
    attempted: 0,
    corrected: 0,
    rejected: 0,
    corrections: [],
  };
  if (!Array.isArray(frames) || frames.length < 2)
    return { frames, diagnostics };
  const corrected = frames.map(cloneFrameForPoseRefinement);
  const window = Math.max(1, options.window || 3);
  for (let index = 1; index < corrected.length; index++) {
    const target = corrected[index];
    let best = null;
    for (let referenceIndex = Math.max(0, index - window); referenceIndex < index; referenceIndex++) {
      diagnostics.attempted++;
      const proposal = refineRigidPair(
        corrected[referenceIndex],
        target,
        options,
      );
      if (!proposal) continue;
      if (
        !best ||
        proposal.pairCount > best.pairCount ||
        (proposal.pairCount === best.pairCount &&
          proposal.delta.afterMedian < best.delta.afterMedian)
      )
        best = { ...proposal, referenceIndex };
    }
    if (!best) {
      diagnostics.rejected++;
      continue;
    }
    corrected[index] = applyRigidDeltaToFrame(target, best.delta);
    diagnostics.corrected++;
    diagnostics.corrections.push({
      frameId: target.frameId,
      referenceFrameId: corrected[best.referenceIndex].frameId,
      pairCount: best.pairCount,
      translationMeters: best.translationMagnitude,
      rotationRadians: best.rotationAngle,
      medianResidualBefore: best.delta.beforeMedian,
      medianResidualAfter: best.delta.afterMedian,
    });
  }
  diagnostics.maxTranslationMeters = diagnostics.corrections.reduce(
    (maximum, correction) => Math.max(maximum, correction.translationMeters),
    0,
  );
  diagnostics.maxRotationRadians = diagnostics.corrections.reduce(
    (maximum, correction) => Math.max(maximum, correction.rotationRadians),
    0,
  );
  return { frames: corrected, diagnostics };
}

export function sampleLooksLikeVerticalPatch(frame, index) {
  const x = index % frame.columns;
  const y = Math.floor(index / frame.columns);
  if (!x || !y || x === frame.columns - 1 || y === frame.rows - 1)
    return false;
  const neighbors = [
    index - 1,
    index + 1,
    index - frame.columns,
    index + frame.columns,
  ];
  const centerDepth = frame.filteredDepth[index];
  const depthLimit = Math.max(0.065, centerDepth * 0.035);
  if (
    !centerDepth ||
    neighbors.some(
      (neighbor) =>
        !frame.measuredMask[neighbor] ||
        !frame.filteredDepth[neighbor] ||
        Math.abs(frame.filteredDepth[neighbor] - centerDepth) > depthLimit,
    )
  )
    return false;
  const point = (sample) => {
    const offset = sample * 3;
    return [
      frame.positions[offset],
      frame.positions[offset + 1],
      frame.positions[offset + 2],
    ];
  };
  const left = point(index - 1);
  const right = point(index + 1);
  const up = point(index - frame.columns);
  const down = point(index + frame.columns);
  if (![...left, ...right, ...up, ...down].every(Number.isFinite)) return false;
  const horizontal = right.map((value, axis) => value - left[axis]);
  const vertical = down.map((value, axis) => value - up[axis]);
  const normal = [
    horizontal[1] * vertical[2] - horizontal[2] * vertical[1],
    horizontal[2] * vertical[0] - horizontal[0] * vertical[2],
    horizontal[0] * vertical[1] - horizontal[1] * vertical[0],
  ];
  const normalLength = Math.hypot(...normal);
  if (normalLength < 1e-6) return false;
  // A wall normal is mostly horizontal. This prevents an outvoted shelf,
  // tabletop, floor, or ceiling measurement from being mistaken for glare.
  return Math.abs(normal[1] / normalLength) <= 0.5;
}

// Remove only a clearly outvoted front depth layer before TSDF fusion. A
// sample is kept when another independent view supports it, when too few views
// cover it, or when other views merely contain a foreground occluder. This
// preserves ordinary one/two-view coverage and back walls behind furniture,
// while suppressing isolated reflective strips that several views prove were
// empty space in front of the dominant wall.
export function suppressMinorityFrontLayers(frames) {
  const diagnostics = {
    examinedSamples: 0,
    rejectedSamples: 0,
    unsupportedRejectedSamples: 0,
    weakMinorityRejectedSamples: 0,
    cappedFrames: 0,
    frameRejections: [],
  };
  if (frames.length < 4) return { frames, diagnostics };
  const rejectedByFrame = frames.map(() => []);
  const viewDirections = frames.map((frame) => {
    const direction = [
      frame.transformMatrix[8],
      frame.transformMatrix[9],
      frame.transformMatrix[10],
    ];
    const length = Math.hypot(...direction) || 1;
    return direction.map((value) => value / length);
  });
  frames.forEach((frame, frameIndex) => {
    for (let index = 0; index < frame.filteredDepth.length; index++) {
      if (!frame.filteredDepth[index] || !frame.measuredMask[index]) continue;
      if (!sampleLooksLikeVerticalPatch(frame, index)) continue;
      const offset = index * 3;
      const point = [
        frame.positions[offset],
        frame.positions[offset + 1],
        frame.positions[offset + 2],
      ];
      if (!point.every(Number.isFinite)) continue;
      let agreeing = 0;
      let freeSpaceContradictions = 0;
      frames.forEach((other, otherIndex) => {
        if (otherIndex === frameIndex) return;
        const directionAgreement =
          viewDirections[frameIndex][0] * viewDirections[otherIndex][0] +
          viewDirections[frameIndex][1] * viewDirections[otherIndex][1] +
          viewDirections[frameIndex][2] * viewDirections[otherIndex][2];
        // Different wall directions are not votes about the same local depth
        // layer, even when their frustums happen to overlap at a room corner.
        if (directionAgreement < Math.cos((35 * Math.PI) / 180)) return;
        if (
          Math.hypot(
            frame.camera[0] - other.camera[0],
            frame.camera[1] - other.camera[1],
            frame.camera[2] - other.camera[2],
          ) < MIN_INDEPENDENT_VIEW_METERS
        )
          return;
        const projected = projectWorld(other, ...point);
        if (!projected) return;
        const measured = sampleProjectiveDepth(
          other,
          projected.u,
          projected.v,
        );
        if (!measured) return;
        const difference = measured - projected.depth;
        const agreementLimit = Math.max(0.05, measured * 0.024);
        const separatedLayer = Math.max(0.075, measured * 0.035);
        if (Math.abs(difference) <= agreementLimit) agreeing++;
        else if (difference >= separatedLayer) freeSpaceContradictions++;
      });
      diagnostics.examinedSamples++;
      // Three independent views and no supporting view are strong evidence of
      // an isolated phantom. One supporting view is overruled only by at least
      // five contradictory views, which avoids deleting legitimate two-view
      // wall edges and ordinary foreground objects.
      const unsupportedMinority =
        agreeing === 0 && freeSpaceContradictions >= 3;
      const weakMinority =
        agreeing === 1 && freeSpaceContradictions >= 5;
      if (!unsupportedMinority && !weakMinority) continue;
      rejectedByFrame[frameIndex].push({ index, unsupportedMinority });
    }
  });
  const filteredFrames = frames.map((frame, frameIndex) => {
    let rejected = rejectedByFrame[frameIndex];
    const measuredSamples = frame.measuredMask.reduce(
      (sum, measured) => sum + measured,
      0,
    );
    const rejectionLimit = Math.max(16, Math.floor(measuredSamples * 0.12));
    const capped = rejected.length > rejectionLimit;
    // Layer voting is a small-artifact filter, not a frame eraser. If its
    // verdict would remove a meaningful portion of a capture, retain that
    // capture and let the normal multi-view fusion checks resolve it.
    if (capped) {
      diagnostics.cappedFrames++;
      rejected = [];
    }
    rejected.forEach(({ unsupportedMinority }) => {
      diagnostics.rejectedSamples++;
      if (unsupportedMinority) diagnostics.unsupportedRejectedSamples++;
      else diagnostics.weakMinorityRejectedSamples++;
    });
    diagnostics.frameRejections.push({
      frameId: frame.frameId,
      rejectedSamples: rejected.length,
      candidateSamples: rejectedByFrame[frameIndex].length,
      capped,
    });
    if (!rejected.length) return frame;
    const filteredDepth = new Float32Array(frame.filteredDepth);
    const measuredMask = new Uint8Array(frame.measuredMask);
    const freeSpaceMask = new Uint8Array(frame.freeSpaceMask);
    const depthConfidence = new Uint8Array(frame.depthConfidence);
    rejected.forEach(({ index }) => {
      filteredDepth[index] = 0;
      measuredMask[index] = 0;
      freeSpaceMask[index] = 0;
      depthConfidence[index] = 0;
    });
    return {
      ...frame,
      filteredDepth,
      measuredMask,
      freeSpaceMask,
      depthConfidence,
      filteredCount: Math.max(0, frame.filteredCount - rejected.length),
    };
  });
  return { frames: filteredFrames, diagnostics };
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
    options.maxDimension || (surfaceMode ? 156 : 96),
    64,
    surfaceMode ? 160 : 112,
  );
  let voxelSize = Math.max(
    options.minVoxelSize || (surfaceMode ? 0.022 : 0.04),
    maxRange / (maxDimension - 5),
  );
  const dimensionsFor = () => ranges.map((range) => Math.max(5, Math.ceil((range + voxelSize * 4) / voxelSize) + 1));
  let dimensions = dimensionsFor();
  const maxCells = options.maxCells || (surfaceMode ? 1450000 : 700000);
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
  const lastViewIds = new Uint8Array(count);
  lastViewIds.fill(255);
  return {
    origin,
    dimensions,
    voxelSize,
    values: new Float32Array(count),
    weights: new Uint8Array(count),
    // `weights` records all TSDF contributions, including low-confidence
    // repaired pixels. These two arrays preserve the distinction needed by
    // meshing: only direct depth observations may establish independent
    // surface support; a small enclosed repair may be derived from measured
    // neighbours but never counts as another viewpoint.
    measuredSupport: new Uint8Array(count),
    derivedSupport: new Uint8Array(count),
    viewpointCounts: new Uint8Array(count),
    firstViewIds,
    lastViewIds,
    weightSums: new Float32Array(count),
    varianceSums: new Float32Array(count),
    depthSums: new Float32Array(count),
    freeSpaceVotes: new Uint8Array(count),
    colors: new Float32Array(count * 3),
    // Color observations can be down-weighted independently from geometry
    // when a frame is moving or its sampled pixel is clipped. Keep fractional
    // weights so one bad white/blurred view cannot overwrite several good
    // observations.
    colorWeights: new Float32Array(count),
    robustlyDownweightedSamples: 0,
    robustlyRejectedSamples: 0,
    motionDownweightedSamples: 0,
    repairedFusionSamples: 0,
    measuredFusionSamples: 0,
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
  // Match filterDepth's layer boundary rule. A broad interpolation band can
  // reintroduce the very foreground/background blending that filtering just
  // removed, especially around a narrow shelf or curtain fold.
  if (
    Math.max(a, b, c, d) - min >
    Math.max(0.035, Math.min(0.08, min * 0.028))
  )
    return nearest;
  const tx = px - x, ty = py - y;
  return 1 / ((1 - ty) * ((1 - tx) / a + tx / b) +
    ty * ((1 - tx) / c + tx / d));
}

function sampleFrameColor(frame, u, v, depthIndex) {
  if (frame.colorImage?.length && frame.colorWidth && frame.colorHeight) {
    // Keep the fallback vertex-color path on the same pixel-centre convention
    // as camera capture, atlas construction, and texture quality checks. A
    // height-multiplied floor samples the next row at v=0 and the last row
    // twice, which shows up as a one-pixel colour seam along scan edges.
    const x = clamp(
      Math.round(u * (frame.colorWidth - 1)),
      0,
      frame.colorWidth - 1,
    );
    const y = clamp(
      Math.round((1 - v) * (frame.colorHeight - 1)),
      0,
      frame.colorHeight - 1,
    );
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
    // Moving camera/depth pairs can be a few frames apart on mobile XR. Keep
    // their unique coverage, but let steady captures contribute more strongly
    // wherever several views overlap.
    const motionReliability = clamp(
      1 /
        (1 +
          (Number(frame.linearSpeed) || 0) / 0.45 +
          (Number(frame.angularSpeed) || 0) / 0.6),
      0.2,
      1,
    );
    // A stable revisit may replace the camera image without replacing the
    // original depth keyframe. Weight that image by its own capture motion;
    // depth-only/coarse-RGB frames still use the original depth-frame motion.
    const hasTextureImage = !!frame.colorImage?.length;
    const colorLinearSpeed = hasTextureImage
      ? Number(frame.textureLinearSpeed ?? frame.linearSpeed) || 0
      : Number(frame.linearSpeed) || 0;
    const colorAngularSpeed = hasTextureImage
      ? Number(frame.textureAngularSpeed ?? frame.angularSpeed) || 0
      : Number(frame.angularSpeed) || 0;
    const colorMotionReliability = clamp(
      1 / (1 + colorLinearSpeed / 0.45 + colorAngularSpeed / 0.6),
      0.2,
      1,
    );
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
          // A repaired/interpolated depth value can help bridge a tiny hole,
          // but it must not establish a second independent surface view. The
          // nearest projected sample is the owner of this ray; preserve its
          // measured provenance through fusion instead of treating every
          // filtered value as equally trustworthy.
          const directlyMeasured =
            !frame.measuredMask?.length || !!frame.measuredMask[depthIndex];
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
          const delta = normalized - volume.values[index];
          const localConfidence = (frame.depthConfidence[depthIndex] || 0) / 255;
          const distanceWeight = clamp(1.15 - projected.depth / 8, 0.25, 1);
          let sampleWeight =
            clamp(localConfidence * distanceWeight, 0.08, 1) *
            motionReliability;
          if (!directlyMeasured) {
            sampleWeight *= 0.22;
            volume.repairedFusionSamples++;
          } else {
            volume.measuredFusionSamples++;
          }
          if (motionReliability < 0.8)
            volume.motionDownweightedSamples++;
          // Once two observations establish a local TSDF value, use a Huber
          // influence curve for later disagreement. This stops a slightly
          // drifted view from bending a straight wall or producing a doubled
          // shelf, while retaining that view's genuinely new measured area.
          if (volume.viewpointCounts[index] >= 2 && previousWeight > 0.2) {
            const residual = Math.abs(delta);
            // Once independent views establish a local surface, a later TSDF
            // sample that disagrees by almost a full truncation band is pose
            // drift or another depth layer, not useful smoothing evidence.
            // Reject it locally while retaining the frame's genuinely new
            // regions elsewhere in the volume.
            if (residual >= 0.82) {
              volume.robustlyRejectedSamples++;
              continue;
            }
            const robustAgreement = residual > 0.34
              ? clamp(((0.82 - residual) / 0.48) ** 2, 0.08, 1)
              : 1;
            if (robustAgreement < 0.999)
              volume.robustlyDownweightedSamples++;
            sampleWeight *= robustAgreement;
          }
          const nextWeight = previousWeight + sampleWeight;
          const nextMean = volume.values[index] + delta * sampleWeight / nextWeight;
          volume.varianceSums[index] += sampleWeight * delta * (normalized - nextMean);
          volume.values[index] = nextMean;
          volume.weightSums[index] = nextWeight;
          volume.depthSums[index] += projected.depth * sampleWeight;
          volume.weights[index] = Math.min(32, previousViews + 1);
          if (directlyMeasured) {
            volume.measuredSupport[index] = Math.min(
              255,
              volume.measuredSupport[index] + 1,
            );
          }
          if (directlyMeasured && !volume.viewpointCounts[index]) {
            volume.viewpointCounts[index] = 1;
            volume.firstViewIds[index] = frameIndex;
            volume.lastViewIds[index] = frameIndex;
          } else if (directlyMeasured) {
            const firstCamera = frames[volume.firstViewIds[index]]?.camera;
            const lastCamera = frames[volume.lastViewIds[index]]?.camera;
            const distanceFrom = (camera) =>
              camera
                ? Math.hypot(
                    frame.camera[0] - camera[0],
                    frame.camera[1] - camera[1],
                    frame.camera[2] - camera[2],
                  )
                : 0;
            if (
              lastCamera &&
              distanceFrom(lastCamera) >= MIN_INDEPENDENT_VIEW_METERS &&
              (volume.viewpointCounts[index] !== 2 ||
                distanceFrom(firstCamera) >= MIN_INDEPENDENT_VIEW_METERS)
            ) {
              volume.viewpointCounts[index] = Math.min(
                32,
                volume.viewpointCounts[index] + 1,
              );
              volume.lastViewIds[index] = frameIndex;
            }
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
            // Repaired depth does not own a trustworthy camera pixel. Do not
            // paint its interpolated sample over a measured surface; the
            // later local color propagation can fill a genuinely enclosed
            // hole from compatible measured neighbours.
            if (color && directlyMeasured) {
              const colorWeight = volume.colorWeights[index];
              const luminance =
                color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
              const minimum = Math.min(...color);
              const clippedPixel = luminance >= 246 && minimum >= 218;
              const darkPixel = luminance <= 7;
              const frameClipping = clamp(
                Number(frame.colorClippedRatio) || 0,
                0,
                0.8,
              );
              const colorSampleWeight = clamp(
                colorMotionReliability *
                  (1 - frameClipping * 0.65) *
                  (clippedPixel ? 0.16 : darkPixel ? 0.35 : 1),
                0.08,
                1,
              );
              const frameColorScales = frame.fusionColorScales;
              const correctedColor = frameColorScales
                ? color.map((channel, channelIndex) =>
                    clamp(
                      channel * (frameColorScales[channelIndex] || 1),
                      0,
                      255,
                    ),
                  )
                : color;
              const nextColorWeight = colorWeight + colorSampleWeight;
              const offset = index * 3;
              correctedColor.forEach((channel, channelIndex) => {
                volume.colors[offset + channelIndex] =
                  (volume.colors[offset + channelIndex] * colorWeight +
                    linearByte(channel) * colorSampleWeight) /
                  nextColorWeight;
              });
              volume.colorWeights[index] = Math.min(32, nextColorWeight);
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
  const sourceMeasuredSupport = new Uint8Array(volume.measuredSupport);
  const directions = [
    [-1, 0, 0], [1, 0, 0], [0, -1, 0],
    [0, 1, 0], [0, 0, -1], [0, 0, 1],
  ];
  for (let z = 1; z < depth - 1; z++)
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const index = volumeIndex(volume, x, y, z);
        let valueSum = 0;
        const valueSamples = [];
        let colorCount = 0;
        const colorSum = [0, 0, 0];
        let support = 0;
        directions.forEach(([dx, dy, dz]) => {
          const neighbor = volumeIndex(volume, x + dx, y + dy, z + dz);
          if (
            sourceWeights[neighbor] < 2 ||
            sourceMeasuredSupport[neighbor] < 1
          )
            return;
          support++;
          const value = sourceValues[neighbor];
          valueSum += value;
          valueSamples.push(value);
          if (volume.colorWeights[neighbor]) {
            const offset = neighbor * 3;
            colorSum[0] += volume.colors[offset];
            colorSum[1] += volume.colors[offset + 1];
            colorSum[2] += volume.colors[offset + 2];
            colorCount++;
          }
        });
        if (sourceMeasuredSupport[index] >= 1 && sourceWeights[index] >= 2 && support >= 4) {
          // Bilateral TSDF regularization: do not average across a depth
          // transition (a shelf edge, doorway, or foreground object). The old
          // unconditional average turned those transitions into curved,
          // blurry sheets.
          const centerValue = sourceValues[index];
          const agreeing = valueSamples.filter(
            (value) => Math.abs(value - centerValue) <= 0.24,
          );
          if (agreeing.length >= 4)
            volume.values[index] =
              centerValue * 0.84 +
              (agreeing.reduce((sum, value) => sum + value, 0) / agreeing.length) *
                0.16;
        } else if (!sourceMeasuredSupport[index] && support >= 5) {
          // Repair only a one-voxel hole enclosed by measured neighbors. This
          // cannot bridge a doorway or a broad unscanned part of the room.
          const compatibleHole =
            valueSamples.length < 5 ||
            Math.max(...valueSamples) - Math.min(...valueSamples) <= 0.28;
          if (compatibleHole) {
            volume.values[index] = valueSum / support;
            volume.weights[index] = 1;
            volume.weightSums[index] = 0.35;
            // This is explicitly derived from surrounding measured voxels. It
            // is eligible for a tiny enclosed mesh repair, but it cannot be
            // mistaken for direct sensor evidence or an independent view.
            volume.derivedSupport[index] = Math.min(255, support);
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
    const sourceWeights = new Float32Array(volume.colorWeights);
    for (let z = 1; z < depth - 1; z++)
      for (let y = 1; y < height - 1; y++)
        for (let x = 1; x < width - 1; x++) {
          const index = volumeIndex(volume, x, y, z);
          if (
            !volume.weights[index] ||
            sourceWeights[index] ||
            (!volume.measuredSupport[index] && !volume.derivedSupport[index])
          )
            continue;
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
    measuredSupport: volume.measuredSupport[index],
    derivedSupport: volume.derivedSupport[index],
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
  };
  const hasSurfaceEvidence = (corner) =>
    corner?.weight >= 1 &&
    (corner.measuredSupport >= 1 || corner.derivedSupport >= 5);
  for (let z = 0; z < cellDepth; z++)
    for (let y = 0; y < cellHeight; y++)
      for (let x = 0; x < cellWidth; x++) {
        const corners = CUBE_CORNERS.map(([dx, dy, dz]) => volumeCorner(volume, x + dx, y + dy, z + dz));
        // An unknown corner is not evidence of empty space. Allow a supported
        // boundary cell, but intersect only edges with measured endpoints.
        const known = corners.filter(
          (corner) =>
            corner.weight >= 1 &&
            (corner.measuredSupport >= 1 || corner.derivedSupport >= 5),
        );
        if (known.length < 4) {
          rejectionCounts.insufficientSupport++;
          continue;
        }
        const reliable = (corner) => {
          const closeRange = corner.meanDepth < 0.9;
          const derivedHole =
            corner.measuredSupport < 1 && corner.derivedSupport >= 5;
          const requiredViews = options.surfaceMode
            // Close-range phone depth is noisier, but three independent
            // observations are enough to reject a transient reading. The old
            // four-view requirement left broad holes when a user captured a
            // partial wall from only a few translated positions.
            ? (closeRange ? 3 : 2)
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
          // A derived hole may participate only as a small enclosed repair;
          // it is deliberately never assigned independent viewpoints. Direct
          // samples retain the normal multi-view requirement.
          return derivedHole
            ? corner.weight >= 1 &&
                (!repeatedVariance || corner.variance <= varianceLimit) &&
                !contradictedByFreeSpace
            : corner.weight >= requiredViews &&
                corner.measuredSupport >= 1 &&
                corner.viewpoints >= 2 &&
                (!repeatedVariance || corner.variance <= varianceLimit) &&
                !contradictedByFreeSpace;
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
        const negative = known.some((corner) => corner.value < 0);
        const positive = known.some((corner) => corner.value >= 0);
        if (!negative || !positive) continue;
        const intersections = [];
        CUBE_EDGES.forEach(([firstIndex, secondIndex]) => {
          const first = corners[firstIndex];
          const second = corners[secondIndex];
          if (!hasSurfaceEvidence(first) || !hasSurfaceEvidence(second)) return;
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
            reliableEndpoints: reliable(first) && reliable(second),
          });
        });
        if (!intersections.length) continue;
        // A cell can contain a weak boundary crossing next to several
        // repeatedly measured crossings. Averaging all of them equally lets
        // a single interpolated shelf/window edge bend the entire surface-net
        // vertex. Prefer fully reliable crossings when at least two establish
        // the local surface; retain the old boundary fallback when they do not.
        const reliableIntersections = intersections.filter(
          (intersection) => intersection.reliableEndpoints,
        );
        const vertexIntersections =
          reliableIntersections.length >= 2
            ? reliableIntersections
            : intersections;
        const vertex = vertexIntersections.reduce(
          (sum, point) => ({
            x: sum.x + point.x / vertexIntersections.length,
            y: sum.y + point.y / vertexIntersections.length,
            z: sum.z + point.z / vertexIntersections.length,
            color: sum.color.map((channel, index) => channel + point.color[index] / vertexIntersections.length),
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
        if (hasSurfaceEvidence(first) && hasSurfaceEvidence(second) && (first.value < 0) !== (second.value < 0))
          addQuad(cell(x, y - 1, z - 1), cell(x, y, z - 1), cell(x, y, z), cell(x, y - 1, z), first.value < 0);
      }
  for (let z = 1; z < depth - 1; z++)
    for (let y = 0; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const first = volumeCorner(volume, x, y, z);
        const second = volumeCorner(volume, x, y + 1, z);
        if (hasSurfaceEvidence(first) && hasSurfaceEvidence(second) && (first.value < 0) !== (second.value < 0))
          addQuad(cell(x - 1, y, z - 1), cell(x - 1, y, z), cell(x, y, z), cell(x, y, z - 1), first.value < 0);
      }
  for (let z = 0; z < depth - 1; z++)
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const first = volumeCorner(volume, x, y, z);
        const second = volumeCorner(volume, x, y, z + 1);
        if (hasSurfaceEvidence(first) && hasSurfaceEvidence(second) && (first.value < 0) !== (second.value < 0))
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

function triangleMaximumEdge(positions, first, second, third) {
  const vertices = [first, second, third].map((vertex) => vertex * 3);
  let maximum = 0;
  for (let corner = 0; corner < 3; corner++) {
    const left = vertices[corner];
    const right = vertices[(corner + 1) % 3];
    maximum = Math.max(
      maximum,
      Math.hypot(
        positions[left] - positions[right],
        positions[left + 1] - positions[right + 1],
        positions[left + 2] - positions[right + 2],
      ),
    );
  }
  return maximum;
}

// A missing-depth boundary should remain open. A triangle spanning several
// voxels is almost always a bridge across that boundary and reads as a long,
// warped strip in the result. Keep this pass opt-in for callers that do not
// have a calibrated voxel size (for example older diagnostic replays).
export function meshBridgeDiagnostics(mesh, voxelSize, options = {}) {
  const totalTriangles = Math.floor((mesh?.indices?.length || 0) / 3);
  const protectedTrailingTriangles = Math.max(
    0,
    Math.min(
      totalTriangles,
      Math.floor(Number(options.protectedTrailingTriangles) || 0),
    ),
  );
  const checkedTriangles = totalTriangles - protectedTrailingTriangles;
  const size = Number(voxelSize);
  const maxEdge = Number.isFinite(Number(options.maxEdge))
    ? Number(options.maxEdge)
    : Math.max(0.065, Number.isFinite(size) ? size * 3 : 0.065);
  let longEdgeTriangles = 0;
  let maximumEdge = 0;
  if (mesh?.positions?.length && mesh?.indices?.length)
    for (let index = 0; index < checkedTriangles * 3; index += 3) {
      const edge = triangleMaximumEdge(
        mesh.positions,
        mesh.indices[index],
        mesh.indices[index + 1],
        mesh.indices[index + 2],
      );
      maximumEdge = Math.max(maximumEdge, edge);
      if (edge > maxEdge) longEdgeTriangles++;
    }
  return {
    maxEdgeMeters: maxEdge,
    maximumObservedEdgeMeters: maximumEdge,
    totalTriangles,
    checkedTriangles,
    protectedTrailingTriangles,
    longEdgeTriangles,
    longEdgeRatio: longEdgeTriangles / Math.max(1, checkedTriangles),
  };
}

export function pruneUnsupportedMeshBridges(mesh, voxelSize, options = {}) {
  if (!mesh?.indices?.length || !mesh?.positions?.length)
    return { ...mesh, removedBridgeTriangles: 0 };
  const diagnostics = meshBridgeDiagnostics(mesh, voxelSize, options);
  if (!diagnostics.longEdgeTriangles)
    return { ...mesh, removedBridgeTriangles: 0, meshBridgeDiagnostics: diagnostics };
  const kept = [];
  let removedArea = 0;
  const protectedIndexStart = diagnostics.checkedTriangles * 3;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const first = mesh.indices[index];
    const second = mesh.indices[index + 1];
    const third = mesh.indices[index + 2];
    if (index >= protectedIndexStart) {
      kept.push(first, second, third);
      continue;
    }
    const edge = triangleMaximumEdge(mesh.positions, first, second, third);
    if (edge <= diagnostics.maxEdgeMeters) {
      kept.push(first, second, third);
      continue;
    }
    const normal = meshTriangleNormal(mesh.positions, first, second, third);
    removedArea += Math.hypot(...normal) * 0.5;
  }
  return {
    ...mesh,
    indices: new Uint32Array(kept),
    surfaceArea: Math.max(0, (mesh.surfaceArea || 0) - removedArea),
    removedBridgeTriangles: diagnostics.longEdgeTriangles,
    meshBridgeDiagnostics: diagnostics,
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
      wall.dominantOrientationRatio >= 0.38 &&
      wall.dominantLayerRatio >= 0.55,
  );
  if (!supported.length)
    return { ...mesh, stabilizedPlaneCount: 0, stabilizedVertexCount: 0 };
  const positions = new Float32Array(mesh.positions);
  const normals = computeNormals(mesh);
  const adjacency = Array.from(
    { length: positions.length / 3 },
    () => new Set(),
  );
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.indices[index];
    const b = mesh.indices[index + 1];
    const c = mesh.indices[index + 2];
    adjacency[a].add(b); adjacency[a].add(c);
    adjacency[b].add(a); adjacency[b].add(c);
    adjacency[c].add(a); adjacency[c].add(b);
  }
  // Mobile depth noise and small pose drift can bow an otherwise well
  // supported wall by more than one voxel. The cap keeps nearby furniture and
  // recessed surfaces out of the correction; no vertices or triangles are
  // created by this operation.
  // Correct ordinary depth ripple, but never collapse a nearby second sheet
  // onto the wall. The previous 10 cm radius could merge pose-drift layers or
  // shallow trim with the fitted plane and create coincident triangles.
  const distanceLimit = clamp(voxelSize * 2.6, 0.045, 0.065);
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
      if (alignment < 0.8) return;
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
        best = { normal, distance, wallOffset: wall.wallOffset };
    });
    if (!best) continue;
    // A plane is safe to apply only when the immediate connected patch also
    // agrees with it. Global proximity alone can flatten curtain folds,
    // trim, or a shelf front that happens to sit within a few centimetres of
    // the wall. Median residual keeps ordinary measured ripple eligible while
    // rejecting isolated/edge-layer vertices.
    const neighbourResiduals = [...adjacency[vertex]]
      .map((neighbour) => {
        const neighbourOffset = neighbour * 3;
        return Math.abs(
          positions[neighbourOffset] * best.normal.x +
            positions[neighbourOffset + 2] * best.normal.z -
            best.wallOffset,
        );
      })
      .filter((value) => Number.isFinite(value));
    if (neighbourResiduals.length < 2) continue;
    neighbourResiduals.sort((left, right) => left - right);
    const medianResidual =
      neighbourResiduals[Math.floor(neighbourResiduals.length / 2)];
    if (medianResidual > distanceLimit * 0.7) continue;
    positions[offset] -= best.normal.x * best.distance * 0.9;
    positions[offset + 2] -= best.normal.z * best.distance * 0.9;
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
  const adjacency = Array.from(
    { length: positions.length / 3 },
    () => new Set(),
  );
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.indices[index];
    const b = mesh.indices[index + 1];
    const c = mesh.indices[index + 2];
    adjacency[a].add(b); adjacency[a].add(c);
    adjacency[b].add(a); adjacency[b].add(c);
    adjacency[c].add(a); adjacency[c].add(b);
  }
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
    const residuals = [...adjacency[vertex]]
      .map((neighbour) => Math.abs(positions[neighbour * 3 + 1] - (positions[offset + 1] - closest)))
      .sort((left, right) => left - right);
    if (
      residuals.length < 2 ||
      residuals[Math.floor(residuals.length / 2)] > distanceLimit * 0.7
    )
      continue;
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

// Plane fitting is only a proposal. Near folds/trim, independently snapping
// vertices can invert a small triangle or crush it into a neighboring layer.
// Roll back those moves, not the measured triangles. Recheck adjacent faces
// after every rollback so correcting one face cannot break another.
export function constrainSurfaceDeformation(mesh, proposed) {
  const source = mesh.positions;
  const positions = new Float32Array(proposed);
  const adjacency = Array.from({ length: source.length / 3 }, () => []);
  const triangleCount = mesh.indices.length / 3;
  const queued = new Uint8Array(triangleCount).fill(1);
  const queue = Array.from({ length: triangleCount }, (_, index) => index);
  for (let index = 0; index < mesh.indices.length; index++)
    adjacency[mesh.indices[index]].push(Math.floor(index / 3));
  let revertedVertices = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const triangleIndex = queue[cursor];
    queued[triangleIndex] = 0;
    const triangle = Array.from(mesh.indices.subarray(triangleIndex * 3, triangleIndex * 3 + 3));
    const original = meshTriangleNormal(source, ...triangle);
    const corrected = meshTriangleNormal(positions, ...triangle);
    const originalArea = Math.hypot(...original);
    const correctedArea = Math.hypot(...corrected);
    const alignment = original.reduce((sum, value, axis) => sum + value * corrected[axis], 0);
    // meshTriangleNormal returns an unnormalized cross product.
    const safe = Number.isFinite(correctedArea) && originalArea > 1e-12 &&
      correctedArea >= originalArea * 0.4 && correctedArea <= originalArea * 2.5 &&
      alignment >= originalArea * correctedArea * 0.5;
    if (safe) continue;
    for (const vertex of triangle) {
      const offset = vertex * 3;
      if ([0, 1, 2].every((axis) => positions[offset + axis] === source[offset + axis])) continue;
      positions.set(source.subarray(offset, offset + 3), offset);
      revertedVertices++;
      adjacency[vertex].forEach((neighbor) => {
        if (queued[neighbor]) return;
        queued[neighbor] = 1;
        queue.push(neighbor);
      });
    }
  }
  return { positions, revertedVertices };
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

function imageDetailMetrics(frame) {
  if (
    !frame?.colorImage?.length ||
    frame.colorWidth < 3 ||
    frame.colorHeight < 3
  )
    return { sharpness: 0, focus: 0 };
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
  let focus = 0;
  let clipped = 0;
  let samples = 0;
  for (let y = 1; y < frame.colorHeight - 1; y += step)
    for (let x = 1; x < frame.colorWidth - 1; x += step) {
      const center = luminanceAt(x, y);
      const left = luminanceAt(x - 1, y);
      const right = luminanceAt(x + 1, y);
      const above = luminanceAt(x, y - 1);
      const below = luminanceAt(x, y + 1);
      detail += Math.abs(right - center) + Math.abs(below - center);
      // A first derivative can still rate a broad motion-blurred edge highly.
      // Laplacian energy measures the high-frequency focus that survives only
      // in a genuinely sharp camera frame.
      focus += Math.abs(center * 4 - left - right - above - below);
      if (center < 5 || center > 250) clipped++;
      samples++;
    }
  if (!samples) return { sharpness: 0, focus: 0 };
  const clippingPenalty = 1 - Math.min(0.75, clipped / samples);
  return {
    sharpness: (detail / samples) * clippingPenalty,
    focus: (focus / samples) * clippingPenalty,
  };
}

export function imageSharpness(frame) {
  return imageDetailMetrics(frame).sharpness;
}

export function imageFocus(frame) {
  return imageDetailMetrics(frame).focus;
}

function texturePixel(frame, projection) {
  if (
    !projection ||
    !frame?.colorImage?.length ||
    !frame.colorWidth ||
    !frame.colorHeight
  )
    return null;
  const x = clamp(
    Math.round(projection.u * (frame.colorWidth - 1)),
    0,
    frame.colorWidth - 1,
  );
  // Camera copies are stored bottom-up. Texture UV generation applies this
  // same flip; quality checks and overlap calibration must sample the same
  // physical pixel.
  const y = clamp(
    Math.round((1 - projection.v) * (frame.colorHeight - 1)),
    0,
    frame.colorHeight - 1,
  );
  const offset = (y * frame.colorWidth + x) * frame.colorChannels;
  const color = [
    frame.colorImage[offset],
    frame.colorImage[offset + 1],
    frame.colorImage[offset + 2],
  ];
  return color.every(Number.isFinite) ? color : null;
}

function usableCalibrationColor(color) {
  if (!color) return false;
  const minimum = Math.min(...color);
  const maximum = Math.max(...color);
  const luminance =
    color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  return luminance >= 14 && luminance <= 238 && minimum >= 5 && maximum <= 248;
}

function calibrationPixel(frame, point) {
  if (frame.colorImage?.length)
    return texturePixel(frame, projectColorWorld(frame, ...point));
  // A depth-only keyframe still owns sampled camera RGB. Calibrate it too:
  // these frames supply much of the fallback surface, so leaving them at raw
  // exposure while correcting the atlas recreates the same color patches.
  const projection = projectWorld(frame, ...point);
  if (!projection) return null;
  const index = gridIndex(frame, projection.u, projection.v);
  if (!frame.measuredMask[index] || !frame.colorMask?.[index]) return null;
  const offset = index * 3;
  return Array.from(frame.colors.subarray(offset, offset + 3));
}

// Estimate per-camera color correction from pixels that correspond to the
// same measured 3D points. This is more reliable than comparing whole images:
// a frame aimed at a bright window and a frame aimed at a dark shelf can have
// very different scene content even when their camera exposure is identical.
export function overlapTextureColorScales(frames) {
  const edges = [];
  for (let left = 0; left < frames.length; left++)
    for (let right = left + 1; right < frames.length; right++) {
      const first = frames[left];
      const second = frames[right];
      if (
        !(first.colorImage?.length || first.colorMask?.length) ||
        !(second.colorImage?.length || second.colorMask?.length)
      ) continue;
      const differences = [[], [], []];
      const sourceCount =
        first.filteredCount || first.filteredDepth?.length || 0;
      const stride = Math.max(1, Math.ceil(sourceCount / 220));
      let cursor = 0;
      for (let index = 0; index < first.filteredDepth.length; index++) {
        if (!first.measuredMask[index] || cursor++ % stride) continue;
        const offset = index * 3;
        const point = [
          first.positions[offset],
          first.positions[offset + 1],
          first.positions[offset + 2],
        ];
        if (!point.every(Number.isFinite)) continue;
        const targetProjection = projectWorld(second, ...point);
        if (!targetProjection) continue;
        const targetDepth = sampleProjectiveDepth(
          second,
          targetProjection.u,
          targetProjection.v,
        );
        if (
          !targetDepth ||
          Math.abs(targetDepth - targetProjection.depth) >
            Math.max(0.045, targetDepth * 0.025)
        )
          continue;
        const firstColor = calibrationPixel(first, point);
        const secondColor = calibrationPixel(second, point);
        if (
          !usableCalibrationColor(firstColor) ||
          !usableCalibrationColor(secondColor)
        )
          continue;
        for (let channel = 0; channel < 3; channel++)
          differences[channel].push(
            Math.log(firstColor[channel] / secondColor[channel]),
          );
      }
      if (differences[0].length < 18) continue;
      const delta = differences.map((values) => {
        values.sort((a, b) => a - b);
        return clamp(
          values[Math.floor(values.length / 2)],
          Math.log(0.55),
          Math.log(1.82),
        );
      });
      edges.push({
        left,
        right,
        delta,
        weight: Math.min(180, differences[0].length),
      });
    }
  const connected = new Uint8Array(frames.length);
  edges.forEach((edge) => {
    connected[edge.left] = 1;
    connected[edge.right] = 1;
  });
  const logarithms = Array.from({ length: frames.length }, () => [0, 0, 0]);
  for (let pass = 0; pass < 24; pass++) {
    const next = logarithms.map((values) => [...values]);
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      if (!connected[frameIndex]) continue;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        let weight = 2;
        edges.forEach((edge) => {
          if (edge.left === frameIndex) {
            sum +=
              (logarithms[edge.right][channel] - edge.delta[channel]) *
              edge.weight;
            weight += edge.weight;
          } else if (edge.right === frameIndex) {
            sum +=
              (logarithms[edge.left][channel] + edge.delta[channel]) *
              edge.weight;
            weight += edge.weight;
          }
        });
        const target = clamp(
          sum / weight,
          Math.log(0.72),
          Math.log(1.38),
        );
        // Undamped Jacobi oscillates on pairs/chains of overlapping views,
        // leaving a large exposure jump after a fixed number of iterations.
        next[frameIndex][channel] =
          (logarithms[frameIndex][channel] + target) * 0.5;
      }
    }
    next.forEach((values, index) => {
      logarithms[index] = values;
    });
  }
  // Disconnected camera groups have no photometric relationship. Center each
  // overlap component independently, including both middle values for pairs.
  const visited = new Uint8Array(frames.length);
  for (let start = 0; start < frames.length; start++) {
    if (!connected[start] || visited[start]) continue;
    const component = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < component.length; cursor++) {
      edges.forEach(({ left, right }) => {
        const neighbor = left === component[cursor] ? right : right === component[cursor] ? left : -1;
        if (neighbor < 0 || visited[neighbor]) return;
        visited[neighbor] = 1;
        component.push(neighbor);
      });
    }
    for (let channel = 0; channel < 3; channel++) {
      const values = component.map((index) => logarithms[index][channel]).sort((a, b) => a - b);
      const center = (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
      component.forEach((index) => { logarithms[index][channel] -= center; });
    }
  }
  return {
    scales: logarithms.map((channels, index) => {
      if (!connected[index]) return null;
      // Exposure may legitimately vary substantially between views, but
      // solving each RGB channel independently can turn a neutral wall pink,
      // green, or blue when a correspondence lands on a colored/specular
      // object. Preserve the shared exposure correction and tightly bound only
      // the chromatic deviation around it.
      const exposureLog =
        channels[0] * 0.2126 +
        channels[1] * 0.7152 +
        channels[2] * 0.0722;
      return channels.map((value) => {
        const chromaLog = clamp(
          value - exposureLog,
          Math.log(0.94),
          Math.log(1.06),
        );
        return clamp(Math.exp(exposureLog + chromaLog), 0.72, 1.38);
      });
    }),
    pairCount: edges.length,
  };
}

export function textureColorDifference(first, second) {
  if (!first || !second) return 0;
  const luminance = (color) =>
    color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const luminanceDifference =
    Math.abs(firstLuminance - secondLuminance) / 128;
  const chromaDifference = [0, 1, 2].reduce(
    (sum, channel) =>
      sum +
      Math.abs(
        first[channel] / Math.max(24, firstLuminance) -
          second[channel] / Math.max(24, secondLuminance),
      ) /
        3,
    0,
  );
  return clamp(luminanceDifference * 0.65 + chromaDifference * 0.35, 0, 2);
}

function calibratedTexturePixel(frame, projection) {
  return texturePixel(frame, projection)?.map((value, channel) =>
    clamp(Math.round(value * (frame.textureChannelScales?.[channel] || 1)), 0, 255),
  );
}

// Compare the SAME shared edge in both cameras, not the two triangle centers
// (which may lie on different colored objects). Include the midpoint so seams
// crossing a narrow curtain stripe are not missed by endpoint-only scoring.
function textureEdgeColors(candidate, corners) {
  const a = candidate.projections[corners[0]];
  const b = candidate.projections[corners[1]];
  return [0, 0.5, 1].map((blend) => calibratedTexturePixel(candidate.frame, {
    u: a.u + (b.u - a.u) * blend,
    v: a.v + (b.v - a.v) * blend,
  }));
}

function edgeColorDifference(first, second) {
  return first.reduce((sum, color, index) => sum + textureColorDifference(color, second[index]), 0) / 3;
}

export function textureEdgeDifference(first, firstCorners, second, secondCorners) {
  return edgeColorDifference(textureEdgeColors(first, firstCorners), textureEdgeColors(second, secondCorners));
}

export function textureProjectionStretch(points, projections, width, height) {
  if (
    points?.length !== 3 ||
    projections?.length !== 3 ||
    projections.some((projection) => !projection) ||
    !width ||
    !height
  )
    return null;
  const worldEdges = [];
  const pixelEdges = [];
  for (const [first, second] of [[0, 1], [1, 2], [2, 0]]) {
    worldEdges.push(
      Math.hypot(
        points[first][0] - points[second][0],
        points[first][1] - points[second][1],
        points[first][2] - points[second][2],
      ),
    );
    pixelEdges.push(
      Math.hypot(
        (projections[first].u - projections[second].u) * width,
        (projections[first].v - projections[second].v) * height,
      ),
    );
  }
  if (worldEdges.some((edge) => edge < 0.00001)) return null;
  const scales = pixelEdges.map((edge, index) => edge / worldEdges[index]);
  const minimumScale = Math.min(...scales);
  const maximumScale = Math.max(...scales);
  return {
    anisotropy: maximumScale / Math.max(0.00001, minimumScale),
    minimumScale,
    maximumScale,
  };
}

function projectedTextureDetail(frame, projection) {
  if (
    !projection ||
    !frame?.colorImage?.length ||
    frame.colorWidth < 3 ||
    frame.colorHeight < 3
  )
    return 0;
  const x = clamp(
    Math.round(projection.u * (frame.colorWidth - 1)),
    1,
    frame.colorWidth - 2,
  );
  const y = clamp(
    Math.round((1 - projection.v) * (frame.colorHeight - 1)),
    1,
    frame.colorHeight - 2,
  );
  const luminanceAt = (sampleX, sampleY) => {
    const offset =
      (sampleY * frame.colorWidth + sampleX) * frame.colorChannels;
    return (
      frame.colorImage[offset] * 0.2126 +
      frame.colorImage[offset + 1] * 0.7152 +
      frame.colorImage[offset + 2] * 0.0722
    );
  };
  const center = luminanceAt(x, y);
  if (center < 6 || center > 249) return 0;
  return (
    Math.abs(luminanceAt(x - 1, y) - center) +
    Math.abs(luminanceAt(x + 1, y) - center) +
    Math.abs(luminanceAt(x, y - 1) - center) +
    Math.abs(luminanceAt(x, y + 1) - center)
  ) / 2;
}

function buildAtlas(frames, precomputedCalibration = null) {
  const candidates = frames.filter(
    (frame) =>
      frame.colorImage?.length && frame.colorWidth && frame.colorHeight,
  );
  if (!candidates.length) return null;
  candidates.forEach((frame) => {
    // Recompute both metrics from the owned snapshot. Live capture used a
    // different four-neighbor scale, which made blurred frames look roughly
    // twice as sharp when compared with restored or worker-side frames.
    const detail = imageDetailMetrics(frame);
    frame.textureSharpness = detail.sharpness;
    frame.textureFocus = detail.focus;
    frame.textureQuality =
      detail.sharpness * Math.sqrt(Math.max(0.5, detail.focus));
    frame.textureColorStatistics = imageColorStatistics(frame);
  });
  const rankedQuality = candidates
    .map((frame) => frame.textureQuality)
    .sort((left, right) => left - right);
  const upperQuality =
    rankedQuality[Math.floor(rankedQuality.length * 0.75)] || 0;
  const qualityFloor = Math.max(10, upperQuality * 0.56);
  const lowQualityFrames = candidates.filter(
    (frame) => frame.textureQuality < qualityFloor,
  ).length;
  // A globally softer frame may still be the only camera that saw one end of
  // the scan. Removing it here turned otherwise measured walls and ceilings
  // into the constant gray fallback. Capture already bounds the atlas and
  // selects the best low-motion image from each section of the scan path, so
  // keep every retained view as a coverage fallback. Per-triangle scoring
  // below still prefers the sharpest valid view wherever cameras overlap.
  const images = candidates;
  const rankedSharpness = images
    .map((frame) => frame.textureSharpness)
    .sort((left, right) => left - right);
  const referenceSharpness =
    rankedSharpness[Math.floor(rankedSharpness.length / 2)] || 1;
  const referenceQuality =
    rankedQuality[Math.floor(rankedQuality.length / 2)] || 1;
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
  // Reuse the calibration that was applied to TSDF vertex colours when the
  // caller already computed it for this exact frame set. Keeping atlas and
  // fallback colours on one exposure solution removes a subtle seam at
  // triangles that switch between camera texture and fused colour.
  const calibrationByFrame = new Map();
  if (precomputedCalibration?.scales?.length)
    frames.forEach((frame, index) => {
      const scale = precomputedCalibration.scales[index];
      if (scale?.length === 3) calibrationByFrame.set(frame, scale);
    });
  const overlapCalibration = precomputedCalibration
    ? {
        scales: images.map((frame) => calibrationByFrame.get(frame) || null),
        pairCount: precomputedCalibration.pairCount || 0,
      }
    : overlapTextureColorScales(images);
  images.forEach((frame, tile) => {
    // A dark curtain and a white wall are different content, not evidence of
    // an exposure error. Without shared measured points, preserve the camera
    // color exactly, matching the uncalibrated fused-color fallback.
    const channelScales =
      calibrationByFrame.get(frame) ||
      overlapCalibration.scales[tile] ||
      [1, 1, 1];
    frame.textureChannelScales = channelScales;
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
    referenceQuality,
    lowQualityFrames,
    rejectedBlurryFrames: 0,
    textureQualityFloor: qualityFloor,
    photometricPairCount: overlapCalibration.pairCount,
    photometricNormalization: overlapCalibration.pairCount
      ? "overlap-correspondence-color-calibration"
      : "original-camera-colors",
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
    const color = texturePixel(frame, projection);
    if (!color) return;
    const [red, green, blue] = color;
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
    (underexposed / sampled) * 0.75 +
    (coloredHighlight / sampled) * 0.35
  );
}

export function closestProjectiveDepthAgreement(
  frame,
  projection,
  radiusLimit = 2,
) {
  if (!projection) return null;
  const center = gridIndex(frame, projection.u, projection.v);
  const centerX = center % frame.columns;
  const centerY = Math.floor(center / frame.columns);
  const centerDepth = frame.filteredDepth[center];
  const centerMeasured =
    !frame.measuredMask?.length || !!frame.measuredMask[center];
  // A real center measurement owns this camera ray. Searching neighboring
  // pixels for a numerically closer background depth can jump across a thin
  // shelf/window edge and smear that background texture through the
  // foreground object.
  if (centerDepth && centerMeasured)
    return {
      difference: Math.abs(centerDepth - projection.depth),
      depth: centerDepth,
      radius: 0,
      support: 1,
    };
  const candidates = [];
  for (let offsetY = -radiusLimit; offsetY <= radiusLimit; offsetY++)
    for (let offsetX = -radiusLimit; offsetX <= radiusLimit; offsetX++) {
      const radius = Math.abs(offsetX) + Math.abs(offsetY);
      if (!radius || radius > radiusLimit) continue;
      const x = centerX + offsetX;
      const y = centerY + offsetY;
      if (x < 0 || y < 0 || x >= frame.columns || y >= frame.rows) continue;
      const neighborIndex = y * frame.columns + x;
      if (frame.measuredMask?.length && !frame.measuredMask[neighborIndex])
        continue;
      const measured = frame.filteredDepth[neighborIndex];
      if (!measured) continue;
      candidates.push({
        difference: Math.abs(measured - projection.depth),
        depth: measured,
        radius,
      });
    }
  if (!candidates.length) return null;
  candidates.sort((left, right) => left.difference - right.difference);
  const closest = candidates[0];
  const agreement = Math.max(0.05, closest.depth * 0.025);
  const support = candidates.filter(
    (candidate) => Math.abs(candidate.depth - closest.depth) <= agreement,
  ).length;
  // Recover a missing center only from a small local cluster, never one
  // isolated neighbor from the other side of a depth discontinuity.
  return support >= 2 ? { ...closest, support } : null;
}

export function texturedMesh(mesh, frames, precomputedCalibration = null) {
  const atlas = buildAtlas(frames, precomputedCalibration);
  const sharedNormals = computeNormals(mesh);
  if (!atlas) return { ...mesh, normals: sharedNormals, textureCoverage: 0 };
  const textureCandidateRejections = {
    stretched: 0,
    grazing: 0,
    softWhenClearAvailable: 0,
  };
  // Project the surface we will actually display, not its pre-smoothing
  // positions. Old UVs stretched image edges when the geometry moved and
  // adjacent cameras then disagreed about where the same feature belonged.
  const projectionPositions = mesh.positions;
  const textureProjectionMode = "final-mesh-positions";
  atlas.frames.forEach((frame, textureId) => { frame.textureId = textureId; });
  const records = [];
  const edgeOwners = new Map();
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]];
    const triangleProjectionPoints = triangle.map((vertex) => [
      projectionPositions[vertex * 3],
      projectionPositions[vertex * 3 + 1],
      projectionPositions[vertex * 3 + 2],
    ]);
    const center = triangle.reduce((value, vertex) => ({
      x: value.x + projectionPositions[vertex * 3] / 3,
      y: value.y + projectionPositions[vertex * 3 + 1] / 3,
      z: value.z + projectionPositions[vertex * 3 + 2] / 3,
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
        projectionPositions[vertex * 3],
        projectionPositions[vertex * 3 + 1],
        projectionPositions[vertex * 3 + 2],
      ));
      if (colorProjections.some((value) =>
        !value || value.u < 0.01 || value.v < 0.01 || value.u > 0.99 || value.v > 0.99)) return;
      const projectionStretch = textureProjectionStretch(
        triangleProjectionPoints,
        colorProjections,
        frame.colorWidth,
        frame.colorHeight,
      );
      if (!projectionStretch || projectionStretch.anisotropy > 4.2) {
        textureCandidateRejections.stretched++;
        return;
      }
      const vertexDepthProjections = triangle.map((vertex) => projectWorld(
        frame,
        projectionPositions[vertex * 3],
        projectionPositions[vertex * 3 + 1],
        projectionPositions[vertex * 3 + 2],
      ));
      if (vertexDepthProjections.some((value) =>
        !value || value.u < 0.01 || value.v < 0.01 || value.u > 0.99 || value.v > 0.99)) return;
      // Visibility belongs to the depth camera/grid. Color UVs are only used
      // after the surface has passed that independent occlusion check. Check
      // every corner as well as the center: a center-only match can stretch a
      // foreground texture over a triangle whose corners lie behind it.
      const centerAgreement = closestProjectiveDepthAgreement(
        frame,
        depthProjection,
        2,
      );
      if (
        !centerAgreement ||
        centerAgreement.difference >
          Math.max(0.055, centerAgreement.depth * 0.03)
      )
        return;
      const vertexAgreements = vertexDepthProjections.map((projection) =>
        closestProjectiveDepthAgreement(frame, projection, 2),
      );
      if (
        vertexAgreements.some(
          (agreement) =>
            !agreement ||
            agreement.difference >
              Math.max(0.065, agreement.depth * 0.035),
        )
      )
        return;
      const allDepthAgreements = [centerAgreement, ...vertexAgreements];
      const worstAgreement = Math.max(
        ...allDepthAgreements.map((agreement) => agreement.difference),
      );
      const farthestRecovery = Math.max(
        ...allDepthAgreements.map((agreement) => agreement.radius),
      );
      // Score color visibility from the camera that actually captured the
      // texture. A stable later frame may have refreshed this image while its
      // original depth pose remains unchanged for geometry/occlusion checks.
      const textureTransform =
        frame.viewTransformMatrix?.length === 16
          ? frame.viewTransformMatrix
          : frame.transformMatrix;
      const dx = textureTransform[12] - center.x;
      const dy = textureTransform[13] - center.y;
      const dz = textureTransform[14] - center.z;
      const distance = Math.hypot(dx, dy, dz) || 1;
      const faceFacing = Math.abs(
        (faceNormal.x * dx + faceNormal.y * dy + faceNormal.z * dz) /
          distance,
      );
      if (faceFacing < 0.22) {
        textureCandidateRejections.grazing++;
        return;
      }
      const facing = Math.abs((normal.x * dx + normal.y * dy + normal.z * dz) / distance);
      const sharpness = clamp(
        frame.textureSharpness / atlas.referenceSharpness,
        0.35,
        1.65,
      );
      const quality = clamp(
        frame.textureQuality / atlas.referenceQuality,
        0.2,
        1.8,
      );
      const motionPenalty = clamp(
        (Number(frame.textureLinearSpeed ?? frame.linearSpeed) || 0) / 0.75 +
          (Number(frame.textureAngularSpeed ?? frame.angularSpeed) || 0) / 0.8,
        0,
        1.5,
      );
      const texturePenalty = projectedTexturePenalty(frame, [
        colorProjection,
        ...colorProjections,
      ]);
      // A camera patch dominated by clipped glare or black sensor borders is
      // not a usable texture source. Leave this triangle on the fused color
      // fallback rather than baking a white/discolored streak into the atlas.
      if (texturePenalty > 0.58) return;
      const frameClippingPenalty = clamp(
        Number(frame.colorClippedRatio) || 0,
        0,
        0.8,
      );
      const localSharpness = clamp(
        projectedTextureDetail(frame, colorProjection) /
          Math.max(1, atlas.referenceSharpness),
        0,
        1.8,
      );
      candidates.push({
        frame,
        projections: colorProjections,
        recoveredTexture: farthestRecovery > 1,
        qualityPreferred:
          frame.textureQuality >= atlas.textureQualityFloor &&
          frameClippingPenalty <= 0.2,
        score:
          facing * 1.45 +
          Math.min(2, 1 / distance) * 0.65 +
          sharpness * 0.28 +
          quality * 1.05 +
          localSharpness * 0.55 -
          worstAgreement * 5 -
          Math.max(0, farthestRecovery - 1) * 0.18 -
          motionPenalty * 0.68 -
          texturePenalty * 1.05 -
          frameClippingPenalty * 0.8,
      });
    });
    // Keep softer frames as a coverage fallback, but never let camera
    // distance or a patch-coherence bonus choose one over a clear valid view
    // of the same triangle. This is the distinction the v33 keep-all atlas
    // was missing: availability is not the same as preference.
    const clearCandidates = candidates.filter(
      (candidate) => candidate.qualityPreferred,
    );
    if (clearCandidates.length)
      textureCandidateRejections.softWhenClearAvailable +=
        candidates.length - clearCandidates.length;
    const viableCandidates = (clearCandidates.length
      ? clearCandidates
      : candidates
    )
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);
    const record = {
      triangle,
      faceNormal,
      candidates: viableCandidates,
      selected: 0,
      neighbors: [],
      seams: [],
    };
    const recordIndex = records.length;
    records.push(record);
    triangle.forEach((vertex, corner) => {
      const nextCorner = (corner + 1) % 3;
      const next = triangle[nextCorner];
      const key = vertex < next ? `${vertex},${next}` : `${next},${vertex}`;
      const corners = vertex < next ? [corner, nextCorner] : [nextCorner, corner];
      const owner = edgeOwners.get(key);
      if (!owner) {
        edgeOwners.set(key, { recordIndex, corners });
        return;
      }
      const neighbor = records[owner.recordIndex];
      const alignment = record.faceNormal.x * neighbor.faceNormal.x +
        record.faceNormal.y * neighbor.faceNormal.y + record.faceNormal.z * neighbor.faceNormal.z;
      // No voting across sharp folds, opposite sheets, or a lone shared vertex.
      if (alignment < 0.75) return;
      record.neighbors.push(owner.recordIndex);
      neighbor.neighbors.push(recordIndex);
      const seam = {
        left: owner.recordIndex, right: recordIndex,
        columns: record.candidates.length,
        differences: new Float32Array(neighbor.candidates.length * record.candidates.length),
      };
      if (seam.differences.length) {
        // Sample each candidate once per edge, not once per candidate pair.
        // This keeps the seam pass bounded on phone-sized meshes.
        const leftColors = neighbor.candidates.map((candidate) => textureEdgeColors(candidate, owner.corners));
        const rightColors = record.candidates.map((candidate) => textureEdgeColors(candidate, corners));
        neighbor.candidates.forEach((left, leftIndex) => {
          record.candidates.forEach((right, rightIndex) => {
            seam.differences[leftIndex * seam.columns + rightIndex] =
              left.frame === right.frame ? 0 : edgeColorDifference(leftColors[leftIndex], rightColors[rightIndex]);
          });
        });
      }
      record.seams.push(seam);
      neighbor.seams.push(seam);
    });
  }
  edgeOwners.clear();
  const coherentCandidateBonus = (
    record,
    candidate,
    candidateIndex,
    sameCameraWeight,
    colorWeight,
  ) => {
    let sameCameraVotes = 0;
    let colorDifference = 0;
    record.seams.forEach((seam) => {
      const isLeft = records[seam.left] === record;
      const neighbor = records[isLeft ? seam.right : seam.left];
      const neighborCandidate = neighbor.candidates[neighbor.selected];
      if (!neighborCandidate) return;
      if (neighborCandidate.frame.textureId === candidate.frame.textureId)
        sameCameraVotes++;
      const row = isLeft ? candidateIndex : neighbor.selected;
      const column = isLeft ? neighbor.selected : candidateIndex;
      colorDifference += seam.differences[row * seam.columns + column];
    });
    return sameCameraVotes * sameCameraWeight - colorDifference * colorWeight;
  };
  // Neighboring triangles prefer the same one of their valid top-four
  // camera views. Four passes remove most per-triangle exposure seams without
  // ever selecting a frame that failed the depth/visibility checks.
  for (let pass = 0; pass < 4; pass++)
    records.forEach((record) => {
      if (record.candidates.length < 2) return;
      let selected = 0;
      let selectedScore = -Infinity;
      record.candidates.forEach((candidate, candidateIndex) => {
        const score =
          candidate.score +
          coherentCandidateBonus(record, candidate, candidateIndex, 0.68, 1.5);
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
      current.neighbors.forEach((neighborIndex) => {
        if (visitedRecords[neighborIndex]) return;
        const neighbor = records[neighborIndex];
        const alignment = Math.abs(
          current.faceNormal.x * neighbor.faceNormal.x +
            current.faceNormal.y * neighbor.faceNormal.y +
            current.faceNormal.z * neighbor.faceNormal.z,
        );
        if (alignment < 0.9) return;
        visitedRecords[neighborIndex] = 1;
        queue.push(neighborIndex);
      });
    }
    if (component.length < 4) continue;
    texturePatchCount++;
    const frameCoverage = new Map();
    component.forEach((recordIndex) => {
      const record = records[recordIndex];
      const bestLocalScore = record.candidates[0]?.score ?? -Infinity;
      record.candidates.forEach((candidate) => {
        if (candidate.score < bestLocalScore - 0.72) return;
        const textureId = candidate.frame.textureId;
        frameCoverage.set(textureId, (frameCoverage.get(textureId) || 0) + 1);
      });
    });
    component.forEach((recordIndex) => {
      const record = records[recordIndex];
      if (record.candidates.length < 2) return;
      const bestLocalScore = record.candidates[0].score;
      let selected = record.selected;
      let selectedScore = -Infinity;
      record.candidates.forEach((candidate, candidateIndex) => {
        if (candidate.score < bestLocalScore - 0.72) return;
        const coverage =
          (frameCoverage.get(candidate.frame.textureId) || 0) /
          component.length;
        const score = candidate.score + Math.min(1, coverage) * 0.72;
        if (score > selectedScore) {
          selected = candidateIndex;
          selectedScore = score;
        }
      });
      record.selected = selected;
    });
  }
  // Patch selection can leave a few isolated triangles on a different valid
  // camera. Two final local passes remove those visible stripes while keeping
  // every choice inside the original depth-tested candidate set.
  for (let pass = 0; pass < 2; pass++)
    records.forEach((record) => {
      if (record.candidates.length < 2) return;
      let selected = record.selected;
      let selectedScore = -Infinity;
      record.candidates.forEach((candidate, candidateIndex) => {
        const score =
          candidate.score +
          coherentCandidateBonus(record, candidate, candidateIndex, 0.82, 1.8);
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
  let recoveredTextureTriangles = 0;
  let softTextureFallbackTriangles = 0;
  // Where a texture-valid triangle meets a color-only triangle, carry its
  // measured corner color into the fallback. Keep the best observation, never
  // average different camera images or propagate across gaps/folds.
  const fallbackColors = new Uint8Array(mesh.colors);
  const boundaryScores = new Float32Array(mesh.positions.length / 3).fill(-Infinity);
  const fallbackVertices = new Uint8Array(boundaryScores.length);
  records.forEach((record) => {
    if (!record.candidates.length)
      record.triangle.forEach((vertex) => { fallbackVertices[vertex] = 1; });
  });
  records.forEach((record) => {
    const best = record.candidates[record.selected];
    if (!best) return;
    record.triangle.forEach((vertex, corner) => {
      if (!fallbackVertices[vertex] || best.score <= boundaryScores[vertex]) return;
      if (!record.neighbors.some((index) =>
        !records[index].candidates.length && records[index].triangle.includes(vertex))) return;
      const color = calibratedTexturePixel(best.frame, best.projections[corner]);
      if (!color) return;
      boundaryScores[vertex] = best.score;
      fallbackColors.set(color.map(linearByte), vertex * 3);
    });
  });
  records.forEach((record) => {
    const triangle = record.triangle;
    const best = record.candidates[record.selected] || null;
    if (best) texturedTriangles++;
    if (best?.recoveredTexture) recoveredTextureTriangles++;
    if (best && !best.qualityPreferred) softTextureFallbackTriangles++;
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
        colors.push(fallbackColors[vertex * 3], fallbackColors[vertex * 3 + 1], fallbackColors[vertex * 3 + 2]);
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
    recoveredTextureTriangles,
    softTextureFallbackTriangles,
    textureProjectionMode,
    fallbackBoundaryVertices: boundaryScores.reduce((count, score) => count + (Number.isFinite(score) ? 1 : 0), 0),
    texturePatchCount,
    textureCalibrationPairs: atlas.photometricPairCount,
    photometricNormalization: atlas.photometricNormalization,
    rejectedBlurryTextureFrames: atlas.rejectedBlurryFrames,
    lowQualityTextureFrames: atlas.lowQualityFrames,
    textureQualityFloor: atlas.textureQualityFloor,
    rejectedStretchedTextureCandidates: textureCandidateRejections.stretched,
    rejectedGrazingTextureCandidates: textureCandidateRejections.grazing,
    rejectedSoftTextureCandidates:
      textureCandidateRejections.softWhenClearAvailable,
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
    .map(({ frame, frameId }) => prepareFrame(frame, frameId, options))
    .filter(Boolean);
  const alignment = {};
  const initialOverlap = {};
  let surfaceConsistencyFailure = null;
  let overlapping = validateFrameOverlap(prepared, initialOverlap);
  if (options.poseRefinement === "validated" && overlapping.length >= 2) {
    const refinement = refineFramePoses(overlapping, {
      window: options.poseRefinementWindow || 3,
      samples: options.poseRefinementSamples || 420,
      maxTranslation: options.poseRefinementMaxTranslation || 0.085,
      maxRotation: options.poseRefinementMaxRotation || 0.095,
      maxResidual: options.poseRefinementMaxResidual || 0.055,
    });
    const refinedOverlap = {};
    overlapping = validateFrameOverlap(refinement.frames, refinedOverlap);
    Object.assign(alignment, refinedOverlap);
    alignment.initial = initialOverlap;
    alignment.poseCorrectionApplied = refinement.diagnostics.corrected > 0;
    alignment.poseRefinement = "validated-rigid-depth";
    alignment.poseRefinementDiagnostics = refinement.diagnostics;
  } else {
    Object.assign(alignment, initialOverlap);
    alignment.poseRefinement =
      options.poseRefinement === "native-tracking"
        ? "native-webxr-tracking"
        : "disabled-until-independently-validated";
  }
  if (options.completionMode === "surface" && overlapping.length >= 3) {
    const strictDiagnostics = {};
    const preferCoherentCore =
      !!options.requireCoherentSurfaceCore ||
      !!options.preferCoherentSurfaceCore;
    const consistent = validateFrameOverlap(overlapping, strictDiagnostics, {
      minimumAgreeing: 16,
      minimumAgreementRatio: 0.5,
      minimumDirectionalSamples: 10,
      minimumDirectionalAgreementRatio: 0.38,
      maximumMedianError: 0.045,
      maximumUpperError: 0.09,
      requireBidirectional: preferCoherentCore,
      selectionMode: preferCoherentCore
        ? "anchor-core"
        : "connected-component",
    });
    const enoughStrictlyConsistentFrames =
      consistent.length >= 3 &&
      consistent.length >= Math.ceil(overlapping.length * 0.4);
    const consistentSet = new Set(consistent);
    const consistentIndices = overlapping
      .map((frame, index) => (consistentSet.has(frame) ? index : -1))
      .filter((index) => index >= 0);
    const selectedRatio = consistent.length / Math.max(1, overlapping.length);
    const temporalSpanRatio =
      overlapping.length <= 1 || !consistentIndices.length
        ? consistentIndices.length
        : (consistentIndices[consistentIndices.length - 1] -
            consistentIndices[0]) /
          (overlapping.length - 1);
    let longestRejectedRun = 0;
    let rejectedRun = 0;
    overlapping.forEach((frame) => {
      if (consistentSet.has(frame)) rejectedRun = 0;
      else {
        rejectedRun++;
        longestRejectedRun = Math.max(longestRejectedRun, rejectedRun);
      }
    });
    const maximumPreferredRejectedRun = Math.max(
      2,
      Math.ceil(overlapping.length * 0.12),
    );
    // An anchor core proves local agreement, not full-scan coverage. Only use
    // the preferred (non-required) core when it represents almost the entire
    // connected capture path. Otherwise preserve the ordinary connected set
    // and let TSDF/local-layer consensus reject inconsistent measurements.
    const preferredCoveragePreserved =
      selectedRatio >= 0.8 &&
      temporalSpanRatio >= 0.9 &&
      longestRejectedRun <= maximumPreferredRejectedRun;
    const preferredOnly =
      !!options.preferCoherentSurfaceCore &&
      !options.requireCoherentSurfaceCore;
    const enoughConsistentFrames =
      enoughStrictlyConsistentFrames &&
      (!preferredOnly || preferredCoveragePreserved);
    alignment.surfaceConsistency = {
      ...strictDiagnostics,
      applied: enoughConsistentFrames,
      fallbackToGeneralOverlap:
        !enoughConsistentFrames && !options.requireCoherentSurfaceCore,
      preferredWithoutBlocking:
        !!options.preferCoherentSurfaceCore &&
        !options.requireCoherentSurfaceCore,
      preferredCoveragePreserved,
      selectedRatio,
      temporalSpanRatio,
      longestRejectedRun,
      maximumPreferredRejectedRun,
      rejectedAsIncoherent:
        !enoughConsistentFrames && !!options.requireCoherentSurfaceCore,
    };
    if (enoughConsistentFrames) overlapping = consistent;
    else if (options.requireCoherentSurfaceCore) {
      surfaceConsistencyFailure = {
        consistentFrames: consistent.length,
        candidateFrames: overlapping.length,
      };
      overlapping = [];
    }
  } else if (
    options.completionMode === "surface" &&
    options.requireCoherentSurfaceCore
  ) {
    surfaceConsistencyFailure = {
      consistentFrames: overlapping.length,
      candidateFrames: prepared.length,
    };
    overlapping = [];
  }
  const textureFramesBeforeSelection = overlapping.reduce(
    (count, frame) => count + (frame.colorImage?.length ? 1 : 0),
    0,
  );
  const selected = selectFusionKeyframes(
    overlapping,
    options.maxKeyframes ||
      (options.completionMode === "surface" ? 48 : 40),
  );
  alignment.textureFramesBeforeSelection = textureFramesBeforeSelection;
  alignment.textureFramesAfterSelection = selected.reduce(
    (count, frame) => count + (frame.colorImage?.length ? 1 : 0),
    0,
  );
  const localLayerConsensus =
    options.completionMode === "surface"
      ? suppressMinorityFrontLayers(selected)
      : { frames: selected, diagnostics: null };
  const usable = localLayerConsensus.frames;
  if (localLayerConsensus.diagnostics)
    alignment.localLayerConsensus = localLayerConsensus.diagnostics;
  const stages = {
    algorithmVersion: 35,
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
    layerFilteredDepthSamples: usable.reduce(
      (sum, frame) => sum + frame.filteredCount,
      0,
    ),
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
    floorOutlierSamples: prepared.reduce(
      (sum, frame) => sum + (frame.floorOutlierCount || 0),
      0,
    ),
    floorOutlierTolerance: Number.isFinite(Number(options.floorOutlierTolerance))
      ? Number(options.floorOutlierTolerance)
      : null,
    roundTrip: prepared.map((frame) => frameRoundTripDiagnostics(frame)),
    alignment,
    fusedFrameIds: usable.map((frame) => frame.frameId),
  };
  stages.floorOutlierRatio =
    stages.floorOutlierSamples / Math.max(1, stages.inputDepthSamples);
  const failure = (reason, details = {}) => ({
    mesh: null,
    observations: buildAcceptedObservations(usable.length ? usable : prepared),
    diagnostics: { ...stages, ...details, reason },
  });
  if (ambiguousLegacyKeyframes && !prepared.length)
    return failure(
      "This older diagnostic capture used ambiguous depth-buffer coordinates. Record a fresh scan with the repaired view-aligned geometry format.",
    );
  if (surfaceConsistencyFailure)
    return failure(
      "The captured views do not agree on one stable surface. Return to the last confirmed area, hold still, and repeat the wall with overlapping sideways views.",
      {
        surfaceConsistencyFailure,
        rejectedUnsafeFusion: true,
      },
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
  // Calibrate overlapping camera exposures before color fusion as well as
  // atlas construction. Otherwise triangles that fall back to fused vertex
  // colors can still show the raw exposure jump that the atlas corrected.
  const colorCalibration =
    options.colorCalibration === false
      ? { scales: [], pairCount: 0 }
      : overlapTextureColorScales(usable);
  if (colorCalibration?.scales?.length)
    usable.forEach((frame, index) => {
      if (colorCalibration.scales[index])
        frame.fusionColorScales = colorCalibration.scales[index];
    });
  stages.colorCalibrationPairs = colorCalibration?.pairCount || 0;
  const bounds = sampleBounds(samples);
  let volume = makeVolume(bounds, options);
  const volumeVoxelSize = volume.voxelSize;
  const volumeDimensions = volume.dimensions;
  const volumeCells = volume.values.length;
  report?.("fusing", 16, { voxelSize: volume.voxelSize, dimensions: volume.dimensions });
  const confirmedVoxels = integrateProjective(volume, usable, report);
  stages.robustFusion = {
    robustlyDownweightedSamples: volume.robustlyDownweightedSamples,
    robustlyRejectedSamples: volume.robustlyRejectedSamples,
    motionDownweightedSamples: volume.motionDownweightedSamples,
    measuredFusionSamples: volume.measuredFusionSamples,
    repairedFusionSamples: volume.repairedFusionSamples,
  };
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
      ? clamp(volume.voxelSize * 7.5, 0.14, 0.2)
      : clamp(volume.voxelSize * 9, 0.3, 0.45),
    maxPlanarity: surfaceCompletion
      ? Math.max(0.028, volume.voxelSize * 0.9)
      : Math.max(0.04, volume.voxelSize * 1.2),
  });
  stages.filledHoleCount = surface.filledHoleCount;
  stages.filledHoleTriangles = surface.filledHoleTriangles;
  const bridgeDiagnostics = meshBridgeDiagnostics(surface, volumeVoxelSize, {
    maxEdge: options.maxBridgeEdge,
    protectedTrailingTriangles: surface.filledHoleTriangles,
  });
  stages.meshBridgeDiagnostics = bridgeDiagnostics;
  if (options.pruneUnsupportedBridges) {
    surface = pruneUnsupportedMeshBridges(surface, volumeVoxelSize, {
      maxEdge: options.maxBridgeEdge,
      protectedTrailingTriangles: surface.filledHoleTriangles,
    });
    stages.removedBridgeTriangles = surface.removedBridgeTriangles || 0;
    stages.trianglesAfterBridgePrune = surface.indices.length / 3;
  }
  const highlyFragmented = meshFragmentationIsUnacceptable(surface);
  let wallStructure = meshWallStructureDiagnostics(surface);
  stages.wallStructure = wallStructure;
  stages.initialWallStructure = wallStructure;
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
  if (stages.floorOutlierRatio >= 0.01) {
    measuredSurfaceWarnings.push({
      code: "floor-outliers",
      message:
        `${Math.round(stages.floorOutlierRatio * 100)}% of depth samples were below the detected floor and were excluded. Recheck the floor anchor if lower surfaces still look warped.`,
    });
  }
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
  if (
    !stages.rectangularRoomModelCompatible &&
    !surfaceCompletion
  )
    return failure("The measured views create curled or overlapping wall layers. Return to a confirmed area, hold still, and repeat the affected wall from overlapping sideways positions.", {
      ...stages,
      confirmedVoxels,
      voxelSize: volumeVoxelSize,
      fusedSurfaceArea: surface.surfaceArea,
      fusedTriangles: surface.indices.length / 3,
      rejectedUnsafeFusion: true,
    });
  if (
    !stages.rectangularRoomModelCompatible &&
    !options.rejectStructurallyInvalidSurface
  )
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
  if (bridgeDiagnostics.longEdgeRatio >= 0.008) {
    measuredSurfaceWarnings.push({
      code: "unsupported-bridges",
      message:
        "Some mesh triangles crossed a large unsupported depth gap and were removed. The affected area remains open until it is scanned again with overlapping views.",
    });
  }
  stages.measuredSurfaceWarnings = measuredSurfaceWarnings;
  stages.measuredReviewWarning = measuredSurfaceWarnings.length
    ? {
        message:
          "The measured mesh was reconstructed, but automatic review found possible gaps or alignment issues. You can inspect and finish it without generating replacement walls.",
        issues: measuredSurfaceWarnings,
      }
    : null;
  const measuredPositions = surface.positions;
  if (!surfaceCompletion && stages.rectangularRoomModelCompatible)
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
  // Smooth first, then return supported wall vertices to their measured plane.
  // The previous order allowed the smoothing pass to reintroduce bowed trim
  // and wall lines immediately after they had been straightened.
  if (surfaceCompletion && measuredSurfaceQuality?.assessed)
    surface = stabilizeMeasuredWallSectors(
      surface,
      measuredSurfaceQuality.walls,
      volumeVoxelSize,
    );
  if (surfaceCompletion)
    surface = stabilizeMeasuredHorizontalSurfaces(
      surface,
      volumeVoxelSize,
      5,
    );
  const constrained = constrainSurfaceDeformation(
    { ...surface, positions: measuredPositions },
    surface.positions,
  );
  surface = { ...surface, positions: constrained.positions };
  stages.revertedDeformationVertices = constrained.revertedVertices;
  wallStructure = meshWallStructureDiagnostics(surface);
  stages.wallStructure = wallStructure;
  stages.postStabilizationWallStructure = wallStructure;
  stages.rectangularRoomModelCompatible =
    !meshOutsideRectangularRoomModel(wallStructure);
  if (
    surfaceCompletion &&
    options.rejectStructurallyInvalidSurface &&
    !stages.rectangularRoomModelCompatible
  )
    return failure(
      "The measured surface is still curled or overlapping after safe planar correction. Return to a confirmed area, hold still, and repeat the affected section.",
      {
        confirmedVoxels,
        voxelSize: volumeVoxelSize,
        fusedSurfaceArea: surface.surfaceArea,
        fusedTriangles: surface.indices.length / 3,
        rejectedUnsafeFusion: true,
      },
    );
  report?.("texturing", 88);
  const textured = texturedMesh(surface, usable, colorCalibration);
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
      recoveredTextureTriangles: mesh.recoveredTextureTriangles || 0,
      softTextureFallbackTriangles:
        mesh.softTextureFallbackTriangles || 0,
      textureProjectionMode: mesh.textureProjectionMode || "mesh-positions",
      fallbackBoundaryVertices: mesh.fallbackBoundaryVertices || 0,
      texturePatchCount: mesh.texturePatchCount || 0,
      textureCalibrationPairs: mesh.textureCalibrationPairs || 0,
      photometricNormalization: mesh.photometricNormalization || "none",
      rejectedBlurryTextureFrames:
        mesh.rejectedBlurryTextureFrames || 0,
      lowQualityTextureFrames: mesh.lowQualityTextureFrames || 0,
      textureQualityFloor: mesh.textureQualityFloor || 0,
      rejectedSoftTextureCandidates:
        mesh.rejectedSoftTextureCandidates || 0,
    },
  };
}
