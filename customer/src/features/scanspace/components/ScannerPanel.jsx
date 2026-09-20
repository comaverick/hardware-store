import { useEffect, useRef, useState } from "react";
import { RoomScanner } from "../xr/RoomScanner";
import { buildScanCloud } from "../core/scanCloud";
import { snapshotDepthCapture, downloadDepthCapture } from "../core/captureDebug";
import {
  surfaceScanReadiness,
  MIN_CAMERA_BASELINE_METERS,
  MIN_DIRECTION_COVERAGE,
  MIN_FUSION_KEYFRAMES,
  MIN_STABLE_POINTS,
  FLOOR_OUTLIER_TOLERANCE_METERS,
} from "../core/readiness";
import { scanFusionOptions } from "../core/fusionOptions";
import ScanRenderProgress from "./ScanRenderProgress";
import { adaptiveGuidance, auditCapture } from "../core/adaptiveCapture";
import { CaptureAuditNotice, CaptureCoverage } from "./CaptureFeedback";
import { createFusionWorker } from "../core/createFusionWorker";

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

const captureQualitySummary = (stats, fusion = null) => ({
  adaptiveCapture: stats.adaptiveCapture || null,
  captureProfile: stats.captureProfile || null,
  connectedSurfaceCoverage: stats.connectedSurfaceCoverage || 0,
  coverage: stats.coverage || 0,
  cameraBaseline: stats.cameraBaseline || 0,
  acceptedDepthFrames: stats.acceptedDepthFrames || 0,
  rejectedDepthFrames: stats.rejectedDepthFrames || 0,
  textureKeyframes: stats.textureKeyframes || 0,
  depthType: stats.depthType || "Unavailable",
  colorSharpness: stats.colorSharpness || 0,
  colorFocus: stats.colorFocus || 0,
  colorClippedRatio: stats.colorClippedRatio || 0,
  colorFramesSkippedForMotion: stats.colorFramesSkippedForMotion || 0,
  textureRefreshes: stats.textureRefreshes || 0,
  depthRefreshes: stats.depthRefreshes || 0,
  floorOutlierSamples: fusion?.floorOutlierSamples || 0,
  floorOutlierRatio: fusion?.floorOutlierRatio || 0,
  removedBridgeTriangles: fusion?.removedBridgeTriangles || 0,
  longEdgeTriangleRatio: fusion?.meshBridgeDiagnostics?.longEdgeRatio || 0,
  algorithmVersion: fusion?.algorithmVersion || 0,
  fusionSettings: fusion?.fusionSettings || null,
  preparedKeyframes: fusion?.preparedKeyframes || 0,
  fusedKeyframes: fusion?.keyframes || 0,
  textureFramesBeforeSelection:
    fusion?.alignment?.textureFramesBeforeSelection || 0,
  textureFramesAfterSelection:
    fusion?.alignment?.textureFramesAfterSelection || 0,
  lowQualityTextureFrames: fusion?.lowQualityTextureFrames || 0,
  measuredFusionSamples: fusion?.robustFusion?.measuredFusionSamples || 0,
  repairedFusionSamples: fusion?.robustFusion?.repairedFusionSamples || 0,
  softTextureFallbackTriangles:
    fusion?.softTextureFallbackTriangles || 0,
  rejectedSoftTextureCandidates:
    fusion?.rejectedSoftTextureCandidates || 0,
  textureProjectionMode: fusion?.textureProjectionMode || null,
  textureCalibrationPairs: fusion?.textureCalibrationPairs || 0,
  photometricNormalization: fusion?.photometricNormalization || null,
  fallbackBoundaryVertices: fusion?.fallbackBoundaryVertices || 0,
  revertedDeformationVertices: fusion?.revertedDeformationVertices || 0,
  planarConsolidation: fusion?.planarConsolidation || null,
  denoising: fusion?.denoising || null,
  synchronizedTextureFrames: fusion?.alignment?.synchronizedTextureFrames || 0,
  poseRefinement: fusion?.alignment?.poseRefinement || null,
  jointPoseRefinement: fusion?.alignment?.jointPoseRefinement || null,
  structuralDepth: fusion?.structuralDepth || null,
  structuralRebuild: fusion?.structuralRebuild || null,
  topology: fusion?.topologyAfterRepair || null,
  recoveredCaptureGroups: fusion?.alignment?.componentRecovery || null,
  surfaceRepair: fusion?.surfaceRepair || null,
});

