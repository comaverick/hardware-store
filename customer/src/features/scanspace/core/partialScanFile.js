export const SCAN_FILE_FORMAT = "scanspace-scan";
// Kept so exports created before the unified scan UI continue to open.
export const PARTIAL_SCAN_FORMAT = "scanspace-partial-surface";
export const MAX_SCAN_FILE_IMPORT_BYTES = 64 * 1024 * 1024;
export const MAX_PARTIAL_SCAN_IMPORT_BYTES = MAX_SCAN_FILE_IMPORT_BYTES;

const MAX_ARRAY_BYTES = 32 * 1024 * 1024;
// Base64 adds about one third to the binary size. Keeping portable mesh data
// below this threshold leaves ample room for the point cloud and JSON metadata.
const MAX_PORTABLE_MESH_BYTES = 36 * 1024 * 1024;
const ARRAY_TYPES = {
  f32: Float32Array,
  u8: Uint8Array,
  u32: Uint32Array,
};

function encodeArray(value, type) {
  if (!value) return null;
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { type, data: btoa(binary) };
}

function decodeArray(value, expectedType, label) {
  if (!value || value.type !== expectedType || typeof value.data !== "string")
    throw new Error(`The scan file has invalid ${label} data.`);
  let binary;
  try {
    binary = atob(value.data);
  } catch {
    throw new Error(`The scan file has damaged ${label} data.`);
  }
  const Type = ARRAY_TYPES[expectedType];
  if (
    binary.length > MAX_ARRAY_BYTES ||
    binary.length % Type.BYTES_PER_ELEMENT !== 0
  )
    throw new Error(`The scan file has invalid ${label} data.`);
  const bytes = new Uint8Array(binary.length);
  for (let offset = 0; offset < binary.length; offset += 32768) {
    const end = Math.min(offset + 32768, binary.length);
    for (let index = offset; index < end; index++)
      bytes[index] = binary.charCodeAt(index);
  }
  return new Type(bytes.buffer);
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function validateFiniteArray(value, label) {
  for (let index = 0; index < value.length; index++)
    if (!Number.isFinite(value[index]))
      throw new Error(`The scan file has invalid ${label} coordinates.`);
}

function boundsFromPositions(positions) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let index = 0; index < positions.length; index += 3) {
    min.x = Math.min(min.x, positions[index]);
    min.y = Math.min(min.y, positions[index + 1]);
    min.z = Math.min(min.z, positions[index + 2]);
    max.x = Math.max(max.x, positions[index]);
    max.y = Math.max(max.y, positions[index + 1]);
    max.z = Math.max(max.z, positions[index + 2]);
  }
  return { min, max };
}

function safeObserver(observer, bounds) {
  return {
    x: finite(observer?.x, (bounds.min.x + bounds.max.x) / 2),
    y: finite(observer?.y, 1.6),
    z: finite(observer?.z, (bounds.min.z + bounds.max.z) / 2),
  };
}

function srgbByteToLinearByte(value) {
  const channel = Math.max(0, Math.min(255, Number(value) || 0)) / 255;
  const linear =
    channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  return Math.round(linear * 255);
}

function bakedMeshColors(mesh) {
  const original = mesh.colors
    ? new Uint8Array(mesh.colors.buffer, mesh.colors.byteOffset, mesh.colors.byteLength)
    : new Uint8Array(mesh.positions.length).fill(210);
  const texture = mesh.texture;
  if (!texture?.data || !mesh.uvs || !texture.width || !texture.height)
    return new Uint8Array(original);
  const colors = new Uint8Array(original);
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
    const u = Math.max(0, Math.min(1, mesh.uvs[vertex * 2]));
    const v = Math.max(0, Math.min(1, mesh.uvs[vertex * 2 + 1]));
    const x = Math.min(texture.width - 1, Math.round(u * (texture.width - 1)));
    const y = Math.min(texture.height - 1, Math.round(v * (texture.height - 1)));
    const source = (y * texture.width + x) * 4;
    if ((texture.data[source + 3] ?? 255) === 0) continue;
    colors[vertex * 3] = srgbByteToLinearByte(texture.data[source]);
    colors[vertex * 3 + 1] = srgbByteToLinearByte(texture.data[source + 1]);
    colors[vertex * 3 + 2] = srgbByteToLinearByte(texture.data[source + 2]);
  }
  return colors;
}

