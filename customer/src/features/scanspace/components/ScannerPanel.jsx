import { useEffect, useRef, useState } from "react";
import { RoomScanner } from "../xr/RoomScanner";
import { surfaceTextures } from "../core/reconstruction";
import { buildScanCloud } from "../core/scanCloud";

function CoverageCompass({ sectors = [], heading = 0 }) {
  const views = sectors.length ? sectors : Array(24).fill(false);
  const step = 360 / views.length;
  const gradient = views
    .map((seen, index) => {
      const start = index * step + 1;
      const end = (index + 1) * step - 1;
      return `${seen ? "#65dcb7" : "#456257"} ${start}deg ${end}deg`;
    })
    .join(", ");
  return (
    <div
      className="ss-coverage-compass"
      role="img"
      aria-label={`${views.filter(Boolean).length} of ${views.length} view directions scanned`}
    >
      <span style={{ background: `conic-gradient(${gradient})` }} />
      <i style={{ transform: `rotate(${heading * step}deg)` }} />
    </div>
  );
}

function captureGuidance(stats) {
  if (!stats.tracking)
    return "Tracking is unstable. Point back at a confirmed area and hold still.";
  if (!stats.depthCurrent)
    return "Depth paused. Move back toward a textured, well-lit surface.";
  if ((stats.fusionKeyframes || 0) < 2)
    return "Move slowly sideways while keeping the same surface centered.";
  if ((stats.fusionKeyframes || 0) < 6)
    return "Good start. Continue one slow sideways pass for stronger overlap.";
  return "Surface overlap is building. Cover dark or reflective areas from another angle.";
}

