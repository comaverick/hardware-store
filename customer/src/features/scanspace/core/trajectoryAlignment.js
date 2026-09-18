// Joint point-to-plane registration. All overlapping captures constrain one
// solve, with native-pose and trajectory priors for weakly observed directions.
// A depth/photo pair from one capture is one unknown, never two independent votes.
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const sub = (a, b) => a.map((value, i) => value - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => Math.hypot(...v);
const point = (frame, index) => Array.from(frame.positions.subarray(index * 3, index * 3 + 3));
function normalsFor(frame) {
  const normals = new Float32Array(frame.positions.length),
    {
      columns: w,
      rows: h
    } = frame;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x,
      indices = [i, i - 1, i + 1, i - w, i + w];
    if (indices.some(k => !frame.measuredMask[k])) continue;
    const depths = indices.map(k => frame.filteredDepth[k]);
    if (Math.max(...depths) - Math.min(...depths) > Math.max(0.09, depths[0] * 0.045)) continue;
    const normal = cross(sub(point(frame, i + 1), point(frame, i - 1)), sub(point(frame, i + w), point(frame, i - w)));
    const length = norm(normal);
    if (length > 1e-9) normals.set(normal.map(v => v / length), i * 3);
  }
  return normals;
}
function solvePositive(matrix, rhs, n) {
  const a = matrix.slice(),
    b = rhs.slice();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * n + j];
      for (let k = 0; k < j; k++) sum -= a[i * n + k] * a[j * n + k];
      if (i === j) {
        if (!(sum > 1e-12)) return null;
        a[i * n + j] = Math.sqrt(sum);
      } else a[i * n + j] = sum / a[j * n + j];
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) b[i] -= a[i * n + j] * b[j];
    b[i] /= a[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) b[i] -= a[j * n + i] * b[j];
    b[i] /= a[i * n + i];
  }
  return b;
}
function rotationDelta(vector, pivot) {
  const angle = norm(vector.slice(0, 3));
  const factor = angle > 1e-12 ? Math.sin(angle / 2) / angle : 0.5;
  const [x, y, z] = vector.slice(0, 3).map(v => v * factor),
    w = Math.cos(angle / 2);
  const rotation = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  return {
    quaternion: [w, x, y, z],
    rotation,
    translation: pivot.map((v, i) => v + vector[i + 3] - dot(rotation.slice(i * 3, i * 3 + 3), pivot))
  };
}
export function refineJointTrajectory(input, helpers, options = {}) {
  const diagnostics = {
    mode: 'joint-point-to-plane',
    accepted: false,
    captures: 0,
    pairs: 0,
    heldOutSamples: 0,
    iterations: 0,
    beforeMeters: 0,
    afterMeters: 0,
    maxTranslationMeters: 0,
    maxRotationRadians: 0
  };
  const key = f => `${f.timestamp || 0}:${Array.from(f.transformMatrix).map(v => v.toFixed(6)).join(',')}`;
  const groups = new Map();
  input.forEach(f => {
    if (!groups.has(key(f))) groups.set(key(f), f);
  });
  const original = [...groups.values()].sort((a, b) => a.timestamp - b.timestamp),
    n = original.length,
    variables = n * 6;
  diagnostics.captures = n;
  if (n < 4) return {
    frames: input,
    diagnostics
  };
  const pivot = [0, 1, 2].map(axis => original.reduce((sum, f) => sum + f.camera[axis], 0) / n);
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const distance = norm(sub(Array.from(original[i].camera), Array.from(original[j].camera)));
    if (distance < 0.036 || distance > 1.7) continue;
    const a = original[i].transformMatrix,
      b = original[j].transformMatrix;
    if (a[8] * b[8] + a[9] * b[9] + a[10] * b[10] < 0.2) continue;
    pairs.push([i, j]);
  }
  let frames = original,
    values = new Float64Array(variables);
  const normals = original.map(normalsFor);
  function correspondences(current, iterations = 0) {
    const result = [];
    for (const [i, j] of pairs) {
      for (const [a, b] of [[i, j], [j, i]]) {
        const source = current[a],
          target = current[b],
          records = [];
        const stride = Math.max(3, Math.ceil(source.filteredDepth.length / (options.samples || 180)));
        for (let index = 1 + iterations % 3; index < source.filteredDepth.length; index += stride) {
          if (!source.measuredMask[index] || !normals[a].subarray(index * 3, index * 3 + 3).some(v => v)) continue;
          const p = point(source, index),
            projection = helpers.project(target, ...p);
          if (!projection) continue;
          const ti = Math.floor(projection.v * target.rows) * target.columns + Math.floor(projection.u * target.columns);
          if (!target.measuredMask[ti]) continue;
          const measured = helpers.sample(target, projection.u, projection.v);
          if (!measured || Math.abs(measured - projection.depth) > 0.14) continue;
          const q = helpers.unproject(target, projection.u, projection.v, measured);
          if (!q) continue;
          // Normals follow the current rigid pose, not the original world axes.
          const rawNormal = Array.from(normals[b].subarray(ti * 3, ti * 3 + 3));
          if (norm(rawNormal) < 0.5) continue;
          const native = original[b].transformMatrix,
            m = target.transformMatrix;
          const local = [0, 1, 2].map(axis => native[axis * 4] * rawNormal[0] + native[axis * 4 + 1] * rawNormal[1] + native[axis * 4 + 2] * rawNormal[2]);
          const normal = [0, 1, 2].map(axis => m[axis] * local[0] + m[axis + 4] * local[1] + m[axis + 8] * local[2]);
          const residual = dot(sub(p, q), normal);
          if (Math.abs(residual) > 0.12) continue;
          records.push({
            a,
            b,
            p,
            q,
            normal,
            residual,
            index
          });
        }
        if (records.length >= 18) result.push(...records.map(record => ({
          ...record,
          weight: 1 / records.length
        })));
      }
    }
    return result;
  }
  const baseline = correspondences(original),
    heldOut = baseline.filter((_, i) => i % 4 === 0);
  diagnostics.pairs = new Set(baseline.map(r => `${Math.min(r.a, r.b)}:${Math.max(r.a, r.b)}`)).size;
  diagnostics.heldOutSamples = heldOut.length;
  if (heldOut.length < 100 || diagnostics.pairs < n) return {
    frames: input,
    diagnostics
  };
  const heldOutKeys = new Set(heldOut.map(r => `${r.a}:${r.b}:${r.index}`));
  const cost = candidate => {
    let total = 0,
      weight = 0;
    for (const r of heldOut) {
      const pa = helpers.transform(r.p, rotationDelta(Array.from(candidate.subarray(r.a * 6, r.a * 6 + 6)), pivot));
      const pb = helpers.transform(r.q, rotationDelta(Array.from(candidate.subarray(r.b * 6, r.b * 6 + 6)), pivot));
      const residual = Math.abs(dot(sub(pa, pb), r.normal));
      total += Math.min(0.08, residual) ** 2 * r.weight;
      weight += r.weight;
    }
    return Math.sqrt(total / Math.max(1e-8, weight));
  };
  diagnostics.beforeMeters = cost(values);
  for (let iteration = 0; iteration < (options.iterations || 5); iteration++) {
    const equations = new Float64Array(variables * variables),
      rhs = new Float64Array(variables);
    const add = (ids, jacobian, residual, weight) => {
      for (let i = 0; i < ids.length; i++) {
        rhs[ids[i]] -= jacobian[i] * residual * weight;
        for (let j = 0; j < ids.length; j++) equations[ids[i] * variables + ids[j]] += jacobian[i] * jacobian[j] * weight;
      }
    };
    for (const r of correspondences(frames, iteration)) {
      if (heldOutKeys.has(`${r.a}:${r.b}:${r.index}`)) continue;
      const first = [...cross(sub(r.p, pivot), r.normal), ...r.normal];
      const second = [...cross(sub(r.q, pivot), r.normal), ...r.normal].map(v => -v);
      const weight = r.weight * Math.min(1, 0.025 / Math.max(0.0001, Math.abs(r.residual)));
      add([...first.map((_, k) => r.a * 6 + k), ...second.map((_, k) => r.b * 6 + k)], [...first, ...second], r.residual, weight);
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < 6; k++) {
      add([i * 6 + k], [1], values[i * 6 + k], k < 3 ? 4 : 0.7);
      if (i) add([(i - 1) * 6 + k, i * 6 + k], [-1, 1], values[i * 6 + k] - values[(i - 1) * 6 + k], k < 3 ? 8 : 2);
    }
    const delta = solvePositive(equations, rhs, variables);
    if (!delta) break;
    let scale = 1;
    for (let i = 0; i < n; i++) scale = Math.min(scale, 0.015 / Math.max(1e-8, norm(Array.from(delta.subarray(i * 6, i * 6 + 3)))), 0.025 / Math.max(1e-8, norm(Array.from(delta.subarray(i * 6 + 3, i * 6 + 6)))));
    const proposal = values.map((v, i) => v + delta[i] * scale);
    let bounded = true;
    for (let i = 0; i < n; i++) {
      const correction = Array.from(proposal.subarray(i * 6, i * 6 + 6));
      const camera = helpers.transform(Array.from(original[i].camera), rotationDelta(correction, pivot));
      if (norm(correction.slice(0, 3)) > 0.06 || norm(correction.slice(3)) > 0.09 || norm(sub(camera, Array.from(original[i].camera))) > 0.09) bounded = false;
    }
    if (!bounded || cost(proposal) >= cost(values)) break;
    values = proposal;
    frames = original.map((frame, i) => helpers.apply(frame, rotationDelta(Array.from(proposal.subarray(i * 6, i * 6 + 6)), pivot)));
    diagnostics.iterations++;
  }
  diagnostics.afterMeters = cost(values);
  diagnostics.accepted = diagnostics.iterations > 0 && diagnostics.afterMeters < diagnostics.beforeMeters * 0.94;
  if (!diagnostics.accepted) return {
    frames: input,
    diagnostics
  };
  const byKey = new Map(original.map((frame, i) => [key(frame), rotationDelta(Array.from(values.subarray(i * 6, i * 6 + 6)), pivot)]));
  frames.forEach((frame, i) => {
    diagnostics.maxTranslationMeters = Math.max(diagnostics.maxTranslationMeters, norm(sub(Array.from(frame.camera), Array.from(original[i].camera))));
    diagnostics.maxRotationRadians = Math.max(diagnostics.maxRotationRadians, norm(Array.from(values.subarray(i * 6, i * 6 + 3))));
  });
  return {
    frames: input.map(frame => helpers.apply(frame, byKey.get(key(frame)))),
    diagnostics
  };
}