function encodeMesh(mesh) {
  if (!mesh) return null;
  const includeTexture = canIncludeTexture(mesh);
  const colors = includeTexture
    ? mesh.colors
      ? new Uint8Array(
          mesh.colors.buffer,
          mesh.colors.byteOffset,
          mesh.colors.byteLength,
        )
      : new Uint8Array(mesh.positions.length).fill(255)
    : bakedMeshColors(mesh);
  const value = {
    positions: encodeArray(mesh.positions, "f32"),
    normals: encodeArray(mesh.normals, "f32"),
    colors: encodeArray(colors, "u8"),
    indices: encodeArray(mesh.indices, "u32"),
    colorCoverage: finite(
      mesh.textureCoverage ?? mesh.colorCoverage,
      0,
    ),
    observer: mesh.observer || null,
    // A texture-backed export renders through the same camera atlas as the
    // live result. Only mark the mesh as portable when that atlas had to be
    // omitted and its sRGB pixels were baked into linear vertex colors.
    portableColors: Boolean(mesh.texture?.data && !includeTexture),
  };
  if (includeTexture) {
    value.uvs = encodeArray(mesh.uvs, "f32");
    value.texture = {
      data: encodeArray(mesh.texture.data, "u8"),
      width: mesh.texture.width,
      height: mesh.texture.height,
    };
  }
  return value;
}

function baseMeshBytes(mesh) {
  if (!mesh?.positions || !mesh?.indices) return Infinity;
  const arrays = [mesh.positions, mesh.normals, mesh.indices].filter(Boolean);
  return arrays.reduce((total, array) => total + array.byteLength, mesh.positions.length);
}

function canIncludeMesh(mesh) {
  if (!mesh?.positions || !mesh?.indices) return false;
  const arrays = [mesh.positions, mesh.normals, mesh.indices].filter(Boolean);
  const colorBytes = mesh.positions.length;
  return (
    arrays.every((array) => array.byteLength <= MAX_ARRAY_BYTES) &&
    colorBytes <= MAX_ARRAY_BYTES &&
    arrays.reduce((total, array) => total + array.byteLength, colorBytes) <=
      MAX_PORTABLE_MESH_BYTES
  );
}

function canIncludeTexture(mesh) {
  const texture = mesh?.texture;
  const width = Number(texture?.width);
  const height = Number(texture?.height);
  const data = texture?.data;
  if (
    !canIncludeMesh(mesh) ||
    !mesh.uvs ||
    mesh.uvs.length !== (mesh.positions?.length || 0) / 3 * 2 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    !data ||
    data.byteLength !== width * height * 4
  )
    return false;
  return (
    mesh.uvs.byteLength <= MAX_ARRAY_BYTES &&
    data.byteLength <= MAX_ARRAY_BYTES &&
    baseMeshBytes(mesh) + mesh.uvs.byteLength + data.byteLength <=
      MAX_PORTABLE_MESH_BYTES
  );
}

function encodeCloud(cloud) {
  if (!cloud) return null;
  return {
    positions: encodeArray(cloud.positions, "f32"),
    colors: encodeArray(cloud.colors, "u8"),
    colorCoverage: finite(cloud.colorCoverage, 0),
    pointSize: finite(cloud.pointSize, 0.018),
    floorY: finite(cloud.floorY, 0),
    observer: cloud.observer || null,
  };
}

function decodeMesh(mesh) {
  if (!mesh) return null;
  const positions = decodeArray(mesh.positions, "f32", "mesh position");
  const colors = decodeArray(mesh.colors, "u8", "mesh color");
  const indices = decodeArray(mesh.indices, "u32", "mesh index");
  const normals = mesh.normals
    ? decodeArray(mesh.normals, "f32", "mesh normal")
    : null;
  const uvs = mesh.uvs ? decodeArray(mesh.uvs, "f32", "mesh UV") : null;
  if (!positions.length || positions.length % 3 || colors.length !== positions.length)
    throw new Error("The scan file has inconsistent mesh geometry.");
  if (
    indices.length % 3 ||
    (normals && normals.length !== positions.length) ||
    (uvs && uvs.length !== (positions.length / 3) * 2)
  )
    throw new Error("The scan file has inconsistent mesh geometry.");
  validateFiniteArray(positions, "mesh");
  if (normals) validateFiniteArray(normals, "mesh normal");
  if (uvs) validateFiniteArray(uvs, "mesh UV");
  const vertexCount = positions.length / 3;
  for (let index = 0; index < indices.length; index++)
    if (indices[index] >= vertexCount)
      throw new Error("The scan file contains an invalid mesh index.");
  let texture = null;
  if (mesh.texture) {
    const width = Number(mesh.texture.width);
    const height = Number(mesh.texture.height);
    if (
      !uvs ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192
    )
      throw new Error("The scan file has invalid mesh texture data.");
    const data = decodeArray(mesh.texture.data, "u8", "mesh texture");
    if (data.length !== width * height * 4)
      throw new Error("The scan file has invalid mesh texture data.");
    texture = { data, width, height };
  }
  const bounds = boundsFromPositions(positions);
  return {
    version: 3,
    kind: "portable-measured-mesh",
    positions,
    normals,
    colors,
    uvs,
    indices,
    triangleCount: indices.length / 3,
    colorCoverage: finite(mesh.colorCoverage, 0),
    portableColors: !!mesh.portableColors,
    texture,
    bounds,
    observer: safeObserver(mesh.observer, bounds),
  };
}

