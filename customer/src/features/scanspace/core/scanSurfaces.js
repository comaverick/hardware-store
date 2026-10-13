import { getScanDesignSurfaces } from "./scanDesignSurfaces";
import { classifyWallPhotoDetails, wallPhotoTextureDetail } from "./scanWallPhotoDetails";
import { planesForScanMesh } from "./scanCoordinates";
import { photographedWallTrim } from "./scanFloorPreparation";

const kinds = [null, "walls", "floor", "ceiling"];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = vector => {
  const length = Math.hypot(...vector);
  return length ? vector.map(value => value / length) : [0, 1, 0];
};

function measuredPlanes(scan) {
  const sources = [scan.captureQuality?.structuralDepth,
    scan.mesh?.planarConsolidation, scan.captureQuality?.planarConsolidation];
  const result = [];
  for (const source of sources) for (const plane of planesForScanMesh(scan, source)) {
    const label = { wall: 1, floor: 2, ceiling: 3 }[plane?.kind];
    if (!label || !Array.isArray(plane.normal) || plane.normal.length !== 3 ||
      !plane.normal.every(Number.isFinite) || !Number.isFinite(plane.offset)) continue;
    const length = Math.hypot(...plane.normal);
    if (length < .5) continue;
    const normal = unit(plane.normal), offset = plane.offset / length;
    if (label === 1 ? Math.abs(normal[1]) > .3 : Math.abs(normal[1]) < .8) continue;
    if (result.some(other => other.label === label && Math.abs(dot(other.normal, normal)) > .99 &&
      Math.abs(other.offset - offset * Math.sign(dot(other.normal, normal))) < .06)) continue;
    result.push({ normal, offset, label });
  }
  return result;
}

// Older portable meshes can lack plane diagnostics. Infer only broad exterior
// sheets near the room's vertical limits; table tops and interior cabinet faces
// must not become editable floors or walls.
function fallbackPlanes(mesh, centers, normals, areas, floorY, maxY) {
  const bins = new Map();
  for (let face = 0; face < areas.length; face++) {
    if (!areas[face]) continue;
    const p = Array.from(centers.subarray(face * 3, face * 3 + 3));
    let n = Array.from(normals.subarray(face * 3, face * 3 + 3));
    const label = Math.abs(n[1]) > .9
      ? p[1] < floorY + .22 ? 2 : p[1] > maxY - .22 && p[1] > floorY + 1.7 ? 3 : 0
      : Math.abs(n[1]) < .15 ? 1 : 0;
    if (!label) continue;
    const axis = Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2;
    if (n[label === 1 ? axis : 1] < 0) n = n.map(value => -value);
    const angle = label === 1 ? Math.round(Math.atan2(n[2], n[0]) / .09) : 0;
    const offset = dot(n, p), key = `${label},${angle},${Math.round(offset / .06)}`;
    if (!bins.has(key)) bins.set(key, { label, normal: n, offset, area: 0, faces: [] });
    const bin = bins.get(key);
    bin.area += areas[face];
    bin.faces.push(face);
  }
  const result = [];
  for (const candidate of [...bins.values()].sort((a, b) => b.area - a.area)) {
    if (candidate.area < .35 || result.some(other => other.label === candidate.label &&
      Math.abs(dot(other.normal, candidate.normal)) > .97 && Math.abs(other.offset - candidate.offset) < .15)) continue;
    if (candidate.label === 1) {
      let low = Infinity, high = -Infinity, minProjection = Infinity, maxProjection = -Infinity;
      let minSide = Infinity, maxSide = -Infinity;
      const side = [-candidate.normal[2], 0, candidate.normal[0]];
      for (let vertex = 0; vertex < mesh.positions.length; vertex += 3) {
        const p = Array.from(mesh.positions.subarray(vertex, vertex + 3));
        const projection = dot(candidate.normal, p);
        minProjection = Math.min(minProjection, projection);
        maxProjection = Math.max(maxProjection, projection);
      }
      for (const face of candidate.faces) for (let corner = 0; corner < 3; corner++) {
        const vertex = mesh.indices[face * 3 + corner] * 3;
        const p = Array.from(mesh.positions.subarray(vertex, vertex + 3));
        low = Math.min(low, p[1]); high = Math.max(high, p[1]);
        const projection = dot(side, p);
        minSide = Math.min(minSide, projection); maxSide = Math.max(maxSide, projection);
      }
      if (high - low < 1.3 || maxSide - minSide < .55 || high < floorY + 1.5 ||
        Math.min(Math.abs(candidate.offset - minProjection), Math.abs(candidate.offset - maxProjection)) > .12) continue;
    }
    result.push(candidate);
    if (result.length >= 12) break;
  }
  return result;
}

