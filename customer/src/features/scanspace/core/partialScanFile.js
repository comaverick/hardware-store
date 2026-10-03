import { MAX_SCAN_ARRAY_BYTES, MAX_SCAN_MESH_BYTES } from "./textureDetail.js";
import { sanitizeCaptureDiagnostics } from "./captureExperience.js";
import { sanitizeScanCustomization } from "./scanCustomization.js";
import { getScanDesignSurfaces, validScanDesignSurfaces, scanDesignByteLength,
  SCAN_DESIGN_SURFACE_VERSION, SCAN_DESIGN_ALGORITHM_VERSION } from "./scanDesignSurfaces.js";

export const SCAN_FILE_FORMAT = "scanspace-scan";
// Kept so exports created before the unified scan UI continue to open.
export const PARTIAL_SCAN_FORMAT = "scanspace-partial-surface";
export const MAX_SCAN_FILE_IMPORT_BYTES = 64 * 1024 * 1024;
export const MAX_PARTIAL_SCAN_IMPORT_BYTES = MAX_SCAN_FILE_IMPORT_BYTES;

const MAX_ARRAY_BYTES = MAX_SCAN_ARRAY_BYTES;
// Base64 adds about one third to the binary size. Keeping portable mesh data
// below this threshold leaves ample room for the point cloud and JSON metadata.
const MAX_PORTABLE_MESH_BYTES = MAX_SCAN_MESH_BYTES;
const ARRAY_TYPES = {
  f32: Float32Array,
  u8: Uint8Array,
  u32: Uint32Array,
};
const RAW_CAPTURE_VERSION = 1;
const MAX_RAW_KEYFRAMES = 80;
const MAX_RAW_IMAGE_BYTES = 16 * 1024 * 1024;

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

const RAW_FRAME_ARRAYS = [
  ["depths", "f32", true],
  ["positions", "f32", true],
  ["colors", "u8", true],
  ["colorMask", "u8", true],
  ["projectionMatrix", "f32", true],
  ["transformMatrix", "f32", true],
  ["viewProjectionMatrix", "f32", false],
  ["viewTransformMatrix", "f32", false],
  ["nativeDepthUvTransform", "f32", false],
  ["camera", "f32", false],
  ["colorImage", "u8", false],
];

function encodeRawFrame(frame) {
  const value = {
    columns: Number(frame.columns) || 0,
    rows: Number(frame.rows) || 0,
    validCount: finite(frame.validCount, 0),
    coloredCount: finite(frame.coloredCount, 0),
    tracking: frame.tracking !== false,
    textureOnly: frame.textureOnly === true,
    timestamp: finite(frame.timestamp, 0),
    linearSpeed: finite(frame.linearSpeed, 0),
    angularSpeed: finite(frame.angularSpeed, 0),
    textureLinearSpeed: finite(frame.textureLinearSpeed, 0),
    textureAngularSpeed: finite(frame.textureAngularSpeed, 0),
    textureRefreshedAt: finite(frame.textureRefreshedAt, 0),
    depthQuality: finite(frame.depthQuality, 0),
    measuredDepthCount: finite(frame.measuredDepthCount, 0),
    colorSharpness: finite(frame.colorSharpness, 0),
    colorFocus: finite(frame.colorFocus, 0),
    colorClippedRatio: finite(frame.colorClippedRatio, 0),
    colorWidth: finite(frame.colorWidth, 0),
    colorHeight: finite(frame.colorHeight, 0),
    colorChannels: finite(frame.colorChannels, 4),
    geometryMode: String(frame.geometryMode || "view-aligned-v1"),
    captureId: finite(frame.captureId, 0),
    captureLinks: Array.isArray(frame.captureLinks) ? frame.captureLinks.filter(Number.isFinite).slice(0, 64) : [],
    nativeDepthWidth: finite(frame.nativeDepthWidth, 0),
    nativeDepthHeight: finite(frame.nativeDepthHeight, 0),
    depthType: ["raw", "smooth"].includes(frame.depthType) ? frame.depthType : "",
  };
  RAW_FRAME_ARRAYS.forEach(([name, type]) => {
    if (frame[name]?.length) value[name] = encodeArray(frame[name], type);
  });
  return value;
}

function validateRawPositions(positions, label) {
  // Missing depth samples are represented by NaN in the raw position grid.
  // Infinity and other non-finite values are never valid capture data.
  for (let index = 0; index < positions.length; index++)
    if (!Number.isFinite(positions[index]) && !Number.isNaN(positions[index]))
      throw new Error(`The scan file has invalid ${label} coordinates.`);
}

