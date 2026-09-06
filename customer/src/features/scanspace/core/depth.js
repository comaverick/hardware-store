import { Matrix4, Vector3 } from "three";

// WebXR depth becomes especially noisy inside arm's reach on phones that infer
// depth from motion. ScanSpace is a room scanner, so samples closer than this
// are more likely to be hands, motion artifacts, or invalid near-field depth
// than useful wall geometry.
export const MIN_ROOM_DEPTH_METERS = 0.45;

export async function detectCapabilities(
  nav = navigator,
  secure = window.isSecureContext,
) {
  const result = {
    secure,
    ar: false,
    browser: nav.userAgent || "Unknown browser",
    error: "",
  };
  if (!secure)
    return { ...result, error: "Open ScanSpace over HTTPS to scan a room." };
  if (!nav.xr)
    return {
      ...result,
      error:
        "This browser does not offer room scanning. You can still enter measurements.",
    };
  try {
    result.ar = await nav.xr.isSessionSupported("immersive-ar");
  } catch (error) {
    result.error = error.message;
  }
  return result;
}

// Depth is distance along the camera Z axis, not radial distance along a normalized ray.
// getDepthInMeters applies normDepthBufferFromNormView, including rotation/cropping.
export function unprojectDepth(
  depth,
  view,
  columns = 56,
  rows = 42,
  colorAt = null,
) {
  const inverse = new Matrix4().fromArray(view.projectionMatrix).invert();
  const pose = new Matrix4().fromArray(view.transform.matrix);
  const points = [],
    ray = new Vector3();
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const u = (x + 0.5) / columns,
        v = (y + 0.5) / rows;
      const meters = depth.getDepthInMeters(u, v);
      if (
        !Number.isFinite(meters) ||
        meters < MIN_ROOM_DEPTH_METERS ||
        meters > 8
      )
        continue;
      ray.set(u * 2 - 1, 1 - v * 2, 0.5).applyMatrix4(inverse);
      if (ray.z >= -0.00001) continue;
      ray.multiplyScalar(meters / -ray.z).applyMatrix4(pose);
      if (![ray.x, ray.y, ray.z].every(Number.isFinite)) continue;
      const color = colorAt?.(u, v);
      points.push({
        x: ray.x,
        y: ray.y,
        z: ray.z,
        depth: meters,
        color,
        gridX: x,
        gridY: y,
        gridColumns: columns,
        gridRows: rows,
      });
    }
  return points;
}

export class VoxelCloud {
  constructor(size = 0.08, limit = 60000, maxSize = 0.18) {
    this.size = size;
    this.limit = limit;
    this.maxSize = maxSize;
    this.cells = new Map();
    this.full = false;
    this.compactions = 0;
    this.repeatedCells = 0;
  }
  key(p) {
    return `${Math.floor(p.x / this.size)},${Math.floor(p.y / this.size)},${Math.floor(p.z / this.size)}`;
  }
  compact() {
    if (this.size >= this.maxSize) return false;
    const nextSize = Math.min(this.maxSize, this.size * 1.35);
    const compacted = new Map();
    for (const point of this.cells.values()) {
      const key = `${Math.floor(point.x / nextSize)},${Math.floor(
        point.y / nextSize,
      )},${Math.floor(point.z / nextSize)}`;
      const current = compacted.get(key);
      if (!current) compacted.set(key, { ...point });
      else {
        const hits = Math.min(current.hits + point.hits, 255);
        const weight = point.hits / hits;
        ["x", "y", "z"].forEach((name) => {
          current[name] += (point[name] - current[name]) * weight;
        });
        if (point.color)
          current.color = current.color
            ? current.color.map(
                (value, index) => value + (point.color[index] - value) * weight,
              )
            : point.color;
        current.hits = hits;
        current.frameId = Math.max(current.frameId, point.frameId);
      }
    }
    this.size = nextSize;
    this.cells = compacted;
    this.repeatedCells = [...compacted.values()].filter(
      (point) => point.hits >= 2,
    ).length;
    this.compactions++;
    return true;
  }
  add(points, frameId) {
    for (const p of points) {
      if (![p.x, p.y, p.z].every((v) => Number.isFinite(v) && Math.abs(v) < 60))
        continue;
      let key = this.key(p),
        previous = this.cells.get(key);
      if (!previous && this.cells.size >= this.limit * 0.92) {
        this.compact();
        key = this.key(p);
        previous = this.cells.get(key);
      }
      if (previous) {
        if (previous.frameId === frameId) continue;
        previous.frameId = frameId;
        if (previous.hits === 1) this.repeatedCells++;
        previous.hits++;
        const weight = 1 / Math.min(previous.hits, 8);
        ["x", "y", "z"].forEach((k) => {
          previous[k] += (p[k] - previous[k]) * weight;
        });
        if (p.color)
          previous.color = previous.color
            ? previous.color.map((v, i) => v + (p.color[i] - v) * weight)
            : p.color;
      } else if (this.cells.size < this.limit)
        this.cells.set(key, { ...p, frameId, hits: 1 });
      else this.full = this.size >= this.maxSize;
    }
  }
  previewStableCount() {
    return this.repeatedCells;
  }
  values(filtered = false) {
    const all = [...this.cells.values()];
    if (!filtered) return all;
    return all.filter((p) => {
      const [x, y, z] = this.key(p).split(",").map(Number);
      let neighbors = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            if (
              (dx || dy || dz) &&
              this.cells.has(`${x + dx},${y + dy},${z + dz}`)
            )
              neighbors++;
      // A repeated voxel is stable; a dense, adjacent surface patch is also
      // stable even if its individual samples were only seen once while moving.
      return p.hits >= 2 || neighbors >= 4;
    });
  }
}