export default function ScannerPanel({
  capabilities,
  onComplete,
  onPartial,
  onCancel,
}) {
  const canvas = useRef(),
    overlay = useRef(),
    scanner = useRef(),
    worker = useRef(),
    fusionWorker = useRef(),
    finished = useRef(false),
    [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [stats, setStats] = useState({
      corners: [],
      depthFrames: 0,
      pointCount: 0,
      features: [],
      errors: [],
    }),
    [partial, setPartial] = useState(null),
    [fusion, setFusion] = useState(null),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      worker.current?.terminate();
      fusionWorker.current?.terminate();
      scanner.current?.stop();
    },
    [],
  );
  async function start() {
    setError("");
    setPartial(null);
    setBusy(true);
    finished.current = false;
    const s = new RoomScanner({
      canvas: canvas.current,
      overlay: overlay.current,
      onUpdate: setStats,
      onEnd: () => {
        setActive(false);
        if (!finished.current)
          setError("Scan ended before a room was built. Start the scan again.");
      },
    });
    scanner.current = s;
    try {
      await s.start();
      setActive(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function cancelScan() {
    finished.current = true;
    await scanner.current?.stop();
    onCancel();
  }
  function downloadDebugCapture() {
    const source = scanner.current;
    if (!source?.keyframes?.length) return;
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      floorY: source.floorY,
      observer: source.observer,
      stats: source.stats,
      keyframes: source.keyframes.map((frame) => ({
        columns: frame.columns,
        rows: frame.rows,
        depths: Array.from(frame.depths),
        positions: Array.from(frame.positions),
        colors: Array.from(frame.colors),
        colorMask: Array.from(frame.colorMask),
        projectionMatrix: Array.from(frame.projectionMatrix),
        transformMatrix: Array.from(frame.transformMatrix),
        timestamp: frame.timestamp,
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `scanspace-debug-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function buildFusedMesh(raw) {
    if (!raw.keyframes?.length) return { mesh: null, diagnostics: null };
    fusionWorker.current = new Worker(
      new URL("../core/fusion.worker.js", import.meta.url),
    );
    const transfer = raw.keyframes.flatMap((frame) =>
      [
        frame.positions,
        frame.depths,
        frame.colors,
        frame.colorMask,
        frame.colorImage,
        frame.projectionMatrix,
        frame.transformMatrix,
        frame.camera,
      ]
        .filter(Boolean)
        .map((array) => array.buffer),
    );
    return new Promise((resolve, reject) => {
      fusionWorker.current.onmessage = (event) => {
        if (event.data.type === "progress") {
          setFusion(event.data);
          return;
        }
        if (event.data.type === "error") {
          reject(new Error(event.data.error));
          return;
        }
        if (event.data.type === "complete") resolve(event.data.result);
      };
      fusionWorker.current.onerror = () =>
        reject(new Error("Measured-surface reconstruction failed."));
      fusionWorker.current.postMessage(
        {
          keyframes: raw.keyframes,
          options: { floorY: raw.floorY, observer: raw.observer },
        },
        transfer,
      );
    });
  }
  async function finish(allowPartial = true) {
    setBusy(true);
    setError("");
    setFusion({ stage: "preparing", progress: 0 });
    try {
      const raw = scanner.current.result();
      const scanCloud = buildScanCloud(raw.points, {
        floorY: raw.floorY,
        observer: raw.observer,
        voxelSize: raw.stats.cloudCellSize,
      });
      let scanMesh = null;
      let room,
        floorY = raw.floorY,
        ceilingMeasured = false;
      scanner.current.paused = true;
      try {
        const fused = await buildFusedMesh(raw);
        scanMesh = fused.mesh;
        raw.stats.fusion = fused.diagnostics;
      } catch (fusionError) {
        // The cloud is the truthful fallback. Do not revive the old per-frame
        // mesh path, which could turn a failed fusion into invented geometry.
        raw.stats.fusion = { reason: fusionError.message, triangles: 0 };
      } finally {
        fusionWorker.current?.terminate();
        fusionWorker.current = null;
      }
      const stride = Math.max(1, Math.ceil(raw.points.length / 16000));
      const points = raw.points.filter((_, i) => i % stride === 0);
      worker.current = new Worker(
        new URL("../core/reconstruction.worker.js", import.meta.url),
      );
      try {
        const result = await new Promise((resolve, reject) => {
          worker.current.onmessage = (e) =>
            e.data.error
              ? reject(new Error(e.data.error))
              : resolve(e.data.result);
          worker.current.onerror = () =>
            reject(
              new Error("Room reconstruction failed. Keep scanning the room."),
            );
          worker.current.postMessage({
            points,
            options: {
              floorY: raw.floorY,
              height: 2.7,
              observer: raw.observer,
              depthFrames: raw.stats.depthFrames,
            },
          });
        });
        ({ room, floorY, ceilingMeasured } = result);
        if (!room && result.partial) {
          finished.current = true;
          await scanner.current.stop();
          onPartial(
            {
              ...result.partial,
              cloud: scanCloud,
              mesh: scanMesh,
              fusionReason: scanMesh ? null : raw.stats.fusion?.reason,
            },
            {
              stats: raw.stats,
              ceilingMeasured,
            },
          );
          return;
        }
      } catch (reconstructionError) {
        if (!allowPartial) throw reconstructionError;
        if (scanCloud) {
          finished.current = true;
          await scanner.current.stop();
          onPartial(
            {
              version: 1,
              kind: "observed-depth",
              name: "Partial room scan",
              walls: [],
              floorObserved: Number.isFinite(raw.floorY),
              ceilingObserved: false,
              pointCount: raw.points.length,
              reason: reconstructionError.message,
              cloud: scanCloud,
              mesh: scanMesh,
              fusionReason: scanMesh ? null : raw.stats.fusion?.reason,
            },
            { stats: raw.stats, ceilingMeasured: false },
          );
          return;
        }
        setPartial({
          reason: reconstructionError.message,
          pointCount: raw.points.length,
          coverage: raw.stats.coverage || 0,
        });
        return;
      }
      room.scanMetadata.deviceInfo = capabilities.browser;
      const textures = surfaceTextures(room, raw.points, floorY || 0);
      finished.current = true;
      await scanner.current.stop();
      onComplete(room, {
        textures,
        ceilingMeasured,
        stats: raw.stats,
        partial: room.scanMetadata.partial,
        inferredWallCount: room.scanMetadata.inferredWallCount,
        scanCloud,
        scanMesh,
      });
    } catch (e) {
      setError(e.message);
      if (scanner.current) scanner.current.paused = false;
    } finally {
      worker.current?.terminate();
      worker.current = null;
      fusionWorker.current?.terminate();
      fusionWorker.current = null;
      setFusion(null);
      setBusy(false);
    }
  }
  return (
    <div className={`ss-scanner ${active ? "is-scanning" : ""}`}>
      <canvas className="ss-xr-canvas" ref={canvas} />
      <div className="ss-scan-overlay" ref={overlay}>
        <div className="ss-scan-heading">
          <span className="ss-kicker">ScanSpace capture</span>
          <h2>
            {active
              ? stats.depthActive
                ? "Depth scanning"
                : "Looking for depth"
              : "Bring your room into ScanSpace."}
          </h2>
          <p>
            {active
              ? stats.paused
                ? "Scanning paused."
                : !stats.tracking
                  ? "Tracking lost. Move slowly toward an area you already scanned."
                  : stats.depthActive
                    ? "Move slowly around the room. ScanSpace finds the floor, walls, and ceiling automatically."
                    : "Move slowly around the room while ScanSpace looks for depth."
              : "Your room stays on this phone during scanning. Depth and captured colors depend on the capabilities granted by your browser."}
          </p>
        </div>
        {!active && !busy && (
          <div className="ss-actions">
            <button onClick={onCancel}>Back</button>
            <button
              className="ss-primary"
              disabled={!capabilities.ar}
              onClick={start}
            >
              Start camera scan
            </button>
          </div>
        )}
        {active && (
          <>
            <div className="ss-scan-live">
              <div>
                <strong>
                  {(stats.stablePointCount || 0).toLocaleString()}
                </strong>
                <span>stable surface points</span>
              </div>
              <div>
                <strong>{stats.floorAutoDetected ? "Ready" : "Finding"}</strong>
                <span>floor detection</span>
              </div>
              <div className="ss-scan-sweep">
                <CoverageCompass
                  sectors={stats.directionCoverage}
                  heading={stats.currentDirection}
                />
                <div>
                  <strong>{stats.coverage || 0}%</strong>
                  <span>view sweep</span>
                </div>
              </div>
            </div>
            <div className="ss-scan-area-key" aria-label="Scanned area legend">
              <span>
                <i className="is-observed" /> Stable scanned depth
              </span>
              <span>
                <i className="is-next" /> Still stabilizing
              </span>
              <span>
                <i /> Not scanned yet
              </span>
            </div>
            <div className="ss-scanning-target" aria-hidden="true">
              +
            </div>
            <div className="ss-scan-bottom">
              <p className="ss-scan-caption">
                {stats.depthCurrent
                  ? "Depth frames are being received."
                  : stats.depthActive
                    ? "Depth frames have stopped. Resume or move slowly to recover tracking."
                    : "Depth unavailable or not yet received. Assisted capture is ready."}{" "}
                {stats.colorActive
                  ? "Camera colors captured."
                  : "Captured colors unavailable."}
              </p>
              <p className="ss-scan-hint">
                {captureGuidance(stats)} Bright mint dots are confirmed depth;
                soft mint dots are still stabilizing.
              </p>
              {stats.cloudCompactions > 0 && (
                <p className="ss-scan-hint">
                  Capture density was optimized to retain room coverage.
                </p>
              )}
              {stats.full && (
                <p className="ss-error">
                  Capture density is at its safe limit. Finish with the measured
                  area, or keep scanning only the missing wall.
                </p>
              )}
              {!partial ? (
                <div className="ss-actions">
                  <button disabled={busy} onClick={cancelScan}>
                    Cancel scan
                  </button>
                  <button
                    className="ss-primary"
                    disabled={
                      busy ||
                      !stats.depthActive ||
                      (stats.stablePointCount || 0) < 300
                    }
                    onClick={() => finish()}
                  >
                    Finish scan
                  </button>
                </div>
              ) : (
                <section className="ss-partial-capture" role="status">
                  <strong>Partial depth captured</strong>
                  <p>
                    {partial.pointCount.toLocaleString()} points across{" "}
                    {partial.coverage}% of the view sweep. The missing room
                    outline has not been guessed.
                  </p>
                  <p className="ss-partial-reason">{partial.reason}</p>
                  <div className="ss-actions">
                    <button
                      onClick={() => {
                        setPartial(null);
                        scanner.current.togglePause();
                      }}
                    >
                      Keep scanning
                    </button>
                    <button onClick={cancelScan}>Cancel scan</button>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
        {busy && (
          <p className="ss-notice" role="status">
            {active
              ? fusion
                ? `${fusion.stage === "fusing" ? "Fusing" : fusion.stage === "meshing" ? "Meshing" : fusion.stage === "texturing" ? "Texturing" : "Preparing"} measured surfaces${Number.isFinite(fusion.progress) ? ` (${fusion.progress}%)` : ""}…`
                : "Reconstructing measured surfaces…"
              : "Starting camera…"}
          </p>
        )}
        {error && (
          <p className="ss-error" role="alert">
            {error}
          </p>
        )}
        <details className="ss-diagnostics">
          <summary>Device diagnostics</summary>
          <dl>
            {Object.entries({
              browser: capabilities.browser,
              secure: capabilities.secure,
              immersiveAR: capabilities.ar,
              grantedFeatures: stats.features?.join(", ") || "None",
              depthFrames: stats.depthFrames,
              depthFormat: stats.format || "Unavailable",
              depthDimensions: stats.dimensions || "Unavailable",
              pointCount: stats.pointCount,
              stablePointCount: stats.stablePointCount || 0,
              cloudCellSize: `${Math.round((stats.cloudCellSize || 0) * 100)} cm`,
              cloudOptimizations: stats.cloudCompactions || 0,
              detectedPlanes: stats.planes || 0,
              tracking: !!stats.tracking,
              floorCalibrated: stats.floorY != null,
              colorCaptured: !!stats.colorActive,
              viewSweep: `${stats.coverage || 0}%`,
              observedPlanes: stats.planes || 0,
              fusionKeyframes: stats.fusionKeyframes || 0,
              fusionOptimizations: stats.fusionKeyframeCompactions || 0,
              fusedTriangles: stats.fusion?.triangles || 0,
              fusionVoxelSize: stats.fusion?.voxelSize
                ? `${Math.round(stats.fusion.voxelSize * 100)} cm`
                : "Not yet reconstructed",
            }).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
          {stats.errors?.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
          {active &&
            new URLSearchParams(window.location.search).has(
              "scanspaceDebug",
            ) && (
              <button type="button" onClick={downloadDebugCapture}>
                Export RGB-D debug capture
              </button>
            )}
        </details>
      </div>
    </div>
  );
}
