import { useEffect, useRef, useState } from "react";
import { RoomScanner } from "../xr/RoomScanner";
import { normalizeRoom } from "../core/domain";
import { surfaceTextures } from "../core/reconstruction";

export default function ScannerPanel({ capabilities, onComplete, onCancel }) {
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
    [height, setHeight] = useState(2.7),
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
  async function finish(assisted) {
    setBusy(true);
    setError("");
    try {
      const raw = scanner.current.result();
      let room,
        floorY = raw.floorY,
        ceilingMeasured = false;
      if (assisted) {
        room = normalizeRoom({
          name: "Scanned room",
          floorPolygon: raw.corners.map((p) => ({ x: p.x, z: p.z })),
          ceilingHeight: Number(height),
          scanMetadata: {
            mode: "assisted",
            depthSupported: raw.stats.depthActive,
            capturedColorSupported: raw.stats.colorActive,
            depthFrames: raw.stats.depthFrames,
            pointCount: raw.points.length,
            deviceInfo: capabilities.browser,
          },
        });
      } else {
        scanner.current.paused = true;
        const stride = Math.max(1, Math.ceil(raw.points.length / 16000));
        const points = raw.points.filter((_, i) => i % stride === 0);
        worker.current = new Worker(
          new URL("../core/reconstruction.worker.js", import.meta.url),
        );
        const result = await new Promise((resolve, reject) => {
          worker.current.onmessage = (e) =>
            e.data.error
              ? reject(new Error(e.data.error))
              : resolve(e.data.result);
          worker.current.onerror = () =>
            reject(
              new Error(
                "Room reconstruction failed. Try assisted corner capture.",
              ),
            );
          worker.current.postMessage({
            points,
            options: {
              floorY: raw.floorY,
              height: Number(height),
              observer: raw.observer,
              depthFrames: raw.stats.depthFrames,
            },
          });
        });
        ({ room, floorY, ceilingMeasured } = result);
        room.scanMetadata.deviceInfo = capabilities.browser;
      }
      const textures = surfaceTextures(room, raw.points, floorY || 0);
      finished.current = true;
      await scanner.current.stop();
      onComplete(room, { textures, ceilingMeasured, stats: raw.stats });
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
                : "Mark your room corners"
              : "Bring your room into ScanSpace."}
          </h2>
          <p>
            {active
              ? stats.paused
                ? "Scanning paused."
                : !stats.tracking
                  ? "Tracking lost. Move slowly toward an area you already scanned."
                  : stats.depthActive
                    ? "Move slowly along every wall. Include the floor and ceiling."
                    : "Aim at the floor until a ring appears, then mark each corner in order."
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
                <strong>{stats.pointCount.toLocaleString()}</strong>
                <span>depth points</span>
              </div>
              <div>
                <strong>{stats.corners.length}</strong>
                <span>marked corners</span>
              </div>
              <div>
                <strong>{stats.coverage || 0}%</strong>
                <span>directions viewed</span>
              </div>
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
              {stats.full && (
                <p className="ss-error">
                  Capture memory limit reached. Finish this room or start a new
                  scan.
                </p>
              )}
              <label>
                Ceiling height fallback (m)
                <input
                  type="number"
                  min="1.8"
                  max="8"
                  step="0.01"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
              </label>
              <div className="ss-actions">
                <button
                  disabled={busy || !stats.canCapture}
                  onClick={() => {
                    try {
                      scanner.current.calibrateFloor();
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Set floor
                </button>
                <button
                  disabled={busy || !stats.canCapture || stats.paused}
                  onClick={() => scanner.current.captureCorner()}
                >
                  Mark corner
                </button>
                <button
                  disabled={busy || !stats.corners.length}
                  onClick={() => scanner.current.undo()}
                >
                  Undo corner
                </button>
                <button
                  disabled={busy}
                  onClick={() => scanner.current.togglePause()}
                >
                  {stats.paused ? "Resume" : "Pause"}
                </button>
              </div>
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
                {stats.corners.length >= 3 && (
                  <button disabled={busy} onClick={() => finish(true)}>
                    Use marked corners
                  </button>
                )}
                <button
                  className="ss-primary"
                  disabled={
                    busy || !stats.depthActive || stats.pointCount < 300
                  }
                  onClick={() => finish(false)}
                >
                  Build from depth
                </button>
              </div>
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
              detectedPlanes: stats.planes || 0,
              tracking: !!stats.tracking,
              floorCalibrated: stats.floorY != null,
              colorCaptured: !!stats.colorActive,
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
