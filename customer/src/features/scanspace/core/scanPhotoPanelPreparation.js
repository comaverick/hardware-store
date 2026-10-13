const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const inView = uv => uv && Math.min(uv.u, uv.v) >= .01 && Math.max(uv.u, uv.v) <= .99;

// Optional display repair for independently observed hanging fabric. Repeated
// photo pleats have already identified these cells; a striped flat wall cannot
// enter this pass. Robust column depths retain the folds without the overlapping
// depth curls. Original geometry and camera pixels remain available in Geometry.
export function prepareFoldedPhotoPanel(wall, preserved, helpers) {
  if (!helpers.projectColor || !preserved.size) return null;
  const cell = wall.cellSize, columns = new Map();
  for (const p of preserved.values()) {
    if (!p.foldedPanel || !Number.isFinite(p.depthOffset) || p.support < 2 || Math.abs(p.depthOffset) > .18) continue;
    if (!columns.has(p.x)) columns.set(p.x, []);
    columns.get(p.x).push(p.depthOffset);
  }
  const depths = new Map([...columns].filter(([, a]) => a.length * cell >= .5).map(([x, a]) => [x, median(a)]));
  if (depths.size * cell < .5) return null;
  function offsetAt(x) {
    const values = [depths.get(x - 1), depths.get(x)].filter(Number.isFinite);
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  }
  const world = (x, y) => {
    const offset = offsetAt(x);
    return offset === null ? null : wall.normal.map((n, i) => n * (wall.offset + offset) +
      wall.axes[0][i] * x * cell + wall.axes[1][i] * y * cell);
  };
  const frames = (helpers.textureFrames || []).filter(f => f.atlasUVTransform?.length === 4);
  const cells = new Map(), votes = new Map();
  for (const [k, p] of preserved) {
    if (!p.foldedPanel || p.support < 2) continue;
    const points = [[p.x,p.y],[p.x+1,p.y],[p.x+1,p.y+1],[p.x,p.y+1]].map(q => world(...q));
    if (points.some(q => !q)) continue;
    const center = points[0].map((v, i) => points.reduce((s, q) => s + q[i] / 4, 0));
    const choices = [];
    for (const frame of frames) {
      const projections = points.map(q => helpers.projectColor(frame, ...q));
      if (projections.some(uv => !inView(uv))) continue;
      if (helpers.photoVisible) {
        if (!helpers.photoVisible(frame, center, .14)) continue;
      } else {
        const depthUV = helpers.project?.(frame, ...center);
        if (!inView(depthUV)) continue;
        const i = Math.floor(depthUV.v * frame.rows) * frame.columns + Math.floor(depthUV.u * frame.columns);
        const d = (frame.originalFilteredDepth || frame.filteredDepth)?.[i];
        if (!frame.measuredMask?.[i] || !(d > 0) || Math.abs(d - depthUV.depth) > .22) continue;
      }
      const camera = frame.viewTransformMatrix || frame.transformMatrix;
      if (camera?.length !== 16) continue;
      const ray = center.map((v, i) => camera[i + 12] - v), angle = dot(ray, wall.normal) / Math.hypot(...ray);
      if (angle < .3) continue;
      const density = Math.sqrt(frame.colorWidth * frame.colorHeight) / Math.hypot(...ray);
      const score = angle * density * (1 + Math.min(20, Number(frame.textureFocus || frame.colorFocus) || 0) / 20);
      choices.push({ frame, projections, score });
      votes.set(frame, (votes.get(frame) || 0) + score);
    }
    if (!choices.length) continue;
    choices.sort((a, b) => b.score - a.score);
    cells.set(k, { ...p, points, choices });
  }
  if (cells.size * cell * cell < .25) return null;
  const preferred = [...votes].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  for (const p of cells.values()) {
    const choice = preferred.map(f => p.choices.find(c => c.frame === f && c.score >= p.choices[0].score * .8)).find(Boolean) || p.choices[0];
    const t = choice.frame.atlasUVTransform;
    // Smooth normals follow the retained pleat, and winding always faces the
    // observed room side. No gray back face is inserted across a curtain fold.
    const a = p.points[1].map((v, i) => v - p.points[0][i]), b = p.points[3].map((v, i) => v - p.points[0][i]);
    const n = [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], length = Math.hypot(...n);
    const sign = dot(n, wall.normal) < 0 ? -1 : 1;
    p.vertices = p.points.map((q, i) => ({ p: q, n: n.map(v => v * sign / length), rgb: [255,255,255],
      uv: [t[0] + choice.projections[i].u * t[2], t[1] + (1 - choice.projections[i].v) * t[3]] }));
    p.triangles = sign > 0 ? [[0,1,2],[0,2,3]] : [[0,2,1],[0,3,2]];
    delete p.choices;
  }
  return { cells, area: cells.size * cell * cell };
}
