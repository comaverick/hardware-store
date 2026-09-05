import { Matrix4, Vector3 } from "three";

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
      if (!Number.isFinite(meters) || meters < 0.25 || meters > 8) continue;
      ray.set(u * 2 - 1, 1 - v * 2, 0.5).applyMatrix4(inverse);
      if (ray.z >= -0.00001) continue;
      ray.multiplyScalar(meters / -ray.z).applyMatrix4(pose);
      if (![ray.x, ray.y, ray.z].every(Number.isFinite)) continue;
      const color = colorAt?.(u, v);
      points.push({ x: ray.x, y: ray.y, z: ray.z, color });
    }
  return points;
}

export class VoxelCloud {
  constructor(size = 0.045, limit = 100000) {
    this.size = size;
    this.limit = limit;
    this.cells = new Map();
    this.full = false;
  }
  key(p) {
    return `${Math.floor(p.x / this.size)},${Math.floor(p.y / this.size)},${Math.floor(p.z / this.size)}`;
  }
  add(points, frameId) {
    for (const p of points) {
      if (![p.x, p.y, p.z].every((v) => Number.isFinite(v) && Math.abs(v) < 60))
        continue;
      const key = this.key(p),
        previous = this.cells.get(key);
      if (previous) {
        if (previous.frameId === frameId) continue;
        previous.frameId = frameId;
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
      else this.full = true;
    }
  }
  values(filtered = false) {
    const all = [...this.cells.values()];
    if (!filtered) return all;
    return all.filter((p) => {
      if (p.hits < 2) return false;
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
      return neighbors >= 2;
    });
  }
}