function facePhotoColor(mesh, face) {
  const texture = mesh.texture;
  if (texture?.data?.length && mesh.uvs?.length) {
    const corners = [0, 1, 2].map(corner => mesh.indices[face * 3 + corner]);
    const uv = [0, 1].map(axis => corners.reduce((sum, vertex) => sum + mesh.uvs[vertex * 2 + axis], 0) / 3);
    const x = Math.max(0, Math.min(texture.width - 1, Math.floor(uv[0] * texture.width)));
    const y = Math.max(0, Math.min(texture.height - 1, Math.floor(uv[1] * texture.height)));
    const offset = (y * texture.width + x) * 4;
    return [0, 1, 2].map(channel => texture.data[offset + channel]);
  }
  if (!mesh.colors?.length) return null;
  return [0, 1, 2].map(channel => [0, 1, 2].reduce((sum, corner) =>
    sum + mesh.colors[mesh.indices[face * 3 + corner] * 3 + channel], 0) / 3);
}

function facePhotoHasTexture(mesh, face) {
  const texture = mesh.texture;
  if (!texture?.data?.length || !mesh.uvs?.length) return false;
  const corners = [0, 1, 2].map(corner => mesh.indices[face * 3 + corner]);
  // A second phase avoids aliasing repeated monochrome artwork into a single
  // apparent shadow edge. All samples remain inside this triangle's atlas UVs.
  for (const phase of [[.15, .5, .85], [.2, .45, .7]]) {
    const samples = [];
    for (const v of phase) for (const u of phase) {
      const weights = [(1 - v) * (1 - u), (1 - v) * u, v];
      const uv = [0, 1].map(axis => corners.reduce((sum, vertex, i) => sum + mesh.uvs[vertex * 2 + axis] * weights[i], 0));
      const x = Math.max(0, Math.min(texture.width - 1, Math.floor(uv[0] * texture.width)));
      const y = Math.max(0, Math.min(texture.height - 1, Math.floor(uv[1] * texture.height)));
      const offset = (y * texture.width + x) * 4;
      samples.push(Array.from(texture.data.subarray(offset, offset + 3)));
    }
    if (wallPhotoTextureDetail(samples)) return true;
  }
  return false;
}

// A photograph can contain artwork even when its shallow depth falls inside
// the wall's noise band. Preserve reflectance changes and photo details
// instead of letting an entire detected plane erase their captured appearance.
function preserveWallPhotoDetails(mesh, labels, planeIds, planes, centers, areas) {
  for (let planeId = 0; planeId < planes.length; planeId++) {
    const plane = planes[planeId];
    if (plane.label !== 1) continue;
    const tangent = unit([-plane.normal[2], 0, plane.normal[0]]);
    const cells = new Map();
    for (let face = 0; face < labels.length; face++) {
      if (labels[face] !== 1 || planeIds[face] !== planeId) continue;
      const rgb = facePhotoColor(mesh, face);
      if (!rgb?.every(Number.isFinite)) continue;
      const p = centers.subarray(face * 3, face * 3 + 3);
      const x = Math.floor(dot(tangent, p) / .1), y = Math.floor(p[1] / .1), key = `${x},${y}`;
      if (!cells.has(key)) cells.set(key, { x, y, faces: [], area: 0, sum: [0, 0, 0], depthSum: 0 });
      const cell = cells.get(key), area = areas[face];
      cell.faces.push(face); cell.area += area;
      cell.depthSum += (dot(plane.normal,p)-plane.offset)*area;
      cell.textureDetail ||= facePhotoHasTexture(mesh, face);
      rgb.forEach((value, channel) => {
        cell.sum[channel] += value * area;
      });
    }
    for (const cell of cells.values()) {
      cell.rgb = cell.sum.map(value => value / cell.area);
      cell.depthOffset = cell.depthSum / cell.area;
    }
    classifyWallPhotoDetails(cells, .1);
    for (const cell of cells.values()) if (cell.detail)
      for (const face of cell.faces) labels[face] = 0;
  }
}