function captureGuidance(stats, busy = false) {
  if (busy)
    return "Capture is safely paused while the accepted depth frames are reconstructed.";
  if (!stats.tracking)
    return "Tracking is unstable. Point back at a confirmed area and hold still.";
  if (stats.depthState === "unavailable")
    return "This session has no CPU depth sensor. End the scan and use a supported Android browser.";
  if (stats.depthState === "error")
    return "Depth reading was interrupted. Hold still over a matte surface while ScanSpace retries.";
  if (!stats.depthCurrent)
    return stats.depthState === "stalled"
      ? "Depth frames stopped. Hold still over a textured, well-lit surface and let tracking recover."
      : "Waiting for depth. Aim at a matte, well-lit surface and hold still for a moment.";
  if (stats.movingTooFast)
    return "Move more slowly. Fast depth frames are being skipped to prevent warped surfaces.";
  const adaptive = adaptiveGuidance(stats);
  if (adaptive) return adaptive.hint;
  if (stats.colorActive && stats.colorFrameReliable === false)
    return "Hold still briefly. Depth is being kept, but blurred camera colors are being skipped.";
  if (
    !stats.adaptiveCapture &&
    (stats.rejectedDepthFrames || 0) >= 6 &&
    (stats.rejectedDepthFrames || 0) /
      Math.max(1, (stats.acceptedDepthFrames || 0) + (stats.rejectedDepthFrames || 0)) >
      0.12
  )
    return "Several frames were too fast or unreliable. Slow down and repeat this area for better overlap.";
  if (stats.colorActive && (stats.colorClippedRatio || 0) > 0.45)
    return "Color is clipped here. Tilt away from bright windows and hold still for a clearer texture.";
  if (stats.frameQuality === "sparse-depth")
    return "Depth is sparse here. Aim at a matte, well-lit surface and revisit shiny or dark areas from another angle.";
  if (stats.frameQuality === "pose-inconsistent")
    return "Tracking drift was detected. Return to the last confirmed area, hold still, then continue slowly.";
  if (stats.nearDepthWarning)
    return "Something is reading very close. Step back, keep fingers clear, and rescan that area slowly.";
  if (stats.adaptiveCapture)
    return "Continue across the surfaces you want, keeping some confirmed area in view.";
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
    return stats.originChanged
      ? { tone: "busy", label: "Tracking reset", hint: "Start a new scan" }
      : { tone: "busy", label: "Capture paused", hint: "Resume to save more views" };
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
      label:
        stats.depthState === "error"
          ? "Depth read interrupted"
          : stats.depthState === "stalled"
            ? "Depth interrupted"
            : "Waiting for depth",
      hint:
        stats.depthState === "error"
          ? "Hold still while ScanSpace retries"
          : stats.depthState === "stalled"
            ? "Hold still to recover tracking"
            : "Aim at a matte surface",
    };
  if (stats.frameQuality === "pose-inconsistent")
    return {
      tone: "warning",
      label: "Tracking drift detected",
      hint: "Return to the last confirmed area",
    };
  if (stats.frameQuality === "sparse-depth" || stats.nearDepthWarning)
    return {
      tone: "warning",
      label: "Weak depth here",
      hint: "Step back or change angle",
    };
  const adaptive = adaptiveGuidance(stats);
  if (adaptive) return adaptive;
  if ((stats.cameraBaseline || 0) < MIN_CAMERA_BASELINE_METERS)
    return {
      tone: "pending",
      label: "Move slowly sideways",
      hint: "Keep this surface in view as you move",
    };
  if ((stats.currentConfirmedRatio || 0) >= 0.85)
    return {
      tone: "complete",
      label: "Area confirmed",
      hint: "Move to any untinted gap",
    };
  if ((stats.currentConfirmedRatio || 0) >= 0.2)
    return {
      tone: "active",
      label: "Coverage filling",
      hint: "Tint the remaining clear areas",
    };
  return {
    tone: "pending",
    label: "Add another viewpoint",
    hint: "Move slowly sideways, keeping this area in view",
  };
}