function decodeRawFrame(frame, label) {
  if (!frame || !Number.isInteger(frame.columns) || !Number.isInteger(frame.rows) ||
      frame.columns < 1 || frame.rows < 1 || frame.columns * frame.rows > 100000)
    throw new Error(`The scan file has invalid ${label} dimensions.`);
  const count = frame.columns * frame.rows;
  const decoded = {};
  RAW_FRAME_ARRAYS.forEach(([name, type, required]) => {
    if (!frame[name]) {
      if (required) throw new Error(`The scan file is missing raw ${label} ${name} data.`);
      decoded[name] = new ARRAY_TYPES[type]();
      return;
    }
    decoded[name] = decodeArray(frame[name], type, `raw ${label} ${name}`);
  });
  if (decoded.depths.length !== count || decoded.positions.length !== count * 3 ||
      decoded.colors.length !== count * 3 || decoded.colorMask.length !== count)
    throw new Error(`The scan file has inconsistent raw ${label} grid data.`);
  if (decoded.projectionMatrix.length !== 16 || decoded.transformMatrix.length !== 16)
    throw new Error(`The scan file has invalid raw ${label} camera matrices.`);
  if (decoded.viewProjectionMatrix.length && decoded.viewProjectionMatrix.length !== 16)
    throw new Error(`The scan file has invalid raw ${label} color matrix.`);
  if (decoded.viewTransformMatrix.length && decoded.viewTransformMatrix.length !== 16)
    throw new Error(`The scan file has invalid raw ${label} color transform.`);
  if (decoded.nativeDepthUvTransform.length && decoded.nativeDepthUvTransform.length !== 16)
    throw new Error(`The scan file has invalid raw ${label} depth transform.`);
  if (decoded.camera.length && decoded.camera.length !== 3)
    throw new Error(`The scan file has invalid raw ${label} camera position.`);
  validateRawPositions(decoded.positions, `raw ${label}`);
  const colorWidth = Number(frame.colorWidth) || 0;
  const colorHeight = Number(frame.colorHeight) || 0;
  const colorChannels = Number(frame.colorChannels) || 4;
  if (decoded.colorImage.length) {
    if (!Number.isInteger(colorWidth) || !Number.isInteger(colorHeight) ||
        !Number.isInteger(colorChannels) || colorWidth < 1 || colorHeight < 1 ||
        colorChannels < 3 || colorChannels > 4 ||
        colorWidth * colorHeight * colorChannels !== decoded.colorImage.length ||
        decoded.colorImage.byteLength > MAX_RAW_IMAGE_BYTES)
      throw new Error(`The scan file has invalid raw ${label} image data.`);
  }
  return {
    ...decoded,
    columns: frame.columns,
    rows: frame.rows,
    validCount: Math.max(0, Math.min(count, finite(frame.validCount, count))),
    coloredCount: Math.max(0, Math.min(count, finite(frame.coloredCount, 0))),
    tracking: frame.tracking !== false,
    textureOnly: frame.textureOnly === true,
    timestamp: finite(frame.timestamp, 0),
    linearSpeed: finite(frame.linearSpeed, 0),
    angularSpeed: finite(frame.angularSpeed, 0),
    textureLinearSpeed: finite(frame.textureLinearSpeed, 0),
    textureAngularSpeed: finite(frame.textureAngularSpeed, 0),
    textureRefreshedAt: finite(frame.textureRefreshedAt, 0),
    depthQuality: finite(frame.depthQuality, 0),
    measuredDepthCount: finite(frame.measuredDepthCount, 0),
    colorSharpness: finite(frame.colorSharpness, 0),
    colorFocus: finite(frame.colorFocus, 0),
    colorClippedRatio: Math.max(0, Math.min(1, finite(frame.colorClippedRatio, 0))),
    colorWidth,
    colorHeight,
    colorChannels,
    geometryMode: String(frame.geometryMode || "view-aligned-v1"),
    captureId: finite(frame.captureId, 0),
    captureLinks: Array.isArray(frame.captureLinks) ? frame.captureLinks.filter(Number.isFinite).slice(0, 64) : [],
    nativeDepthWidth: Math.max(0, Math.min(8192, finite(frame.nativeDepthWidth, 0))),
    nativeDepthHeight: Math.max(0, Math.min(8192, finite(frame.nativeDepthHeight, 0))),
    depthType: ["raw", "smooth"].includes(frame.depthType) ? frame.depthType : "",
    viewProjectionMatrix: decoded.viewProjectionMatrix.length
      ? decoded.viewProjectionMatrix : new Float32Array(decoded.projectionMatrix),
    viewTransformMatrix: decoded.viewTransformMatrix.length
      ? decoded.viewTransformMatrix : new Float32Array(decoded.transformMatrix),
    nativeDepthUvTransform: decoded.nativeDepthUvTransform,
    camera: decoded.camera.length
      ? decoded.camera : new Float32Array(decoded.transformMatrix.slice(12, 15)),
    colorImage: decoded.colorImage.length ? decoded.colorImage : null,
  };
}