// A repaired curtain can have inherited a low, curled source triangle. Its
// reconstructed upright geometry is evidence of foreground ownership; source
// provenance alone must never make it an editable floor.
function uprightForegroundSources(design) {
  const protectedFaces = new Set(), fragments = design.fragments, floor = design.floor;
  if (!fragments?.indices || !fragments.sourceFaces || !floor) return protectedFaces;
  for (let face = 0; face < fragments.indices.length / 3; face++) {
    if (fragments.finishLabels?.[face] !== 0 || !fragments.estimatedTriangleMask?.[face]) continue;
    const points = [0, 1, 2].map(corner => {
      const offset = fragments.indices[face * 3 + corner] * 3;
      return Array.from(fragments.positions.subarray(offset, offset + 3));
    });
    const a = points[1].map((value, axis) => value - points[0][axis]);
    const b = points[2].map((value, axis) => value - points[0][axis]);
    const normal = unit([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
    if (Math.abs(dot(normal, floor.normal)) < .6 &&
        points.some(point => dot(floor.normal, point) - floor.offset > .08))
      protectedFaces.add(fragments.sourceFaces[face]);
  }
  return protectedFaces;
}

function uncoveredPreparedFloor(mesh, face, normal, floor, walls, foregroundSources) {
  if (foregroundSources.has(face) || Math.abs(dot(normal, floor.normal)) < .9) return false;
  const points = [0, 1, 2].map(corner => {
    const offset = mesh.indices[face * 3 + corner] * 3;
    return Array.from(mesh.positions.subarray(offset, offset + 3));
  });
  if (points.some(point => Math.abs(dot(floor.normal, point) - floor.offset) > .055)) return false;
  const center = [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis] / 3, 0));
  return !photographedWallTrim(center, facePhotoColor(mesh, face), walls);
}

function preparedFloorBounds(design) {
  const fragments = design.fragments, axes = design.floor.axes;
  if (!fragments?.indices || !axes) return null;
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (let face = 0; face < fragments.indices.length / 3; face++) {
    if (fragments.finishLabels?.[face] !== 2) continue;
    for (let corner = 0; corner < 3; corner++) {
      const offset = fragments.indices[face * 3 + corner] * 3;
      const point = fragments.positions.subarray(offset, offset + 3);
      for (let axis = 0; axis < 2; axis++) {
        const value = dot(axes[axis], point);
        min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
      }
    }
  }
  return min.every(Number.isFinite) ? { min, max } : null;
}

// Noisy capture rims sometimes fold down below the fitted floor. They remain
// measured triangles, but their visible underside needs the flooring finish.
// Limit this ownership to the prepared floor bounds and room interior; raised
// objects, wall skirting and reconstructed cloth retain their photographs.
function capturedFloorUnderside(mesh, face, floor, walls, bounds, foregroundSources, maximumHeight = .004) {
  if (!bounds || foregroundSources.has(face)) return false;
  for (let corner = 0; corner < 3; corner++) {
    const offset = mesh.indices[face * 3 + corner] * 3;
    const point = mesh.positions.subarray(offset, offset + 3);
    const height = dot(floor.normal, point) - floor.offset;
    if (height < -.12 || height > maximumHeight || walls.some(wall => dot(wall.normal, point) - wall.offset < .15)) return false;
    if (floor.axes.some((axis, index) => {
      const value = dot(axis, point);
      return value < bounds.min[index] - .04 || value > bounds.max[index] + .04;
    })) return false;
  }
  return true;
}

function genuineFacePhoto(mesh, face) {
  if (!mesh.texture?.data?.length || !mesh.uvs?.length) return null;
  const uv = [0, 1, 2].map(corner => {
    const offset = mesh.indices[face * 3 + corner] * 2;
    return Array.from(mesh.uvs.subarray(offset, offset + 2));
  });
  if ([0, 1].every(axis => Math.max(...uv.map(p => p[axis])) - Math.min(...uv.map(p => p[axis])) < 1e-6)) return null;
  return facePhotoColor(mesh, face);
}

function preparedFloorPhotoPalette(mesh, design) {
  const palette = new Map(), fragments = design.fragments, floor = design.floor;
  if (!fragments?.indices) return palette;
  const photos = { ...fragments, texture: mesh.texture };
  for (let face = 0; face < fragments.indices.length / 3; face++) {
    if (fragments.finishLabels?.[face] !== 2) continue;
    const rgb = genuineFacePhoto(photos, face); if (!rgb) continue;
    const center = [0, 1, 2].map(axis => [0, 1, 2].reduce((sum, corner) =>
      sum + fragments.positions[fragments.indices[face * 3 + corner] * 3 + axis] / 3, 0));
    const q = floor.axes.map(axis => dot(axis, center)), k = q.map(value => Math.floor(value / .08)).join(",");
    if (!palette.has(k)) palette.set(k, []);
    palette.get(k).push({ q, rgb });
  }
  return palette;
}

