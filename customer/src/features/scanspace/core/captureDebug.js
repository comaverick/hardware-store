// Diagnostics are opt-in and stay in memory until the user downloads them.
// Snapshot before worker transfer detaches the live typed arrays. Camera photos
// are omitted to bound memory; per-point RGB is sufficient for geometry replay.
export function captureDebugEnabled() {
  return new URLSearchParams(window.location.search).get("scanspaceDebug") === "1";
}

export function snapshotDepthCapture(raw) {
  const header = {
    version: 2,
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
      depths: Array.from(frame.depths),
      positions: Array.from(frame.positions),
      colors: Array.from(frame.colors),
      colorMask: Array.from(frame.colorMask),
      projectionMatrix: Array.from(frame.projectionMatrix),
      transformMatrix: Array.from(frame.transformMatrix),
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
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `scanspace-debug-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function restoreDepthCapture(payload) {
  const capture = payload.capture || payload;
  if (!Array.isArray(capture.keyframes) || capture.keyframes.length > 60)
    throw new Error("Expected a ScanSpace capture with at most 60 keyframes.");
  const keyframes = capture.keyframes.map((frame) => {
    const count = frame.columns * frame.rows;
    if (!Number.isInteger(count) || count < 1 || count > 100000 ||
        frame.depths?.length !== count || frame.positions?.length !== count * 3 ||
        frame.projectionMatrix?.length !== 16 || frame.transformMatrix?.length !== 16)
      throw new Error("Invalid keyframe dimensions or camera matrices.");
    return {
      ...frame,
      depths: Float32Array.from(frame.depths, (v) => v ?? 0),
      positions: Float32Array.from(frame.positions, (v) => v ?? NaN),
      colors: Uint8Array.from(frame.colors || new Uint8Array(count * 3)),
      colorMask: Uint8Array.from(frame.colorMask || new Uint8Array(count)),
      projectionMatrix: Float32Array.from(frame.projectionMatrix),
      transformMatrix: Float32Array.from(frame.transformMatrix),
      camera: Float32Array.from(frame.camera || frame.transformMatrix.slice(12, 15)),
      validCount: frame.validCount ?? frame.depths.filter((v) => v > 0).length,
      coloredCount: frame.coloredCount ?? (frame.colorMask || []).filter(Boolean).length,
      colorImage: null,
      tracking: frame.tracking !== false,
    };
  });
  return { keyframes, options: { floorY: capture.floorY, observer: capture.observer } };
}
