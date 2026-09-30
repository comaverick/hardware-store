// Review diagnostics stay in memory until the user downloads them.
// Snapshot before worker transfer detaches the live typed arrays. Camera photos
// are omitted to bound memory; per-point RGB is sufficient for geometry replay.
export function captureDebugEnabled() {
  return typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("scanspaceDebug") === "1";
}

const RUNTIME_FIELDS = [
  "closed", "paused", "originChanged", "tracking", "nativeDepthActive", "sessionVisibility",
  "contextLost", "depthUsage", "depthType", "format", "dimensions", "xrFrames", "depthReads",
  "depthFrames", "totalDepthMisses", "depthReadErrors", "depthResumeAttempts", "depthResumeErrors",
  "depthRecoveryState", "depthFailureKind", "depthFailureMs", "depthRecoveries", "frameQuality",
  "fusionKeyframes", "acceptedDepthFrames", "rejectedDepthFrames", "captureIntervalMs",
  "captureProcessingMs", "geometryProcessingMs", "colorReadMs", "poseOverlapRatio",
  "poseMedianResidual", "poseUpperResidual", "gateLinearSpeed", "gateAngularSpeed",
  "maxLinearSpeed", "maxAngularSpeed",
];
const diagnosticValue = (value) => typeof value === "string" ? value.slice(0, 240) :
  typeof value === "boolean" ? value : Number.isFinite(value) ? value : null;

// Opt-in local runtime evidence, including failures before any geometry is
// saved. Never retain XR objects, images, positions, or an unbounded history.
export class CaptureRuntimeDiagnostics {
  constructor() {
    this.buildId = process.env.REACT_APP_VERCEL_GIT_COMMIT_SHA ||
      process.env.REACT_APP_GIT_SHA || "local-or-unknown";
    this.browser = typeof navigator === "undefined" ? "unknown" : navigator.userAgent;
    this.state = {};
    this.features = [];
    this.events = [];
    this.errorCount = 0;
  }
  update(stats) {
    this.state = Object.fromEntries(RUNTIME_FIELDS.map(key => [key, diagnosticValue(stats[key])]));
    this.features = (stats.features || []).slice(0, 16).map(value => String(value).slice(0, 64));
  }
  record(type, timestamp, details = {}) {
    this.startedAt ??= timestamp;
    if (type === "error") this.errorCount++;
    const event = { type, elapsedMs: Math.max(0, timestamp - this.startedAt) };
    for (const key of ["reason", "stage", "name", "message", "accepted", "committed"])
      if (details[key] !== undefined) event[key] = diagnosticValue(details[key]);
    this.events.push(event);
    if (this.events.length > 48) this.events.shift();
  }
  snapshot() {
    return { version: 1, kind: "scanspace-runtime", buildId: this.buildId,
      browser: this.browser, features: this.features.slice(), state: { ...this.state },
      errorCount: this.errorCount, events: this.events.map(event => ({ ...event })) };
  }
}

export function installCaptureRuntimeDebug(diagnostics) {
  // This handle retains only diagnostics, so cancellation can release the
  // scanner's GPU/geometry while the last failure remains available to inspect.
  window.scanspaceDebug = {
    snapshot: () => diagnostics.snapshot(),
    download: () => downloadCaptureBlob(
      new Blob([JSON.stringify(diagnostics.snapshot())], { type: "application/json" }),
      `cdx-scanspace-runtime-${Date.now()}.json`,
    ),
  };
}

export function snapshotDepthCapture(raw) {
  const header = {
    version: 4,
    geometrySchemaVersion: 1,
    coordinateMode: "view-aligned-v1",
    buildId:
      process.env.REACT_APP_VERCEL_GIT_COMMIT_SHA ||
      process.env.REACT_APP_GIT_SHA ||
      "local-or-unknown",
    browser:
      typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    orientation:
      typeof window === "undefined"
        ? "unknown"
        : window.screen.orientation?.type ||
          `${window.screen.width || 0}x${window.screen.height || 0}`,
    createdAt: new Date().toISOString(),
    floorY: raw.floorY,
    observer: raw.observer,
    stats: raw.stats,
    cameraImagesIncluded: false,
  };
  const parts = [JSON.stringify(header).slice(0, -1), ',"keyframes":['];
  raw.keyframes.forEach((frame, index) => {
    if (index) parts.push(",");
    parts.push(JSON.stringify({
      columns: frame.columns,
      rows: frame.rows,
      validCount: frame.validCount,
      coloredCount: frame.coloredCount,
      tracking: frame.tracking,
      timestamp: frame.timestamp,
      captureId: frame.captureId,
      captureLinks: frame.captureLinks,
      depthType: frame.depthType,
      linearSpeed: frame.linearSpeed || 0,
      angularSpeed: frame.angularSpeed || 0,
      depthQuality: frame.depthQuality || 0,
      measuredDepthCount: frame.measuredDepthCount || 0,
      colorSharpness: frame.colorSharpness || 0,
      colorClippedRatio: frame.colorClippedRatio || 0,
      geometryMode: frame.geometryMode,
      nativeDepthWidth: frame.nativeDepthWidth,
      nativeDepthHeight: frame.nativeDepthHeight,
      nativeDepthUvTransform: Array.from(
        frame.nativeDepthUvTransform || [],
      ),
      depths: Array.from(frame.depths),
      positions: Array.from(frame.positions),
      colors: Array.from(frame.colors),
      colorMask: Array.from(frame.colorMask),
      projectionMatrix: Array.from(frame.projectionMatrix),
      transformMatrix: Array.from(frame.transformMatrix),
      viewProjectionMatrix: Array.from(
        frame.viewProjectionMatrix || frame.projectionMatrix,
      ),
      viewTransformMatrix: Array.from(
        frame.viewTransformMatrix || frame.transformMatrix,
      ),
      camera: Array.from(frame.camera || []),
    }));
  });
  parts.push("]}");
  return new Blob(parts, { type: "application/json" });
}