function matchesPreparedFloorPhoto(mesh, face, center, floor, palette) {
  const rgb = genuineFacePhoto(mesh, face); if (!rgb) return false;
  const q = floor.axes.map(axis => dot(axis, center)), grid = q.map(value => Math.floor(value / .08));
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const samples = palette.get(`${grid[0] + x},${grid[1] + y}`) || [];
    if (samples.some(sample => Math.hypot(sample.q[0] - q[0], sample.q[1] - q[1]) <= .14 &&
      Math.hypot(...sample.rgb.map((value, channel) => value - rgb[channel])) <= 35)) return true;
  }
  return false;
}

function capturedFaceEdges(mesh, face) {
  const points = [0, 1, 2].map(corner => {
    const offset = mesh.indices[face * 3 + corner] * 3;
    return Array.from(mesh.positions.subarray(offset, offset + 3), value => Math.round(value * 1e5)).join(",");
  });
  return [[0, 1], [1, 2], [2, 0]].map(([a, b]) => [points[a], points[b]].sort().join("|"));
}

// Marble photographed at a bent capture edge can rise slightly above the fit.
// Recover only measured floor seeds matching a nearby floor photograph, then
// their matching side faces sharing two actual captured vertex positions.
function restorePhotographedFloorEdges(mesh, design, originalLabels, labels, centers, areas, bounds, foregroundSources) {
  const floor = design.floor, palette = preparedFloorPhotoPalette(mesh, design);
  if (!palette.size) return;
  const edges = new Set(), candidates = [];
  for (let face = 0; face < labels.length; face++) {
    if (design.removedSourceFaces[face] || !areas[face] ||
        !capturedFloorUnderside(mesh, face, floor, design.walls, bounds, foregroundSources, .08) ||
        !matchesPreparedFloorPhoto(mesh, face, centers.subarray(face * 3, face * 3 + 3), floor, palette)) continue;
    const faceEdges = capturedFaceEdges(mesh, face);
    if (originalLabels[face] === 2) { labels[face] = 2; faceEdges.forEach(edge => edges.add(edge)); }
    else if (!labels[face]) candidates.push({ face, edges: faceEdges });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (labels[candidate.face] || !candidate.edges.some(edge => edges.has(edge))) continue;
      labels[candidate.face] = 2; candidate.edges.forEach(edge => edges.add(edge)); changed = true;
    }
  }
}

