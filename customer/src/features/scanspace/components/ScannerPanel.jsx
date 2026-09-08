import { useEffect, useRef, useState } from "react";
import { RoomScanner } from "../xr/RoomScanner";
import { surfaceTextures } from "../core/reconstruction";
import { buildScanCloud } from "../core/scanCloud";
import { buildStructuralRepair } from "../core/structuralRepair";
import { snapshotDepthCapture, downloadDepthCapture } from "../core/captureDebug";
import { scanReadiness } from "../core/readiness";

function observationPoints(observations) {
  if (!observations?.count || !observations.positions?.length) return null;
  return Array.from({ length: observations.count }, (_, index) => {
    const offset = index * 3;
    const point = {
      x: observations.positions[offset],
      y: observations.positions[offset + 1],
      z: observations.positions[offset + 2],
    };
    if (observations.colorMask?.[index])
      point.color = Array.from(observations.colors.slice(offset, offset + 3));
    return point;
  });
}

const captureQualitySummary = (stats) => ({
  coverage: stats.coverage || 0,
  cameraBaseline: stats.cameraBaseline || 0,
  acceptedDepthFrames: stats.acceptedDepthFrames || 0,
  rejectedDepthFrames: stats.rejectedDepthFrames || 0,
});

function CoverageCompass({ sectors = [], heading = 0 }) {
  const views = sectors.length ? sectors : Array(24).fill(false);
  const step = 360 / views.length;
  const gradient = views
    .map((seen, index) => {
      const start = index * step + 1;
      const end = (index + 1) * step - 1;
      return `${seen ? "#65dcb7" : "#ffffff20"} ${start}deg ${end}deg`;
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

function captureGuidance(stats, busy = false) {
  if (busy)
    return "Capture is safely paused while the accepted depth frames are reconstructed.";
  if (!stats.tracking)
    return "Tracking is unstable. Point back at a confirmed area and hold still.";
  if (!stats.depthCurrent)
    return "Depth paused. Move back toward a textured, well-lit surface.";
  if (stats.movingTooFast)
    return "Move more slowly. Fast depth frames are being skipped to prevent warped surfaces.";
  if (stats.frameQuality === "sparse-depth")
    return "Depth is sparse here. Aim at a matte, well-lit surface and revisit shiny or dark areas from another angle.";
  if (stats.nearDepthWarning)
    return "Something is reading very close. Step back, keep fingers clear, and rescan that area slowly.";
  if (!Number.isFinite(stats.floorY))
    return "Aim at the floor until floor detection says Ready.";
  if ((stats.fusionKeyframes || 0) < 2)
    return "Move slowly sideways while keeping the same surface centered.";
  if ((stats.fusionKeyframes || 0) < 6)
    return "Good start. Continue one slow sideways pass for stronger overlap.";
  if ((stats.cameraBaseline || 0) < 0.25)
    return "Do not only pivot in place. Move sideways at least 25 cm while keeping the same wall centered.";
  if ((stats.coverage || 0) < 50)
    return "Turn through the unscanned directions and keep each wall in view.";
  if ((stats.stablePointCount || 0) < 1200)
    return "Keep scanning the walls from overlapping angles to fill the remaining gaps.";
  return "Surface overlap is building. Cover dark or reflective areas from another angle.";
}

function captureTargetState(stats, busy = false) {
  if (busy)
    return {
      tone: "busy",
      label: "Building result",
      hint: "Capture is safely paused",
    };
  if (stats.paused)
    return { tone: "busy", label: "Capture paused", hint: "Resume to save more views" };
  if (!stats.tracking)
    return {
      tone: "warning",
      label: "Tracking lost",
      hint: "Aim at a confirmed area",
    };
  if (stats.movingTooFast)
    return {
      tone: "warning",
      label: "Slow down",
      hint: "This frame was not saved",
    };
  if (!stats.depthCurrent)
    return {
      tone: "warning",
      label: "No reliable depth",
      hint: "Change distance or angle",
    };
  if (stats.frameQuality === "sparse-depth" || stats.nearDepthWarning)
    return {
      tone: "warning",
      label: "Weak depth here",
      hint: "Step back or change angle",
    };
  if ((stats.cameraBaseline || 0) < 0.25)
    return {
      tone: "pending",
      label: "Move slowly sideways",
      hint: "Keep this surface in view as you move",
    };
  if ((stats.currentConfirmedRatio || 0) >= 0.7)
    return {
      tone: "complete",
      label: "Depth overlap saved",
      hint: "Revisit clear patches from another position",
    };
  if ((stats.currentConfirmedRatio || 0) >= 0.2)
    return {
      tone: "active",
      label: "Building coverage",
      hint: "Keep moving slowly sideways",
    };
  return {
    tone: "pending",
    label: "Add another viewpoint",
    hint: "Move slowly sideways, keeping this area in view",
  };
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
    debugCapture = useRef(null),
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
  const readiness = scanReadiness(stats);
  const targetState = captureTargetState(stats, busy);
  useEffect(
    () => () => {
      worker.current?.terminate();
      fusionWorker.current?.terminate();
      scanner.current?.stop();
    },
    [],
  );
  async function start() {
    debugCapture.current = null;
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
    downloadDepthCapture(debugCapture.current || snapshotDepthCapture(source), source.stats.fusion);
  }
  async function buildFusedMesh(raw, preserveInput = false) {
    if (!raw.keyframes?.length) return { mesh: null, diagnostics: null };
    fusionWorker.current = new Worker(
      new URL("../core/fusion.worker.js", import.meta.url),
    );
    const transfer = preserveInput
      ? []
      : raw.keyframes.flatMap((frame) =>
          [
            frame.positions,
            frame.depths,
            frame.colors,
            frame.colorMask,
            frame.colorImage,
            frame.projectionMatrix,
            frame.transformMatrix,
            frame.viewProjectionMatrix,
            frame.viewTransformMatrix,
            frame.nativeDepthUvTransform,
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
  async function finish(allowPartial = false) {
    setBusy(true);
    setError("");
    setFusion({ stage: "preparing", progress: 0 });
    try {
      const raw = scanner.current.result();
      let acceptedPoints = raw.points;
      let scanCloud = null;
      let scanMesh = null;
      let room,
        floorY = raw.floorY,
        ceilingMeasured = false;
      scanner.current.paused = true;
      debugCapture.current = snapshotDepthCapture(raw);
      try {
        const fused = await buildFusedMesh(raw, !allowPartial);
        scanMesh = fused.mesh;
        acceptedPoints = observationPoints(fused.observations) || raw.points;
        raw.stats.fusion = fused.diagnostics;
      } catch (fusionError) {
        // The cloud is the truthful fallback. Do not revive the old per-frame
        // mesh path, which could turn a failed fusion into invented geometry.
        raw.stats.fusion = { reason: fusionError.message, triangles: 0 };
      } finally {
        fusionWorker.current?.terminate();
        fusionWorker.current = null;
      }
      scanCloud = buildScanCloud(acceptedPoints, {
        floorY: raw.floorY,
        observer: raw.observer,
        voxelSize: raw.stats.cloudCellSize,
      });
      const stride = Math.max(1, Math.ceil(acceptedPoints.length / 16000));
      const points = acceptedPoints.filter((_, i) => i % stride === 0);
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
          if (!allowPartial) {
            setPartial({
              reason: result.partial.reason,
              pointCount: result.partial.pointCount,
              coverage: raw.stats.coverage || 0,
              cameraBaseline: raw.stats.cameraBaseline || 0,
              rejectedDepthFrames: raw.stats.rejectedDepthFrames || 0,
            });
            return;
          }
          finished.current = true;
          await scanner.current.stop();
          const structuralRepair = buildStructuralRepair(
            result.partial.walls,
            scanCloud,
          );
          onPartial(
            {
              ...result.partial,
              cloud: scanCloud,
              mesh: scanMesh,
              structuralRepair,
              fusionReason:
                !scanMesh || raw.stats.fusion?.fallback
                  ? raw.stats.fusion?.reason
                  : null,
              fusionMode: raw.stats.fusion?.fallback || "multi-view",
              captureQuality: captureQualitySummary(raw.stats),
              debugCapture: debugCapture.current,
              fusionDiagnostics: raw.stats.fusion,
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
              pointCount: acceptedPoints.length,
              reason: reconstructionError.message,
              cloud: scanCloud,
              mesh: scanMesh,
              fusionReason:
                !scanMesh || raw.stats.fusion?.fallback
                  ? raw.stats.fusion?.reason
                  : null,
              fusionMode: raw.stats.fusion?.fallback || "multi-view",
              captureQuality: captureQualitySummary(raw.stats),
              debugCapture: debugCapture.current,
              fusionDiagnostics: raw.stats.fusion,
            },
            { stats: raw.stats, ceilingMeasured: false },
          );
          return;
        }
        setPartial({
          reason: reconstructionError.message,
          pointCount: acceptedPoints.length,
          coverage: raw.stats.coverage || 0,
          cameraBaseline: raw.stats.cameraBaseline || 0,
          rejectedDepthFrames: raw.stats.rejectedDepthFrames || 0,
        });
        return;
      }
      room.scanMetadata.deviceInfo = capabilities.browser;
      const textures = surfaceTextures(room, acceptedPoints, floorY || 0);
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
        debugCapture: debugCapture.current,
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
  function preparePartialReview() {
    if (scanner.current) scanner.current.paused = true;
    setPartial({
      reason:
        "Reviewing now will show an open measured sector, not a complete room.",
      pointCount: stats.stablePointCount || stats.pointCount || 0,
      coverage: stats.coverage || 0,
      cameraBaseline: stats.cameraBaseline || 0,
      rejectedDepthFrames: stats.rejectedDepthFrames || 0,
    });
  }
  return (
    <div className={`ss-scanner ${active ? "is-scanning" : ""}`}>
      <canvas className="ss-xr-canvas" ref={canvas} />
      <div className="ss-scan-overlay" ref={overlay}>
        <div className="ss-scan-heading">
          <span className="ss-kicker">ScanSpace capture</span>
          <h2>
            {active
              ? busy
                ? "Reconstructing capture"
                : stats.depthActive
                  ? "Depth scanning"
                  : "Looking for depth"
              : "Bring your room into ScanSpace."}
          </h2>
          <p>
            {active
              ? busy
                ? "Using the accepted depth frames already captured."
                : stats.paused
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
                  <span>direction sweep</span>
                </div>
              </div>
            </div>
            <div className="ss-scan-area-key" aria-label="Scanned area legend">
              <span>
                <i className="is-observed" /> Bright circles = saved depth overlap
              </span>
            </div>
            <div
              className={`ss-scanning-target is-${targetState.tone}`}
              role="status"
            >
              <i aria-hidden="true" />
              <span>
                <strong>{targetState.label}</strong>
                <small>{targetState.hint}</small>
              </span>
            </div>
            <div className="ss-scan-bottom">
              <p className="ss-scan-caption">
                {busy
                  ? "Capture is paused during reconstruction."
                  : stats.depthCurrent
                    ? "Depth frames are being received."
                    : stats.depthActive
                      ? "Depth frames have stopped. Resume or move slowly to recover tracking."
                      : "Depth unavailable or not yet received. Assisted capture is ready."}{" "}
                {stats.colorActive
                  ? "Camera colors captured."
                  : "Captured colors unavailable."}
              </p>
              <p className="ss-scan-hint">
                {captureGuidance(stats, busy)} Mint circles mark repeated depth
                in saved views. Reconstruction still checks their agreement.
              </p>
              {!busy && !readiness.ready && (
                <p className="ss-scan-hint">
                  Needed before a complete room scan: {readiness.missing.join(", ")}.
                </p>
              )}
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
                    disabled={busy || !readiness.ready}
                    onClick={() => finish()}
                  >
                    Finish room scan
                  </button>
                  {!readiness.ready &&
                    (stats.stablePointCount || 0) >= 300 && (
                      <button disabled={busy} onClick={preparePartialReview}>
                        Review partial capture
                      </button>
                    )}
                </div>
              ) : (
                <section className="ss-partial-capture" role="status">
                  <strong>Partial depth captured</strong>
                  <p>
                    {partial.pointCount.toLocaleString()} points across{" "}
                    {partial.coverage}% of the view sweep. The missing room
                    outline has not been guessed.
                  </p>
                  <p>
                    Horizontal camera-position spread: {Math.round(
                      (partial.cameraBaseline || 0) * 100,
                    )} cm. Move sideways, not only in place, before trying
                    completion again.
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
                    <button
                      className="ss-primary"
                      disabled={busy}
                      onClick={() => finish(true)}
                    >
                      Review open sector anyway
                    </button>
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
              depthType: stats.depthType || "Unavailable",
              depthUsage: stats.depthUsage || "Unavailable",
              depthDimensions: stats.dimensions || "Unavailable",
              pointCount: stats.pointCount,
              stablePointCount: stats.stablePointCount || 0,
              cloudCellSize: `${Math.round((stats.cloudCellSize || 0) * 100)} cm`,
              cloudOptimizations: stats.cloudCompactions || 0,
              detectedPlanes: stats.planes || 0,
              tracking: !!stats.tracking,
              floorCalibrated: stats.floorY != null,
              colorCaptured: !!stats.colorActive,
              directionSweep: `${stats.coverage || 0}%`,
              observedPlanes: stats.planes || 0,
              fusionKeyframes: stats.fusionKeyframes || 0,
              acceptedDepthFrames: stats.acceptedDepthFrames || 0,
              rejectedDepthFrames: stats.rejectedDepthFrames || 0,
              frameQuality: stats.frameQuality || "waiting",
              validDepthCoverage: `${Math.round((stats.validDepthRatio || 0) * 100)}%`,
              horizontalCameraBaseline: `${Math.round((stats.cameraBaseline || 0) * 100)} cm`,
              cameraTravel: `${Math.round((stats.cameraTravel || 0) * 100)} cm`,
              fusionOptimizations: stats.fusionKeyframeCompactions || 0,
              fusedTriangles: stats.fusion?.triangles || 0,
              retainedWeakDepthSamples:
                stats.fusion?.weakDepthSamplesRetained || 0,
              safelyFilledMeshHoles: stats.fusion?.filledHoleCount || 0,
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
