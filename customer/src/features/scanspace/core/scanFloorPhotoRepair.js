import { structuralSupportAt } from "./structuralDepth";

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const inView = uv => uv && Math.min(uv.u, uv.v) >= .01 && Math.max(uv.u, uv.v) <= .99;

// A floor whose native depth has already authorized structural reconstruction
// can miss the ordinary texture tolerance at a wall junction. Repair only its
// constant-color display faces, after boundary adjustment. Every photo ray must
// still hit this floor, including the triangle corners; furniture cannot lend
// its texture. The measured mesh, camera atlas and coverage remain unchanged.
export function repairFloorPhotos(mesh, planes, helpers, fragments, removed) {
  const floors = (Array.isArray(planes) ? planes : []).filter(p => p.kind === "floor" && p.cells instanceof Map && p.normal?.[1] > .9);
  const photos = (helpers.textureFrames || []).filter(f => f.atlasUVTransform?.length === 4 && f.colorWidth > 0 && f.colorHeight > 0);
  if (!floors.length || !photos.length || !helpers.projectColor || !helpers.unproject) return { repairedFloorPhotoTriangles: 0 };
  const repairs = [], votes = new Map();
  function inspect(source, face, captured) {
    if (!source.uvs?.length) return;
    const ids = [0, 1, 2].map(c => source.indices[face * 3 + c]);
    if (ids.some(i => Math.abs(source.uvs[i * 2] - source.uvs[ids[0] * 2]) > 1e-7 ||
      Math.abs(source.uvs[i * 2 + 1] - source.uvs[ids[0] * 2 + 1]) > 1e-7)) return;
    const points = ids.map(i => Array.from(source.positions.slice(i * 3, i * 3 + 3)));
    const center = points[0].map((v, i) => points.reduce((sum, p) => sum + p[i] / 3, 0));
    const floor = floors.find(p => points.every(q => Math.abs(dot(p.normal, q) - p.offset) < .04) && structuralSupportAt(p, center, 2));
    if (!floor) return;
    const a = points[1].map((v, i) => v - points[0][i]), b = points[2].map((v, i) => v - points[0][i]);
    const n = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    if (dot(n, floor.normal) / (Math.hypot(...n) || 1) < .85) return;
    const choices = [];
    for (const frame of photos) {
      const projections = points.map(q => helpers.projectColor(frame, ...q));
      if (projections.some(uv => !inView(uv))) continue;
      let error = 0, visible = true;
      for (const p of [center, ...points]) {
        const uv = helpers.project?.(frame, ...p);
        if (!inView(uv)) { visible = false; break; }
        const i = Math.floor(uv.v * frame.rows) * frame.columns + Math.floor(uv.u * frame.columns);
        const d = (frame.originalFilteredDepth || frame.filteredDepth)?.[i];
        if (!frame.measuredMask?.[i] || !(d > 0) || Math.abs(d - uv.depth) > .2) { visible = false; break; }
        const hit = helpers.unproject(frame, i, d);
        if (!hit || Math.abs(dot(floor.normal, hit) - floor.offset) > .085) { visible = false; break; }
        error = Math.max(error, Math.abs(d - uv.depth));
      }
      if (!visible) continue;
      const transform = frame.viewTransformMatrix || frame.transformMatrix;
      if (transform?.length !== 16) continue;
      const ray = center.map((v, i) => transform[i + 12] - v), distance = Math.hypot(...ray);
      const angle = dot(ray, floor.normal) / distance;
      if (angle < .28) continue;
      const score = angle * Math.sqrt(frame.colorWidth * frame.colorHeight) / distance / (1 + error * 6);
      choices.push({ frame, projections, score });
      votes.set(frame, (votes.get(frame) || 0) + score);
    }
    if (choices.length) repairs.push({ source, face, ids, points, captured, choices, normal: floor.normal });
  }
  const fragmentCount = fragments.indices.length / 3;
  for (let face = 0; face < fragmentCount; face++) inspect(fragments, face, false);
  for (let face = 0; face < mesh.indices.length / 3; face++) if (!removed[face]) inspect(mesh, face, true);
  const preferred = [...votes].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  for (const repair of repairs) {
    const best = Math.max(...repair.choices.map(c => c.score));
    const choice = preferred.map(f => repair.choices.find(c => c.frame === f && c.score >= best * .75)).find(Boolean);
    const t = choice.frame.atlasUVTransform;
    if (repair.captured) removed[repair.face] = 1;
    for (let c = 0; c < 3; c++) {
      const original = repair.ids[c], id = repair.captured ? fragments.positions.length / 3 : original;
      const uv = [t[0] + choice.projections[c].u * t[2], t[1] + (1 - choice.projections[c].v) * t[3]];
      if (repair.captured) {
        fragments.positions.push(...repair.points[c]);
        fragments.normals.push(...(mesh.normals?.slice(original * 3, original * 3 + 3) || repair.normal));
        fragments.colors.push(255, 255, 255); fragments.uvs.push(...uv); fragments.indices.push(id);
      } else {
        fragments.colors.splice(id * 3, 3, 255, 255, 255);
        fragments.uvs.splice(id * 2, 2, ...uv);
      }
    }
    if (repair.captured) {
      fragments.sourceFaces.push(repair.face); fragments.estimatedTriangleMask.push(1);
    }
  }
  return { repairedFloorPhotoTriangles: repairs.length };
}
