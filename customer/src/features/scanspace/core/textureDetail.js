// Texture detail and memory policy are independent of surface reconstruction.
export const MAX_SCAN_ARRAY_BYTES = 32 * 1024 * 1024;
export const MAX_SCAN_MESH_BYTES = 36 * 1024 * 1024;

export function textureAtlasLayout(images, triangleCount = 0, maxTextureSize = 4096) {
  if (!images.length) return null;
  const columns = Math.ceil(Math.sqrt(images.length + 1));
  const rows = Math.ceil((images.length + 1) / columns);
  const padding = 4;
  // Expanded triangle: positions/normals 72, RGB 9, UV 24, indices 12 bytes.
  const budget = Math.min(MAX_SCAN_ARRAY_BYTES,
    MAX_SCAN_MESH_BYTES - triangleCount * 117 - 1024 * 1024);
  if (budget < columns * rows * 9 * 9 * 4) return null;
  const sourceWidth = Math.max(...images.map((frame) => frame.colorWidth));
  const sourceHeight = Math.max(...images.map((frame) => frame.colorHeight));
  const limit = Math.max(64, Math.min(4096, Number(maxTextureSize) || 4096));
  const dimensions = (scale) => {
    const tileWidth = Math.max(1, Math.floor(sourceWidth * scale));
    const tileHeight = Math.max(1, Math.floor(sourceHeight * scale));
    const strideX = tileWidth + 2 * padding, strideY = tileHeight + 2 * padding;
    return { tileWidth, tileHeight, strideX, strideY, width: columns * strideX,
      height: rows * strideY, columns, rows, padding };
  };
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2, value = dimensions(middle);
    if (value.width <= limit && value.height <= limit && value.width * value.height * 4 <= budget) low = middle;
    else high = middle;
  }
  // Avoid losing a pixel to binary-search rounding when native size fits.
  const full = dimensions(1);
  return full.width <= limit && full.height <= limit && full.width * full.height * 4 <= budget
    ? full : dimensions(low);
}

// Small cached patches, not a single pixel or the unrelated rest of a photo.
// This measures detail only; it never sharpens/resamples/moves the geometry.
export function buildTextureDetailGrid(frame) {
  const { colorWidth: width, colorHeight: height, colorImage: pixels } = frame;
  const channels = frame.colorChannels || 4, size = 8;
  const columns = Math.ceil(width / size), rows = Math.ceil(height / size);
  const focus = new Float32Array(columns * rows), detail = new Float32Array(focus.length);
  const counts = new Uint16Array(focus.length);
  const luminance = (x, y) => {
    const i = (y * width + x) * channels;
    return pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
  };
  for (let y = 1; y < height - 1; y += 2) for (let x = 1; x < width - 1; x += 2) {
    const id = Math.floor(y / size) * columns + Math.floor(x / size);
    const c = luminance(x, y), l = luminance(x - 1, y), r = luminance(x + 1, y);
    const a = luminance(x, y - 1), b = luminance(x, y + 1);
    if (c < 6 || c > 249) continue;
    focus[id] += Math.abs(c * 4 - l - r - a - b);
    detail[id] += (Math.abs(c - l) + Math.abs(c - r) + Math.abs(c - a) + Math.abs(c - b)) / 2;
    counts[id]++;
  }
  for (let i = 0; i < counts.length; i++) if (counts[i]) {
    focus[i] /= counts[i]; detail[i] /= counts[i];
  }
  return { focus, detail, columns, rows, size };
}

export function projectedPatchDetail(frame, projection) {
  const grid = frame.textureDetailGrid;
  if (!grid || !projection) return { focus: 0, detail: 0 };
  const x = Math.max(0, Math.min(grid.columns - 1, Math.floor(projection.u * (frame.colorWidth - 1) / grid.size)));
  const y = Math.max(0, Math.min(grid.rows - 1, Math.floor((1 - projection.v) * (frame.colorHeight - 1) / grid.size)));
  const id = y * grid.columns + x;
  return { focus: grid.focus[id], detail: grid.detail[id] };
}

// All seam/coherence passes only see these candidates. They cannot trade away
// clearly visible local detail just to keep the same camera across a wall.
export function detailPreservingCandidates(candidates) {
  return candidates.filter((candidate) => !candidates.some((other) =>
    other !== candidate && other.localFocus >= 4 &&
    other.localFocus > candidate.localFocus * 1.8 &&
    other.localFocus - candidate.localFocus > 2.5 &&
    other.pixelDensity >= candidate.pixelDensity * 0.8 &&
    other.localDetail >= candidate.localDetail * 0.8));
}
