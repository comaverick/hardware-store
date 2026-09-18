// Register overlapping photographs in a supported surface's coordinates.
// Geometry remains fixed; a bounded affine correction aligns the image patches.
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => {
  const length = Math.hypot(...v) || 1;
  return v.map(x => x / length);
};
const median = v => v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)] || 0;
const basis = n => {
  const u = unit(cross(n, Math.abs(n[1]) < 0.8 ? [0, 1, 0] : [1, 0, 0]));
  return [u, cross(n, u)];
};
function image(frame) {
  const width = Math.min(256, frame.colorWidth),
    height = Math.round(width * frame.colorHeight / frame.colorWidth);
  const data = new Float32Array(width * height),
    channels = frame.colorChannels || 4;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (Math.min(frame.colorHeight - 1, Math.round((1 - y / (height - 1)) * (frame.colorHeight - 1))) * frame.colorWidth + Math.round(x / (width - 1) * (frame.colorWidth - 1))) * channels;
    data[y * width + x] = frame.colorImage[offset] * 0.299 + frame.colorImage[offset + 1] * 0.587 + frame.colorImage[offset + 2] * 0.114;
  }
  return {
    width,
    height,
    data
  };
}
function sample(im, x, y) {
  if (x < 1 || y < 1 || x >= im.width - 2 || y >= im.height - 2) return null;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = x - ix,
    ty = y - iy,
    i = iy * im.width + ix;
  return (im.data[i] * (1 - tx) + im.data[i + 1] * tx) * (1 - ty) + (im.data[i + im.width] * (1 - tx) + im.data[i + im.width + 1] * tx) * ty;
}
function descriptor(im, center, dx, dy) {
  const values = [];
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const value = sample(im, center[0] + x * dx[0] + y * dy[0], center[1] + x * dx[1] + y * dy[1]);
    if (value === null) return null;
    values.push(value);
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const centered = values.map(v => v - mean),
    length = Math.hypot(...centered);
  return length > 45 ? centered.map(v => v / length) : null;
}
function projectPixels(frame, im, p, project) {
  const q = project(frame, ...p);
  return q ? [q.u * (im.width - 1), q.v * (im.height - 1)] : null;
}
function planePoint(frame, u, v, plane) {
  const p = frame.viewProjectionMatrix || frame.projectionMatrix,
    m = frame.viewTransformMatrix || frame.transformMatrix;
  const local = [(u * 2 - 1 + p[8]) / p[0], (1 - v * 2 + p[9]) / p[5], -1];
  const ray = [0, 1, 2].map(i => m[i] * local[0] + m[i + 4] * local[1] + m[i + 8] * local[2]);
  const camera = [m[12], m[13], m[14]],
    denominator = dot(plane.normal, ray);
  if (Math.abs(denominator) < 0.15) return null;
  const distance = (plane.offset - dot(plane.normal, camera)) / denominator;
  return distance > 0.2 && distance < 7 ? camera.map((c, i) => c + ray[i] * distance) : null;
}
export function fitTextureOffset(matches) {
  if (matches.length < 10) return null;
  const du = median(matches.map(m => m.du)),
    dv = median(matches.map(m => m.dv));
  const inliers = matches.filter(m => Math.hypot(m.du - du, m.dv - dv) < 0.025);
  if (inliers.length < 10 || inliers.length < matches.length * 0.55) return null;
  const center = [median(inliers.map(m => m.u)), median(inliers.map(m => m.v))];
  const fit = channel => {
    const a = new Float64Array(9),
      b = new Float64Array(3);
    for (const m of inliers) {
      const x = [m.u - center[0], m.v - center[1], 1];
      for (let i = 0; i < 3; i++) {
        b[i] += x[i] * m[channel];
        for (let j = 0; j < 3; j++) a[i * 3 + j] += x[i] * x[j];
      }
    }
    // Prefer a translation unless observations support a scale/rotation change.
    a[0] += 1;
    a[4] += 1;
    a[8] += 1e-6;
    for (let i = 0; i < 3; i++) {
      const diagonal = a[i * 3 + i];
      if (Math.abs(diagonal) < 1e-9) return null;
      for (let j = i; j < 3; j++) a[i * 3 + j] /= diagonal;
      b[i] /= diagonal;
      for (let k = 0; k < 3; k++) {
        if (k === i) continue;
        const f = a[k * 3 + i];
        for (let j = i; j < 3; j++) a[k * 3 + j] -= f * a[i * 3 + j];
        b[k] -= f * b[i];
      }
    }
    return Array.from(b);
  };
  const x = fit('du'),
    y = fit('dv');
  if (!x || !y || Math.hypot(x[2], y[2]) > 0.08 || Math.hypot(x[0], x[1], y[0], y[1]) > 0.09) return null;
  const residual = median(inliers.map(m => Math.hypot(m.du - x[0] * (m.u - center[0]) - x[1] * (m.v - center[1]) - x[2], m.dv - y[0] * (m.u - center[0]) - y[1] * (m.v - center[1]) - y[2])));
  if (residual > 0.014) return null;
  return {
    center,
    x,
    y,
    matches: inliers.length,
    residualMeters: residual
  };
}
export function registerSurfaceTextures(records, planes, frames, project, options = {}) {
  const images = frames.map(image),
    transforms = new Map(),
    diagnostics = [];
  for (let patch = 0; patch < planes.length; patch++) {
    const plane = planes[patch],
      axes = basis(plane.normal),
      members = records.filter(r => r.patch === patch && r.candidates.length);
    if (!members.length) continue;
    const occupied = new Set(members.map(record => `${Math.floor(dot(record.center, axes[0]) / 0.12)},${Math.floor(dot(record.center, axes[1]) / 0.12)}`));
    const scores = new Map();
    for (const r of members) for (const c of r.candidates) {
      const id = c.frame.textureId;
      scores.set(id, (scores.get(id) || 0) + r.area * Math.exp(c.score - r.candidates[0].score));
    }
    const referenceId = [...scores].sort((a, b) => b[1] - a[1])[0][0],
      reference = frames[referenceId],
      im = images[referenceId];
    const corners = [];
    for (let y = 8; y < im.height - 8; y += 3) for (let x = 8; x < im.width - 8; x += 3) {
      let xx = 0,
        xy = 0,
        yy = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const i = (y + dy) * im.width + x + dx,
          gx = (im.data[i + 1] - im.data[i - 1]) * 0.5,
          gy = (im.data[i + im.width] - im.data[i - im.width]) * 0.5;
        xx += gx * gx;
        xy += gx * gy;
        yy += gy * gy;
      }
      const score = (xx + yy - Math.hypot(xx - yy, 2 * xy)) * 0.5;
      if (score < 100) continue;
      const p = planePoint(reference, x / (im.width - 1), y / (im.height - 1), plane);
      if (p && occupied.has(`${Math.floor(dot(p, axes[0]) / 0.12)},${Math.floor(dot(p, axes[1]) / 0.12)}`) && (!options.isVisible || options.isVisible(reference, p))) corners.push({
        x,
        y,
        p,
        score
      });
    }
    corners.sort((a, b) => b.score - a.score);
    const features = [];
    for (const corner of corners) {
      if (features.some(f => Math.hypot(f.x - corner.x, f.y - corner.y) < 9)) continue;
      const p = corner.p,
        center = projectPixels(reference, im, p, project);
      const directions = axes.map(axis => projectPixels(reference, im, p.map((v, i) => v + axis[i] * 0.012), project));
      if (!center || directions.some(d => !d)) continue;
      const desc = descriptor(im, center, ...directions.map(d => d.map((v, i) => v - center[i])));
      if (!desc) continue;
      features.push({
        ...corner,
        desc,
        u: dot(p, axes[0]),
        v: dot(p, axes[1])
      });
      if (features.length >= 180) break;
    }
    for (const id of scores.keys()) {
      if (id === referenceId) continue;
      const frame = frames[id],
        target = images[id],
        matches = [];
      for (const f of features) {
        if (options.isVisible && !options.isVisible(frame, f.p)) continue;
        const center = projectPixels(frame, target, f.p, project);
        const directions = axes.map(axis => projectPixels(frame, target, f.p.map((v, i) => v + axis[i] * 0.012), project));
        if (!center || directions.some(d => !d)) continue;
        const [dx, dy] = directions.map(d => d.map((v, i) => v - center[i]));
        const evaluate = (u, v) => {
          const c = [0, 1].map(i => center[i] + dx[i] * u / 0.012 + dy[i] * v / 0.012);
          const desc = descriptor(target, c, dx, dy);
          return desc ? dot(f.desc, desc) : -1;
        };
        const before = evaluate(0, 0),
          proposals = [];
        for (let v = -0.072; v <= 0.0721; v += 0.012) for (let u = -0.072; u <= 0.0721; u += 0.012) proposals.push({
          u,
          v,
          score: evaluate(u, v)
        });
        proposals.sort((a, b) => b.score - a.score);
        let best = proposals[0];
        const second = proposals.find(p => Math.hypot(p.u - best.u, p.v - best.v) > 0.024);
        if (best.score < 0.82 || best.score - (second?.score ?? -1) < 0.04) continue;
        const coarse = best;
        for (let v = -0.01; v <= 0.0101; v += 0.0025) for (let u = -0.01; u <= 0.0101; u += 0.0025) {
          const score = evaluate(coarse.u + u, coarse.v + v);
          if (score > best.score) best = {
            u: coarse.u + u,
            v: coarse.v + v,
            score
          };
        }
        if (best.score >= 0.87) matches.push({
          u: f.u,
          v: f.v,
          du: best.u,
          dv: best.v,
          before,
          after: best.score
        });
      }
      const fit = fitTextureOffset(matches);
      if (!fit) continue;
      const gain = median(matches.map(m => m.after - m.before));
      if (gain < 0.04) continue;
      transforms.set(`${patch}:${id}`, {
        ...fit,
        axes
      });
      diagnostics.push({
        patch,
        frameId: frame.frameId,
        referenceFrameId: reference.frameId,
        ...fit,
        gain
      });
    }
  }
  return {
    diagnostics,
    project: (frame, patch, p) => {
      const t = transforms.get(`${patch}:${frame.textureId}`);
      if (!t) return project(frame, ...p);
      const u = dot(p, t.axes[0]) - t.center[0],
        v = dot(p, t.axes[1]) - t.center[1];
      const du = t.x[0] * u + t.x[1] * v + t.x[2],
        dv = t.y[0] * u + t.y[1] * v + t.y[2];
      if (Math.hypot(du, dv) > 0.045) return project(frame, ...p);
      const shifted = p.map((value, i) => value + t.axes[0][i] * du + t.axes[1][i] * dv);
      if (options.isVisible && !options.isVisible(frame, shifted)) return project(frame, ...p);
      return project(frame, ...shifted);
    }
  };
}
