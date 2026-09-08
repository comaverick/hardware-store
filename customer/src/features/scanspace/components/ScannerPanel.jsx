import { useEffect, useRef, useState } from "react";
import { RoomScanner } from "../xr/RoomScanner";
import { surfaceTextures } from "../core/reconstruction";
import { buildScanCloud } from "../core/scanCloud";
import { snapshotDepthCapture, downloadDepthCapture } from "../core/captureDebug";
import {
  scanReadiness,
  surfaceScanReadiness,
  MIN_CAMERA_BASELINE_METERS,
  MIN_DIRECTION_COVERAGE,
  MIN_FUSION_KEYFRAMES,
  MIN_STABLE_POINTS,
} from "../core/readiness";

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
  if ((stats.fusionKeyframes || 0) < MIN_FUSION_KEYFRAMES)
    return "Good start. Continue one slow sideways pass for stronger overlap.";
  if ((stats.cameraBaseline || 0) < MIN_CAMERA_BASELINE_METERS)
    return "Do not only pivot in place. Move sideways at least 40 cm while keeping the same wall centered.";
  if ((stats.coverage || 0) < MIN_DIRECTION_COVERAGE)
    return "Turn through the unscanned directions and keep each wall in view.";
  if ((stats.stablePointCount || 0) < MIN_STABLE_POINTS)
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
  if ((stats.cameraBaseline || 0) < MIN_CAMERA_BASELINE_METERS)
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
  onSurface,
  onCancel,
}) {
  const canvas = useRef(),
    overlay = useRef(),
    scanner = useRef(),
    worker = useRef(),
    fusionWorker = useRef(),
    debugCapture = useRef(null),
    pendingSurface = useRef(null),
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
  const surfaceReadiness = surfaceScanReadiness(stats);
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
    pendingSurface.current = null;
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
    pendingSurface.current = null;
    finished.current = true;
    await scanner.current?.stop();
    onCancel();
  }
  function downloadDebugCapture() {
    const source = scanner.current;
    if (!source?.keyframes?.length) return;
    downloadDepthCapture(debugCapture.current || snapshotDepthCapture(source), source.stats.fusion);
  }
  async function buildFusedMesh(
    raw,
    preserveInput = false,
    completionMode = "room",
  ) {
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
          options: {
            floorY: raw.floorY,
            observer: raw.observer,
            headingCoverage: raw.stats.coverage || 0,
            completionMode,
          },
        },
        transfer,
      );
    });
  }
  async function finish() {
    if (!readiness.ready) {
      setError(`Keep scanning before finishing: ${readiness.missing.join(", ")}.`);
      return;
    }
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
        const fused = await buildFusedMesh(raw, true);
        scanMesh = fused.mesh;
        acceptedPoints = observationPoints(fused.observations) || raw.points;
        raw.stats.fusion = fused.diagnostics;
        if (!scanMesh) {
          setPartial({
            reason:
              fused.diagnostics?.reason ||
              "The measured views did not pass surface-quality checks.",
            pointCount: acceptedPoints.length,
            coverage: raw.stats.coverage || 0,
            cameraBaseline: raw.stats.cameraBaseline || 0,
            rejectedDepthFrames: raw.stats.rejectedDepthFrames || 0,
          });
          return;
        }
      } catch (fusionError) {
        raw.stats.fusion = { reason: fusionError.message, triangles: 0 };
        setPartial({
          reason: fusionError.message,
          pointCount: raw.points.length,
          coverage: raw.stats.coverage || 0,
          cameraBaseline: raw.stats.cameraBaseline || 0,
          rejectedDepthFrames: raw.stats.rejectedDepthFrames || 0,
        });
        return;
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
          setPartial({
            reason: result.partial.reason,
            pointCount: result.partial.pointCount,
            coverage: raw.stats.coverage || 0,
            cameraBaseline: raw.stats.cameraBaseline || 0,
            rejectedDepthFrames: raw.stats.rejectedDepthFrames || 0,
          });
          return;
        }
      } catch (reconstructionError) {
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
  async function finishSurface() {
    if (!surfaceReadiness.ready) {
      setError(
        `Keep scanning this surface before finishing: ${surfaceReadiness.missing.join(", ")}.`,
      );
      return;
    }
    setBusy(true);
    setError("");
    setFusion({ stage: "preparing", progress: 0 });
    try {
      const raw = scanner.current.result();
      scanner.current.paused = true;
      debugCapture.current = snapshotDepthCapture(raw);
      const fused = await buildFusedMesh(raw, true, "surface");
      raw.stats.fusion = fused.diagnostics;
      const acceptedPoints =
        observationPoints(fused.observations) || raw.points;
      if (!fused.mesh) {
        setPartial({
          reason:
            fused.diagnostics?.reason ||
            "The measured surface did not pass multi-view quality checks.",
          pointCount: acceptedPoints.length,
          coverage: raw.stats.coverage || 0,
          cameraBaseline: raw.stats.cameraBaseline || 0,
          rejectedDepthFrames: raw.stats.rejectedDepthFrames || 0,
        });
        return;
      }
      const scanCloud = buildScanCloud(acceptedPoints, {
        floorY: Number.isFinite(raw.floorY) ? raw.floorY : 0,
        observer: raw.observer,
        voxelSize: raw.stats.cloudCellSize,
      });
      const surfaceResult = {
        version: 2,
        kind: "validated-measured-surface",
        name: "Measured surface scan",
        walls: [],
        floorObserved: Number.isFinite(raw.floorY),
        ceilingObserved: false,
        pointCount: acceptedPoints.length,
        reason:
          "Validated multi-view surface. A complete room boundary was not requested.",
        cloud: scanCloud,
        mesh: fused.mesh,
        fusionMode: "multi-view",
        captureQuality: captureQualitySummary(raw.stats),
        debugCapture: debugCapture.current,
        fusionDiagnostics: fused.diagnostics,
        measuredGapWarning: fused.diagnostics?.measuredGapWarning || null,
      };
      if (surfaceResult.measuredGapWarning) {
        pendingSurface.current = surfaceResult;
        setPartial({
          reason: surfaceResult.measuredGapWarning.message,
          pointCount: acceptedPoints.length,
          coverage: raw.stats.coverage || 0,
          cameraBaseline: raw.stats.cameraBaseline || 0,
          rejectedDepthFrames: raw.stats.rejectedDepthFrames || 0,
          canAcceptMeasuredGaps: true,
        });
        return;
      }
      finished.current = true;
      await scanner.current.stop();
      onSurface(surfaceResult);
    } catch (surfaceError) {
      setError(surfaceError.message);
      if (scanner.current) scanner.current.paused = false;
    } finally {
      fusionWorker.current?.terminate();
      fusionWorker.current = null;
      setFusion(null);
      setBusy(false);
    }
  }
  async function acceptMeasuredGaps() {
    const surfaceResult = pendingSurface.current;
    if (!surfaceResult) return;
    setBusy(true);
    setError("");
    try {
      finished.current = true;
      await scanner.current.stop();
      pendingSurface.current = null;
      onSurface(surfaceResult);
    } catch (surfaceError) {
      finished.current = false;
      setError(surfaceError.message);
    } finally {
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
                  : partial
                    ? "Capture is paused after validation. Keep scanning will resume the camera."
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
                {partial
                  ? "The existing capture is still available; no wall was generated."
                  : captureGuidance(stats, busy)}{" "}
                Mint circles mark repeated depth
                in saved views. Reconstruction still checks their agreement.
              </p>
              {!busy && !partial && !readiness.ready && (
                <p className="ss-scan-hint">
                  Needed before a complete room scan: {readiness.missing.join(", ")}.
                </p>
              )}
              {!busy && !partial && !surfaceReadiness.ready && (
                <p className="ss-scan-hint">
                  Needed for one measured surface: {surfaceReadiness.missing.join(", ")}.
                </p>
              )}
              {stats.cloudCompactions > 0 && (
                <p className="ss-scan-hint">
                  Capture density was optimized to retain room coverage.
                </p>
              )}
              {stats.full && (
                <p className="ss-error">
                  Capture density is at its safe limit. If completion is still
                  unavailable, restart and scan with steadier overlap.
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
                  <button
                    disabled={busy || !surfaceReadiness.ready}
                    onClick={finishSurface}
                  >
                    Finish scanned surface
                  </button>
                </div>
              ) : (
                <section className="ss-partial-capture" role="status">
                  <strong>
                    {partial.canAcceptMeasuredGaps
                      ? "Some measured areas remain open"
                      : "Scan is not ready to finish"}
                  </strong>
                  <p>
                    {partial.pointCount.toLocaleString()} points across{" "}
                    {partial.coverage}% of the view sweep.{" "}
                    {partial.canAcceptMeasuredGaps
                      ? "The measured geometry passed structural validation, but some regions have no reliable depth."
                      : "No result was created because the measured geometry did not pass validation."}
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
                      disabled={busy}
                      onClick={() => {
                        pendingSurface.current = null;
                        setPartial(null);
                        scanner.current.togglePause();
                      }}
                    >
                      Keep scanning
                    </button>
                    {partial.canAcceptMeasuredGaps && (
                      <button
                        className="ss-primary"
                        disabled={busy}
                        onClick={acceptMeasuredGaps}
                      >
                        Finish with measured gaps
                      </button>
                    )}
                    <button disabled={busy} onClick={cancelScan}>
                      Cancel scan
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
          {active && (stats.fusionKeyframes || 0) > 0 && (
              <button type="button" onClick={downloadDebugCapture}>
                Export RGB-D debug capture
              </button>
            )}
        </details>
      </div>
    </div>
  );
}