function rawStats(stats) {
  const result = {};
  Object.entries(stats || {}).forEach(([name, value]) => {
    if (name === "fusion") return;
    if (["string", "number", "boolean"].includes(typeof value)) result[name] = value;
    else if (Array.isArray(value) && value.length <= 64 && value.every((item) =>
      ["boolean", "number", "string"].includes(typeof item))) result[name] = value.slice();
  });
  const adaptive = stats?.adaptiveCapture;
  if (adaptive && typeof adaptive === "object") {
    const numeric = ["version", "frameCount", "pendingCount", "recoveries", "promoted", "expired", "removed", "capacityStops",
      "pendingAgeDrops", "pendingCapacityDrops", "pendingRedundantDrops", "pendingConflictDrops", "pendingResetDrops"];
    const regions = (Array.isArray(adaptive.coverage?.regions) ? adaptive.coverage.regions : []).slice(0, 3)
      .filter(region => ["lower", "middle", "upper"].includes(region?.id)).map(region => ({
        id: region.id, observed: Math.max(0, finite(region.observed)), confirmed: Math.max(0, finite(region.confirmed)),
        ratio: Math.max(0, Math.min(1, finite(region.ratio))),
      }));
    result.adaptiveCapture = {
      ...Object.fromEntries(numeric.map(name => [name, Math.max(0, finite(adaptive[name]))])),
      state: ["starting", "tracking", "checking", "recovering"].includes(adaptive.state) ? adaptive.state : "starting",
      reason: String(adaptive.reason || "").slice(0, 80), connected: adaptive.connected === true,
      validationMode: adaptive.validationMode === "xr-tracking" ? "xr-tracking" : "depth-overlap",
      capacityReached: adaptive.capacityReached === true,
      coverage: { observed: Math.max(0, finite(adaptive.coverage?.observed)),
        confirmed: Math.max(0, finite(adaptive.coverage?.confirmed)),
        ratio: Math.max(0, Math.min(1, finite(adaptive.coverage?.ratio))), regions },
    };
  }
  if (stats?.captureDiagnostics) result.captureDiagnostics = sanitizeCaptureDiagnostics(stats.captureDiagnostics);
  return result;
}

function encodeRawCapture(capture) {
  const keyframes = Array.isArray(capture?.keyframes) ? capture.keyframes : [];
  const textureKeyframes = Array.isArray(capture?.textureKeyframes)
    ? capture.textureKeyframes : [];
  if (!keyframes.length || keyframes.length + textureKeyframes.length > MAX_RAW_KEYFRAMES)
    throw new Error("This raw scan does not contain a valid bounded RGB-D capture.");
  return {
    version: RAW_CAPTURE_VERSION,
    coordinateMode: "view-aligned-v1",
    floorY: Number.isFinite(capture.floorY) ? capture.floorY : null,
    observer: capture.observer || null,
    maxTextureSize: finite(capture.maxTextureSize, 4096),
    stats: rawStats(capture.stats),
    keyframes: keyframes.map(encodeRawFrame),
    textureKeyframes: textureKeyframes.map(encodeRawFrame),
  };
}

function decodeRawCapture(value) {
  if (!value || value.version !== RAW_CAPTURE_VERSION ||
      !Array.isArray(value.keyframes) || !value.keyframes.length ||
      value.keyframes.length + (value.textureKeyframes?.length || 0) > MAX_RAW_KEYFRAMES)
    throw new Error("The scan file has an invalid raw RGB-D capture.");
  return {
    version: RAW_CAPTURE_VERSION,
    coordinateMode: value.coordinateMode || "view-aligned-v1",
    floorY: Number.isFinite(Number(value.floorY)) ? Number(value.floorY) : undefined,
    observer: value.observer || undefined,
    maxTextureSize: Math.max(64, Math.min(16384, finite(value.maxTextureSize, 4096))),
    stats: rawStats(value.stats),
    keyframes: value.keyframes.map((frame, index) => decodeRawFrame(frame, `keyframe ${index}`)),
    textureKeyframes: (value.textureKeyframes || []).map((frame, index) =>
      decodeRawFrame(frame, `texture keyframe ${index}`)),
  };
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
    for (let channel = 0; channel < 3; channel++)
      colors[vertex * 3 + channel] = Math.round(srgbByteToLinearByte(texture.data[source + channel]) * original[vertex * 3 + channel] / 255);
  }
  return colors;
}

