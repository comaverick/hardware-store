import { useEffect, useRef, useState } from "react";
import { RoomScanner } from "../xr/RoomScanner";
import { surfaceTextures } from "../core/reconstruction";

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

export default function ScannerPanel({
  capabilities,
  onComplete,
  onCancel,
  onManual,
}) {
  const canvas = useRef(),
    overlay = useRef(),
    scanner = useRef(),
    worker = useRef(),
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
    [error, setError] = useState("");
  useEffect(
    () => () => {
      worker.current?.terminate();
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
          setError("Scan ended. Start again, or use manual measurements.");
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
  async function useMeasurements() {
    finished.current = true;
    await scanner.current?.stop();
    onManual?.();
  }
  async function finish(allowPartial = true) {
    setBusy(true);
    setError("");
    try {
      const raw = scanner.current.result();
      let room,
        floorY = raw.floorY,
        ceilingMeasured = false;
      scanner.current.paused = true;
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
      } catch (reconstructionError) {
        if (!allowPartial) throw reconstructionError;
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
        partial: false,
      });
    } catch (e) {
      setError(e.message);
      if (scanner.current) scanner.current.paused = false;
    } finally {
      worker.current?.terminate();
      worker.current = null;
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
                Bright mint dots are measured, stable depth. Soft mint dots are
                still being confirmed. Turn until the view sweep fills, then
                walk one or two steps along each wall.
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
                  <button
                    disabled={busy}
                    onClick={async () => {
                      finished.current = true;
                      await scanner.current.stop();
                      onCancel();
                    }}
                  >
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
                    <button onClick={useMeasurements}>
                      Use room measurements instead
                    </button>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
        {busy && (
          <p className="ss-notice" role="status">
            {active ? "Reconstructing measured surfaces…" : "Starting camera…"}
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
        </details>
      </div>
    </div>
  );
}