export function identifyScanSurfaces(scan) {
  const mesh = scan.mesh;
  const counts = { walls: 0, floor: 0, ceiling: 0 };
  const surfaceAreas = { walls: 0, floor: 0, ceiling: 0 };
  if (!mesh?.positions?.length || !mesh.indices?.length)
    return { labels: new Uint8Array(), counts, areas: surfaceAreas, floorAxes: [[1, 0, 0], [0, 0, 1]] };
  const faceCount = mesh.indices.length / 3;
  const centers = new Float32Array(faceCount * 3), normals = new Float32Array(faceCount * 3), areas = new Float32Array(faceCount);
  let minY = Infinity, maxY = -Infinity;
  for (let face = 0; face < faceCount; face++) {
    const a = mesh.indices[face * 3] * 3, b = mesh.indices[face * 3 + 1] * 3, c = mesh.indices[face * 3 + 2] * 3;
    const ab = [0, 1, 2].map(axis => mesh.positions[b + axis] - mesh.positions[a + axis]);
    const ac = [0, 1, 2].map(axis => mesh.positions[c + axis] - mesh.positions[a + axis]);
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const length = Math.hypot(...n);
    if (!Number.isFinite(length) || length < 1e-10) continue;
    areas[face] = length / 2;
    for (let axis = 0; axis < 3; axis++) {
      centers[face * 3 + axis] = (mesh.positions[a + axis] + mesh.positions[b + axis] + mesh.positions[c + axis]) / 3;
      normals[face * 3 + axis] = n[axis] / length;
    }
    minY = Math.min(minY, mesh.positions[a + 1], mesh.positions[b + 1], mesh.positions[c + 1]);
    maxY = Math.max(maxY, mesh.positions[a + 1], mesh.positions[b + 1], mesh.positions[c + 1]);
  }
  const floorY = Number.isFinite(scan.mesh?.floorY) || Number.isFinite(scan.rawCapture?.floorY) ||
    Number.isFinite(scan.cloud?.floorY) ? 0 : minY;
  const known = measuredPlanes(scan);
  const planes = known.length ? known : fallbackPlanes(mesh, centers, normals, areas, floorY, maxY);
  const labels = new Uint8Array(faceCount);
  const planeIds = new Int16Array(faceCount).fill(-1);
  for (let face = 0; face < faceCount; face++) {
    if (!areas[face]) continue;
    const center = Array.from(centers.subarray(face * 3, face * 3 + 3));
    const normal = Array.from(normals.subarray(face * 3, face * 3 + 3));
    let best = Infinity;
    for (let planeId = 0; planeId < planes.length; planeId++) {
      const plane = planes[planeId];
      // Textured scans can have several noisy layers of the same wall. Include
      // those layers; the photo-detail mask below protects shallow objects.
      const photographed = mesh.texture?.data?.length && mesh.uvs?.length;
      const limit = photographed && plane.label === 1 ? .16 : photographed && plane.label === 2 ? .12 : .065;
      if (Math.abs(dot(normal, plane.normal)) < (plane.label === 1 ? .6 : .72)) continue;
      const residual = Math.abs(dot(plane.normal, center) - plane.offset);
      if (residual > limit || residual >= best) continue;
      let withinPlane = true;
      for (let corner = 0; corner < 3; corner++) {
        const vertex = mesh.indices[face * 3 + corner] * 3;
        const p = Array.from(mesh.positions.subarray(vertex, vertex + 3));
        if (Math.abs(dot(plane.normal, p) - plane.offset) > limit) { withinPlane = false; break; }
      }
      if (!withinPlane) continue;
      best = residual;
      labels[face] = plane.label;
      planeIds[face] = planeId;
    }
  }
  const design = getScanDesignSurfaces(mesh);
  if (!design?.walls.length) preserveWallPhotoDetails(mesh, labels, planeIds, planes, centers, areas);
  if (design) {
    // Foreground fragments and uncertain old wall regions keep their photo.
    // Paint targets the continuous design sheet instead of scattered faces.
    if (design.walls.length) {
      for (let face = 0; face < labels.length; face++) if (labels[face] === 1) labels[face] = 0;
      counts.walls = design.walls.reduce((sum, wall) => sum + wall.indices.length / 3, 0);
      surfaceAreas.walls = design.walls.reduce((sum, wall) => sum + wall.area, 0);
    }
    if (design.ceilings?.length) {
      for (let face = 0; face < labels.length; face++) if (labels[face] === 3 && design.removedSourceFaces[face]) labels[face] = 0;
      counts.ceiling = design.ceilings.reduce((sum, ceiling) => sum + ceiling.indices.length / 3, 0);
      surfaceAreas.ceiling = design.ceilings.reduce((sum, ceiling) => sum + ceiling.area, 0);
    }
    if (design.floor) {
      const foregroundSources = uprightForegroundSources(design), bounds = preparedFloorBounds(design);
      const originalLabels = labels.slice();
      for (let face = 0; face < labels.length; face++) {
        if (design.removedSourceFaces[face]) { if (labels[face] === 2) labels[face] = 0; continue; }
        if (!areas[face]) continue;
        const strongFloor = labels[face] === 2 && uncoveredPreparedFloor(mesh, face,
          Array.from(normals.subarray(face * 3, face * 3 + 3)), design.floor, design.walls, foregroundSources);
        if (strongFloor || capturedFloorUnderside(mesh, face, design.floor, design.walls, bounds, foregroundSources))
          labels[face] = 2;
        else if (labels[face] === 2) labels[face] = 0;
      }
      restorePhotographedFloorEdges(mesh, design, originalLabels, labels, centers, areas, bounds, foregroundSources);
      counts.floor = design.floor.triangleCount;
      surfaceAreas.floor = design.floor.area;
    }
  }
  for (let face = 0; face < faceCount; face++) {
    if (labels[face]) {
      counts[kinds[labels[face]]]++;
      surfaceAreas[kinds[labels[face]]] += areas[face];
    }
  }
  const wall = planes.find(plane => plane.label === 1);
  const floorNormal = planes.find(plane => plane.label === 2)?.normal || [0, 1, 0];
  const along = wall ? [-wall.normal[2], 0, wall.normal[0]] : [1, 0, 0];
  let u = unit(along.map((value, axis) => value - floorNormal[axis] * dot(along, floorNormal)));
  let v = unit([floorNormal[1] * u[2] - floorNormal[2] * u[1], floorNormal[2] * u[0] - floorNormal[0] * u[2], floorNormal[0] * u[1] - floorNormal[1] * u[0]]);
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (let face = 0; face < faceCount; face++) if (labels[face] === 2) {
    const p = Array.from(centers.subarray(face * 3, face * 3 + 3));
    [u, v].forEach((axis, index) => { const value = dot(axis, p); min[index] = Math.min(min[index], value); max[index] = Math.max(max[index], value); });
  }
  if (max[1] - min[1] > max[0] - min[0]) [u, v] = [v, u];
  if (design?.floor) [u,v] = design.floor.axes;
  return { labels, counts, areas: surfaceAreas, floorAxes: [u, v] };
}