function encodeMesh(mesh) {
  if (!mesh) return null;
  mesh = portableTextureMesh(mesh);
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
    observedSideOriented: !!mesh.observedSideOriented,
    surfaceRepair: safeSurfaceRepair(mesh.surfaceRepair),
    designSurfaces: encodeDesignSurfaces(mesh),
  };
  if (mesh.estimatedTriangleMask?.length) value.estimatedTriangleMask = encodeArray(mesh.estimatedTriangleMask, "u8");
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
  const arrays = [mesh.positions, mesh.normals, mesh.indices, mesh.estimatedTriangleMask].filter(Boolean);
  return arrays.reduce((total, array) => total + array.byteLength,
    mesh.positions.length + scanDesignByteLength(getScanDesignSurfaces(mesh)));
}

function canIncludeMesh(mesh) {
  if (!mesh?.positions || !mesh?.indices) return false;
  const arrays = [mesh.positions, mesh.normals, mesh.indices, mesh.estimatedTriangleMask].filter(Boolean);
  const colorBytes = mesh.positions.length;
  return (
    arrays.every((array) => array.byteLength <= MAX_ARRAY_BYTES) &&
    colorBytes <= MAX_ARRAY_BYTES &&
    arrays.reduce((total, array) => total + array.byteLength, colorBytes) <=
      MAX_PORTABLE_MESH_BYTES - scanDesignByteLength(getScanDesignSurfaces(mesh))
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

// Reserve space for preparation inside the existing portable budget. A small
// atlas downsample is preferable to throwing away all furniture photographs.
// This affects an export copy only; the displayed/source atlas stays intact.
function portableTextureMesh(mesh) {
  if (!getScanDesignSurfaces(mesh) || canIncludeTexture(mesh) || !canIncludeMesh(mesh) ||
      !mesh.uvs || !mesh.texture?.data) return mesh;
  const available = MAX_PORTABLE_MESH_BYTES - baseMeshBytes(mesh) - mesh.uvs.byteLength;
  if (available < 16384) return mesh;
  const original = mesh.texture, scale = Math.min(1, Math.sqrt(available / original.data.byteLength));
  const width = Math.max(1, Math.floor(original.width * scale)), height = Math.max(1, Math.floor(original.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(original.width - 1, Math.floor((x + .5) * original.width / width));
    const sy = Math.min(original.height - 1, Math.floor((y + .5) * original.height / height));
    const index = (sy * original.width + sx) * 4;
    data.set(original.data.subarray(index, index + 4), (y * width + x) * 4);
  }
  return { ...mesh, texture: { width, height, data } };
}

const DESIGN_GEOMETRY_ARRAYS = [["positions", "f32"], ["normals", "f32"], ["uvs", "f32"], ["indices", "u32"]];
function encodeDesignSurfaces(mesh) {
  const design = getScanDesignSurfaces(mesh);
  if (!design || !validScanDesignSurfaces(design, mesh)) return null;
  const encodeGeometry = value => Object.fromEntries(DESIGN_GEOMETRY_ARRAYS.map(([name, type]) => [name, encodeArray(value[name], type)]));
  return { version: design.version, sourceAlgorithmVersion: design.sourceAlgorithmVersion,
    mode: "estimated-planar-design-surface", sourceKey: design.sourceKey,
    removedSourceFaces: encodeArray(design.removedSourceFaces, "u8"),
    fragments: { ...encodeGeometry(design.fragments), colors: encodeArray(design.fragments.colors, "u8"),
      sourceFaces: encodeArray(design.fragments.sourceFaces, "u32"),
      estimatedTriangleMask: encodeArray(design.fragments.estimatedTriangleMask, "u8") },
    walls: design.walls.map(wall => ({ ...encodeGeometry(wall), id: wall.id, normal: wall.normal,
      offset: wall.offset, axes: wall.axes, cellSize: wall.cellSize, extent: wall.extent,
      area: wall.area, estimatedArea: wall.estimatedArea, componentCount: wall.componentCount,
      junctionVertexCount: wall.junctionVertexCount || 0,
      source: wall.source, supportingFrameIds: wall.supportingFrameIds,
      estimatedTriangleMask: encodeArray(wall.estimatedTriangleMask, "u8"),
      footprint: encodeArray(wall.footprint, "u8"), openingMask: encodeArray(wall.openingMask, "u8"),
      detailMask: encodeArray(wall.detailMask, "u8"), texture: {
        width: wall.texture.width, height: wall.texture.height, data: encodeArray(wall.texture.data, "u8"),
      } })), diagnostics: design.diagnostics };
}

function decodeDesignSurfaces(value, mesh) {
  if (value?.version !== SCAN_DESIGN_SURFACE_VERSION || !Array.isArray(value.walls) || value.walls.length > 8) return null;
  try {
    const decodeGeometry = source => Object.fromEntries(DESIGN_GEOMETRY_ARRAYS.map(([name, type]) =>
      [name, decodeArray(source[name], type, `design ${name}`)]));
    const fragments = { ...decodeGeometry(value.fragments),
      colors: decodeArray(value.fragments.colors, "u8", "design fragment colors"),
      sourceFaces: decodeArray(value.fragments.sourceFaces, "u32", "design fragment sources"),
      estimatedTriangleMask: decodeArray(value.fragments.estimatedTriangleMask, "u8", "design fragment estimates") };
    const walls = value.walls.map(source => {
      const geometry = decodeGeometry(source);
      return { ...geometry, colors: new Uint8Array(geometry.positions.length).fill(255),
        id: String(source.id || "").slice(0, 100), normal: source.normal, offset: source.offset,
        axes: source.axes, cellSize: source.cellSize, extent: source.extent,
        area: source.area, estimatedArea: source.estimatedArea, componentCount: source.componentCount,
        junctionVertexCount: Math.max(0, Math.min(geometry.positions.length / 3, Number(source.junctionVertexCount) || 0)),
        source: source.source === "independent-depth-footprint" ? source.source : "mesh-footprint",
        supportingFrameIds: Array.isArray(source.supportingFrameIds) ? source.supportingFrameIds.slice(0, 80) : [],
        estimatedTriangleMask: decodeArray(source.estimatedTriangleMask, "u8", "design estimates"),
        footprint: decodeArray(source.footprint, "u8", "design footprint"),
        openingMask: decodeArray(source.openingMask, "u8", "design openings"),
        detailMask: decodeArray(source.detailMask, "u8", "design photo details"),
        texture: { width: source.texture.width, height: source.texture.height,
          data: decodeArray(source.texture.data, "u8", "design photo") } };
    });
    const design = { version: SCAN_DESIGN_SURFACE_VERSION,
      sourceAlgorithmVersion: Number(value.sourceAlgorithmVersion) || SCAN_DESIGN_ALGORITHM_VERSION,
      mode: "estimated-planar-design-surface", sourceKey: value.sourceKey, walls, fragments,
      removedSourceFaces: decodeArray(value.removedSourceFaces, "u8", "design replacements"),
      diagnostics: { walls: walls.length, area: walls.reduce((sum, wall) => sum + wall.area, 0),
        estimatedArea: walls.reduce((sum, wall) => sum + wall.estimatedArea, 0), measuredGeometryChanged: false } };
    return validScanDesignSurfaces(design, mesh) ? design : null;
  } catch {
    // An optional damaged cache does not make the measured scan unreadable.
    return null;
  }
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
  const estimatedTriangleMask = mesh.estimatedTriangleMask
    ? decodeArray(mesh.estimatedTriangleMask, "u8", "mesh estimate") : null;
  if (!positions.length || positions.length % 3 || colors.length !== positions.length)
    throw new Error("The scan file has inconsistent mesh geometry.");
  if (
    indices.length % 3 ||
    (normals && normals.length !== positions.length) ||
    (uvs && uvs.length !== (positions.length / 3) * 2)
  )
    throw new Error("The scan file has inconsistent mesh geometry.");
  if (estimatedTriangleMask && (estimatedTriangleMask.length !== indices.length / 3 ||
    estimatedTriangleMask.some(value => value > 2)))
    throw new Error("The scan file has inconsistent mesh estimate data.");
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
  const decoded = {
    version: 3,
    kind: "portable-measured-mesh",
    positions,
    normals,
    colors,
    uvs,
    indices,
    ...(estimatedTriangleMask ? { estimatedTriangleMask } : {}),
    triangleCount: indices.length / 3,
    colorCoverage: finite(mesh.colorCoverage, 0),
    portableColors: !!mesh.portableColors,
    observedSideOriented: !!mesh.observedSideOriented,
    surfaceRepair: safeSurfaceRepair(mesh.surfaceRepair),
    texture,
    bounds,
    observer: safeObserver(mesh.observer, bounds),
  };
  decoded.designSurfaces = decodeDesignSurfaces(mesh.designSurfaces, decoded);
  return decoded;
}

function safeSurfaceRepair(value) {
  if (value?.mode !== "bounded-planar-estimate") return null;
  const repair = {
    mode: "bounded-planar-estimate",
    estimatedHoleCount: Math.max(0, Math.floor(finite(value.estimatedHoleCount, 0))),
    estimatedTriangles: Math.max(0, Math.floor(finite(value.estimatedTriangles, 0))),
    estimatedArea: Math.max(0, finite(value.estimatedArea, 0)),
    maxDiameterMeters: Math.max(0, finite(value.maxDiameterMeters, 0)),
  };
  for (const key of ['colorSupportedHoleCount', 'colorSupportedHoleArea',
    'maxColorSupportedDiameterMeters', 'colorBlendedTriangles', 'colorBlendedArea']) {
    if (Number.isFinite(value[key])) repair[key] = Math.max(0, value[key]);
  }
  return repair;
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
  const rawCapture = scan?.rawCapture;
  if (rawCapture?.keyframes?.length) {
    const encodedCapture = encodeRawCapture(rawCapture);
    const value = JSON.stringify({
      format: SCAN_FILE_FORMAT,
      version: 2,
      exportedAt: new Date().toISOString(),
      sourceType: "raw-rgbd-capture",
      scan: {
        name: String(scan.name || "ScanSpace scan").slice(0, 120),
        reason: String(scan.reason || "Captured measured surfaces.").slice(0, 500),
        pointCount: finite(scan.pointCount, 0),
        customization: sanitizeScanCustomization(scan.customization),
        captureQuality: scan.captureQuality || null,
        measuredGapWarning: !!scan.measuredGapWarning,
        measuredReviewWarning: safeReviewWarning(scan.measuredReviewWarning),
        fusionReason: scan.fusionReason
          ? String(scan.fusionReason).slice(0, 500)
          : null,
        // No mesh, atlas, UVs, or baked vertex colors are written for a raw
        // capture. The importer reconstructs these from the keyframes.
        rawCapture: encodedCapture,
      },
    });
    if (new Blob([value]).size > MAX_SCAN_FILE_IMPORT_BYTES)
      throw new Error("This raw scan is too large to export (maximum 64 MB).");
    return value;
  }
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
      customization: sanitizeScanCustomization(scan.customization),
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
    ![1, 2].includes(parsed?.version)
  )
    throw new Error("This is not a supported ScanSpace scan file.");
  const source = parsed.scan;
  if (parsed.version >= 2 || source?.rawCapture) {
    const rawCapture = decodeRawCapture(source?.rawCapture);
    return {
      version: 3,
      kind: "raw-rgbd-scan",
      imported: true,
      customization: sanitizeScanCustomization(source.customization),
      name: String(source.name || "Imported ScanSpace scan").slice(0, 120),
      walls: [],
      floorObserved: Number.isFinite(rawCapture.floorY),
      ceilingObserved: false,
      pointCount: finite(source.pointCount, 0),
      reason: String(source.reason || "Captured measured surfaces.").slice(0, 500),
      cloud: null,
      mesh: null,
      rawCapture,
      fusionMode: "raw-import",
      captureQuality: source.captureQuality || null,
      measuredGapWarning: !!source.measuredGapWarning,
      measuredReviewWarning: safeReviewWarning(source.measuredReviewWarning),
      fusionReason: source.fusionReason
        ? String(source.fusionReason).slice(0, 500)
        : null,
    };
  }
  const mesh = decodeMesh(source?.mesh);
  const cloud = decodeCloud(source?.cloud);
  if (!mesh && !cloud)
    throw new Error("This scan file does not contain measured geometry.");
  return {
    version: 2,
    kind: "validated-measured-surface",
    imported: true,
    customization: sanitizeScanCustomization(source.customization),
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
  link.download = `cdx-scanspace-scan-${new Date()
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