export function downloadDepthCapture(blob, diagnostics = null) {
  const file = new Blob([
    '{"capture":', blob, ',"diagnostics":', JSON.stringify(diagnostics), "}",
  ], { type: "application/json" });
  downloadCaptureBlob(file, `cdx-scanspace-debug-${Date.now()}.json`);
}

function downloadCaptureBlob(file, filename) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function restoreDepthCapture(payload) {
  const capture = payload.capture || payload;
  if (!Array.isArray(capture.keyframes) || capture.keyframes.length > 64)
    throw new Error("Expected a ScanSpace capture with at most 64 keyframes.");
  const keyframes = capture.keyframes.map((frame) => {
    const count = frame.columns * frame.rows;
    if (!Number.isInteger(count) || count < 1 || count > 100000 ||
        frame.depths?.length !== count || frame.positions?.length !== count * 3 ||
        frame.projectionMatrix?.length !== 16 || frame.transformMatrix?.length !== 16)
      throw new Error("Invalid keyframe dimensions or camera matrices.");
    return {
      ...frame,
      geometryMode:
        frame.geometryMode ||
        (frame.depthUvs?.length === count * 2
          ? "legacy-depth-uv-ambiguous"
          : "view-aligned-legacy"),
      legacyGeometryAmbiguous:
        !frame.geometryMode && frame.depthUvs?.length === count * 2,
      nativeDepthWidth: Number(frame.nativeDepthWidth) || 0,
      nativeDepthHeight: Number(frame.nativeDepthHeight) || 0,
      nativeDepthUvTransform:
        frame.nativeDepthUvTransform?.length === 16
          ? Float32Array.from(frame.nativeDepthUvTransform)
          : new Float32Array(),
      depths: Float32Array.from(frame.depths, (v) => v ?? 0),
      positions: Float32Array.from(frame.positions, (v) => v ?? NaN),
      colors: Uint8Array.from(frame.colors || new Uint8Array(count * 3)),
      colorMask: Uint8Array.from(frame.colorMask || new Uint8Array(count)),
      projectionMatrix: Float32Array.from(frame.projectionMatrix),
      transformMatrix: Float32Array.from(frame.transformMatrix),
      viewProjectionMatrix: Float32Array.from(
        frame.viewProjectionMatrix || frame.projectionMatrix,
      ),
      viewTransformMatrix: Float32Array.from(
        frame.viewTransformMatrix || frame.transformMatrix,
      ),
      camera: Float32Array.from(frame.camera || frame.transformMatrix.slice(12, 15)),
      linearSpeed: Number(frame.linearSpeed) || 0,
      angularSpeed: Number(frame.angularSpeed) || 0,
      depthQuality: Number(frame.depthQuality) || 0,
      measuredDepthCount: Number(frame.measuredDepthCount) || 0,
      colorSharpness: Number(frame.colorSharpness) || 0,
      colorClippedRatio: Number(frame.colorClippedRatio) || 0,
      validCount: frame.validCount ?? frame.depths.filter((v) => v > 0).length,
      coloredCount: frame.coloredCount ?? (frame.colorMask || []).filter(Boolean).length,
      colorImage: null,
      tracking: frame.tracking !== false,
    };
  });
  return {
    keyframes,
    options: { floorY: capture.floorY, observer: capture.observer },
    metadata: {
      captureVersion: capture.version || 1,
      geometrySchemaVersion: capture.geometrySchemaVersion || null,
      coordinateMode: capture.coordinateMode || "legacy-unspecified",
      buildId: capture.buildId || "unknown",
      browser: capture.browser || "unknown",
      ambiguousLegacyGeometry: keyframes.some(
        (frame) => frame.legacyGeometryAmbiguous,
      ),
    },
  };
}