export default function ScannerPanel({
  capabilities,
  onSurface,
  onCancel,
}) {
  const canvas = useRef(),
    overlay = useRef(),
    scanner = useRef(),
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
    [preflight, setPreflight] = useState(null),
    [fusion, setFusion] = useState(null),
    [error, setError] = useState("");
  const surfaceReadiness = surfaceScanReadiness(stats);
  const hasReconstructableCapture = (stats.fusionKeyframes || 0) >= 2 &&
    stats.adaptiveCapture?.connected !== false;
  const targetState = captureTargetState(stats, busy);
  useEffect(
    () => () => {
      fusionWorker.current?.terminate();
      scanner.current?.stop();
    },
    [],
  );
  async function start() {
    debugCapture.current = null;
    setError("");
    setPartial(null);
    setPreflight(null);
    setBusy(true);
    finished.current = false;
    const s = new RoomScanner({
      canvas: canvas.current,
      overlay: overlay.current,
      onUpdate: setStats,
      onEnd: () => {
        setActive(false);
        if (!finished.current)
          setError("Scan ended before a result was built. Start the scan again.");
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
  async function buildFusedMesh(
    raw,
    preserveInput = false,
    completionMode = "room",
  ) {
    if (!raw.keyframes?.length) return { mesh: null, diagnostics: null };
    const transfer = preserveInput
      ? []
      : [...new Set([...raw.keyframes, ...(raw.textureKeyframes || [])].flatMap((frame) =>
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
        ))];
    const baseOptions = scanFusionOptions(raw, completionMode);
    const runWorker = (options, transferable = []) =>
      new Promise((resolve, reject) => {
        const activeWorker = createFusionWorker();
        fusionWorker.current = activeWorker;
        let settled = false;
        activeWorker.onmessage = (event) => {
          if (event.data.type === "progress") {
            setFusion(event.data);
            return;
          }
          if (settled) return;
          if (event.data.type === "error") {
            settled = true;
            reject(new Error(event.data.error));
            return;
          }
          if (event.data.type === "complete") {
            settled = true;
            resolve(event.data.result);
          }
        };
        activeWorker.onerror = (event) => {
          if (settled) return;
          settled = true;
          const error = new Error(
            event?.message || "The reconstruction worker stopped unexpectedly.",
          );
          error.workerCrash = true;
          reject(error);
        };
        try {
          activeWorker.postMessage(
            { keyframes: raw.keyframes, options },
            transferable,
          );
        } catch (error) {
          settled = true;
          reject(error);
        }
      });
    try {
      return await runWorker(baseOptions, transfer);
    } catch (error) {
      const canRetrySafely =
        error.workerCrash && completionMode === "surface" && preserveInput;
      fusionWorker.current?.terminate();
      fusionWorker.current = null;
      if (!canRetrySafely) throw error;
      setFusion({
        stage: "retrying with a mobile-safe grid",
        progress: 5,
      });
      try {
        const result = await runWorker({
          ...baseOptions,
          reconstructionProfile: "mobile-safe-retry",
          maxDimension: 112,
          maxCells: 520000,
          maxKeyframes: 28,
          minVoxelSize: 0.03,
        });
        if (result?.diagnostics)
          result.diagnostics.workerRecovery = {
            retried: true,
            profile: "mobile-safe-retry",
          };
        return result;
      } catch (retryError) {
        if (!retryError.workerCrash) throw retryError;
        throw new Error(
          "The phone ran out of reconstruction capacity twice. The scan is still available; try finishing again after closing other browser tabs.",
        );
      }
    }
  }
  async function acceptResult(result, partialSave = false) {
    if (finished.current) return;
    setBusy(true);
    result.captureQuality.partialCapture = partialSave;
    finished.current = true;
    try {
      await scanner.current.stop();
      onSurface(result);
    } finally {
      setBusy(false);
    }
  }
  function continueCapture() {
    setPartial(null);
    setPreflight(null);
    if (scanner.current && !scanner.current.originChanged) {
      scanner.current.paused = false;
      scanner.current.publish();
    }
  }
  async function finishSurface(allowPartial = false) {
    setPreflight(null);
    setBusy(true);
    setError("");
    setFusion({ stage: "preparing", progress: 0 });
    try {
      const raw = scanner.current.result();
      scanner.current.paused = true;
      debugCapture.current = snapshotDepthCapture(raw);
      const rawCapture = {
        keyframes: raw.keyframes,
        textureKeyframes: raw.textureKeyframes || [],
        floorY: raw.floorY,
        observer: raw.observer,
        maxTextureSize: raw.maxTextureSize || 4096,
        stats: raw.stats,
      };
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
          rawCapture,
        });
        return;
      }
      const scanCloud = buildScanCloud(acceptedPoints, {
        floorY: raw.floorY,
        observer: raw.observer,
        voxelSize: raw.stats.cloudCellSize,
        floorOutlierTolerance: FLOOR_OUTLIER_TOLERANCE_METERS,
      });
      const surfaceResult = {
        version: 2,
        kind: "validated-measured-surface",
        name: "Measured surface scan",
        walls: [],
        floorObserved: Number.isFinite(raw.floorY),
        ceilingObserved: false,
        pointCount: acceptedPoints.length,
        reason: "ScanSpace saved the surfaces you captured and checked their overlap.",
        cloud: scanCloud,
        mesh: fused.mesh,
        fusionMode: "multi-view",
        captureQuality: captureQualitySummary(raw.stats, fused.diagnostics),
        debugCapture: debugCapture.current,
        // This is the source of truth for the scan export. It is deliberately
        // kept alongside the preview mesh only while the result is in memory;
        // exportScan serializes this capture and omits the derived mesh.
        rawCapture,
        fusionDiagnostics: fused.diagnostics,
        measuredGapWarning: fused.diagnostics?.measuredGapWarning || null,
        measuredReviewWarning:
          fused.diagnostics?.measuredReviewWarning || null,
      };
      const audit = auditCapture(raw.stats, fused.diagnostics);
      surfaceResult.captureQuality.captureAudit = audit;
      if (!audit.passed && !allowPartial) {
        setPartial({ result: surfaceResult, audit, pointCount: acceptedPoints.length });
        return;
      }
      await acceptResult(surfaceResult, !audit.passed);
    } catch (surfaceError) {
      setError(surfaceError.message);
      if (scanner.current && !scanner.current.originChanged) scanner.current.paused = false;
    } finally {
      fusionWorker.current?.terminate();
      fusionWorker.current = null;
      setFusion(null);
      setBusy(false);
    }
  }
  async function finishScan() {
    try {
      const current = scanner.current.result();
      const audit = auditCapture(current.stats);
      if (!audit.passed) {
        scanner.current.paused = true;
        scanner.current.publish();
        setPreflight(audit);
        return;
      }
      return finishSurface();
    } catch (finishError) {
      setError(finishError.message);
    }
  }
  return (
    <div className={`ss-scanner ${active || (busy && fusion) ? "is-scanning" : ""} ${preflight || partial ? "is-reviewing" : ""} ${active && !busy ? "is-capturing" : ""}`}>
      <canvas className="ss-xr-canvas" ref={canvas} />
      <div className="ss-scan-overlay" ref={overlay}>
        <div className="ss-scan-heading">
          <span className="ss-kicker">ScanSpace capture</span>
          <h2>
            {busy && fusion
              ? "Reconstructing capture"
              : active && (preflight || partial)
                ? "Review your capture"
              : active
                ? stats.depthActive
                  ? "Depth scanning"
                  : "Looking for depth"
              : "Bring your space into ScanSpace."}
          </h2>
          <p>
            {busy && fusion
              ? "Using the accepted depth frames already captured."
              : active
                ? stats.paused
                  ? "Scanning paused."
                  : !stats.tracking
                    ? "Tracking lost. Move slowly toward an area you already scanned."
                    : stats.depthActive
                      ? "Move slowly across the surfaces you want to capture. ScanSpace records what you show it."
                      : "Move slowly across the area while ScanSpace looks for depth."
              : "Your scan stays on this phone during capture. Depth and captured colors depend on the capabilities granted by your browser."}
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
        {active && !busy && (
          <>
            <div className="ss-scan-live">
              <div>
                <strong>
                  {Math.round((stats.currentConfirmedRatio || 0) * 100)}%
                </strong>
                <span>current view confirmed</span>
              </div>
              <div>
                <strong>{stats.floorAutoDetected ? "Ready" : "Finding"}</strong>
                <span>floor detection</span>
              </div>
              <div>
                <strong>{stats.connectedSurfaceCoverage || 0}%</strong>
                <span>observed area confirmed</span>
              </div>
            </div>
            <CaptureCoverage coverage={stats.adaptiveCapture?.coverage} />
            <div className="ss-scan-area-key" aria-label="Scanned area legend">
              <span>
                <i className="is-observed" /> Translucent mint = confirmed depth overlap
              </span>
              <span><i className="is-recovery" /> Amber = area to revisit</span>
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
                  : partial || preflight
                    ? "Capture is paused after validation. Keep scanning to add more coverage."
                    : stats.depthCurrent
                    ? "Depth frames are being received."
                    : stats.depthState === "stalled"
                      ? "Depth frames have stopped. Hold still and let tracking recover."
                      : stats.depthState === "error"
                        ? "A depth read was interrupted. ScanSpace is retrying automatically."
                        : stats.depthActive
                          ? "Depth frames are starting again. Hold still over the surface."
                          : "Waiting for the device to provide depth data."}{" "}
                {stats.colorActive
                  ? "Camera colors captured."
                  : "Captured colors unavailable."}
              </p>
              <p className="ss-scan-hint">
                {partial || preflight
                  ? "Your captured views are still available; nothing was discarded."
                  : <>{captureGuidance(stats, busy)}{" "}
                    Mint coverage marks areas confirmed from multiple saved views.
                    Keep moving until the visible surface is evenly tinted; clear
                    gaps still need another angle.</>}
              </p>
              {!busy && !partial && !hasReconstructableCapture && (
                <p className="ss-scan-hint">
                  Capture at least two nearby depth views before finishing.
                </p>
              )}
              {!busy &&
                !partial &&
                hasReconstructableCapture &&
                !surfaceReadiness.ready && (
                  <p className="ss-scan-hint">
                    Add another overlapping pass for stronger coverage. Review
                    scan lets you check the result or save a partial capture.
                  </p>
                )}
              {(stats.cloudCompactions > 0 || stats.fusionKeyframeCompactions > 0) && (
                <p className="ss-scan-hint">
                    Capture density was optimized while preserving connections between saved views.
                </p>
              )}
              {stats.full && (
                <p className="ss-error">
                  Capture density is at its safe limit. If the scan still
                  cannot be finished, restart and scan with steadier overlap.
                </p>
              )}
              {preflight ? (
                <CaptureAuditNotice audit={preflight} onContinue={continueCapture}
                  onSave={() => finishSurface(true)} saving={busy} />
              ) : partial?.audit ? (
                <CaptureAuditNotice audit={partial.audit} onContinue={continueCapture}
                  onSave={() => acceptResult(partial.result, true)} saving={busy} />
              ) : !partial ? (
                <div className="ss-actions">
                  {stats.paused && !stats.originChanged && !busy && (
                    <button
                      type="button"
                      onClick={() => scanner.current?.togglePause()}
                    >
                      Resume capture
                    </button>
                  )}
                  <button disabled={busy} onClick={cancelScan}>
                    Cancel scan
                  </button>
                  <button
                    className="ss-primary"
                    disabled={busy || stats.originChanged || !hasReconstructableCapture}
                    onClick={finishScan}
                  >
                    Review scan
                  </button>
                </div>
              ) : (
                <section className="ss-partial-capture" role="status">
                  <strong>Scan processing paused</strong>
                  <p>
                    ScanSpace kept {partial.pointCount.toLocaleString()} measured
                    points. Processing stopped for the reason below; your
                    capture was not discarded.
                  </p>
                  <p className="ss-partial-reason">{partial.reason}</p>
                  <div className="ss-actions">
                    <button
                      disabled={busy}
                      onClick={continueCapture}
                    >
                      Keep scanning
                    </button>
                    <button disabled={busy} onClick={cancelScan}>
                      Cancel scan
                    </button>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
        {busy && fusion && (
          <ScanRenderProgress
            stage={fusion.stage}
            progress={fusion.progress}
            title="Building your captured scan"
            detail="Capture is paused. Your saved depth frames are safe while the result is built."
            variant="scanner"
          />
        )}
        {busy && !fusion && (
          <p className="ss-notice" role="status">
            {active ? "Preparing captured frames…" : "Starting camera…"}
          </p>
        )}
        {error && (
          <p className="ss-error" role="alert">
            {error}
          </p>
        )}
        {!busy && (
          <details className="ss-diagnostics">
            <summary>Device diagnostics</summary>
            <dl>
            {Object.entries({
              browser: capabilities.browser,
              secure: capabilities.secure,
              immersiveAR: capabilities.ar,
              grantedFeatures: stats.features?.join(", ") || "None",
              depthFrames: stats.depthFrames,
              captureState: stats.adaptiveCapture?.state || "starting",
              captureProfile: stats.captureProfile || "careful",
              captureIntervalMs: stats.captureIntervalMs || 0,
              captureProcessingMs: stats.captureProcessingMs || 0,
              provisionalViews: stats.adaptiveCapture?.pendingCount || 0,
              reconnectedViews: stats.adaptiveCapture?.promoted || 0,
              recoveryEvents: stats.adaptiveCapture?.recoveries || 0,
              depthState: stats.depthState || "waiting",
              depthMisses: stats.depthMisses || 0,
              depthReadErrors: stats.depthReadErrors || 0,
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
              rejectedPoseFrames: stats.rejectedPoseFrames || 0,
              poseOverlapRatio: `${Math.round((stats.poseOverlapRatio || 0) * 100)}%`,
              poseMedianResidual: `${Math.round((stats.poseMedianResidual || 0) * 100)} cm`,
              poseUpperResidual: `${Math.round((stats.poseUpperResidual || 0) * 100)} cm`,
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
        )}
      </div>
    </div>
  );
}