function decodeCloud(cloud) {
  if (!cloud) return null;
  const positions = decodeArray(cloud.positions, "f32", "point position");
  const colors = decodeArray(cloud.colors, "u8", "point color");
  if (!positions.length || positions.length % 3 || colors.length !== positions.length)
    throw new Error("The scan file has inconsistent point-cloud data.");
  validateFiniteArray(positions, "point-cloud");
  const bounds = boundsFromPositions(positions);
  return {
    version: 1,
    positions,
    colors,
    count: positions.length / 3,
    sourcePointCount: positions.length / 3,
    capturedColorCount: positions.length / 3,
    colorCoverage: finite(cloud.colorCoverage, 0),
    pointSize: Math.max(0.002, Math.min(0.08, finite(cloud.pointSize, 0.018))),
    floorY: finite(cloud.floorY, bounds.min.y),
    bounds,
    observer: safeObserver(cloud.observer, bounds),
  };
}

function safeReviewWarning(warning) {
  if (!warning) return null;
  return {
    issues: Array.isArray(warning.issues)
      ? warning.issues.slice(0, 12).map((issue, index) => ({
          code: String(issue?.code || `issue-${index}`).slice(0, 80),
          message: String(issue?.message || "Scan quality issue").slice(0, 500),
        }))
      : [],
  };
}

export function looksLikeScanFile(beginning = "") {
  return /^\s*\{\s*"format"\s*:\s*"scanspace-(?:scan|partial-surface)"/i.test(
    beginning,
  );
}

export const looksLikePartialScan = looksLikeScanFile;

export function serializePartialScan(scan) {
  if (!scan?.mesh && !scan?.cloud)
    throw new Error("There is no measured surface to export.");
  const mesh = canIncludeMesh(scan.mesh) ? encodeMesh(scan.mesh) : null;
  if (!mesh && !scan.cloud)
    throw new Error(
      "This measured mesh is too large to export without its point-cloud preview.",
    );
  return JSON.stringify({
    format: SCAN_FILE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    scan: {
      name: String(scan.name || "ScanSpace scan").slice(0, 120),
      reason: String(scan.reason || "Captured measured surfaces.").slice(0, 500),
      pointCount: finite(scan.pointCount ?? scan.cloud?.count, 0),
      captureQuality: scan.captureQuality || null,
      measuredGapWarning: !!scan.measuredGapWarning,
      measuredReviewWarning: safeReviewWarning(scan.measuredReviewWarning),
      fusionReason: scan.fusionReason
        ? String(scan.fusionReason).slice(0, 500)
        : null,
      mesh,
      cloud: encodeCloud(scan.cloud),
    },
  });
}

export function parsePartialScan(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("This scan file is not valid JSON.");
  }
  if (
    ![SCAN_FILE_FORMAT, PARTIAL_SCAN_FORMAT].includes(parsed?.format) ||
    parsed?.version !== 1
  )
    throw new Error("This is not a supported ScanSpace scan file.");
  const source = parsed.scan;
  const mesh = decodeMesh(source?.mesh);
  const cloud = decodeCloud(source?.cloud);
  if (!mesh && !cloud)
    throw new Error("This scan file does not contain measured geometry.");
  return {
    version: 2,
    kind: "validated-measured-surface",
    imported: true,
    name: String(source.name || "Imported ScanSpace scan").slice(0, 120),
    walls: [],
    floorObserved: false,
    ceilingObserved: false,
    pointCount: finite(source.pointCount ?? cloud?.count, cloud?.count || 0),
    reason: String(source.reason || "Captured measured surfaces.").slice(0, 500),
    cloud,
    mesh,
    fusionMode: "portable-import",
    captureQuality: source.captureQuality || null,
    measuredGapWarning: !!source.measuredGapWarning,
    measuredReviewWarning: safeReviewWarning(source.measuredReviewWarning),
    fusionReason: source.fusionReason
      ? String(source.fusionReason).slice(0, 500)
      : null,
  };
}

export function downloadPartialScan(scan) {
  const value = serializePartialScan(scan);
  const url = URL.createObjectURL(
    new Blob([value], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `scanspace-scan-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Public names for the unified scan flow. The older names above remain as
// compatibility aliases for files and callers created before this UI change.
export const serializeScan = serializePartialScan;
export const parseScanFile = parsePartialScan;
export const downloadScan = downloadPartialScan;
