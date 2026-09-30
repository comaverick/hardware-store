import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowsLeftRight, Camera, SquaresFour } from "@phosphor-icons/react";
import { RoomScanner } from "../xr/RoomScanner";
import { buildScanCloud } from "../core/scanCloud";
import { snapshotDepthCapture, downloadDepthCapture } from "../core/captureDebug";
import { FLOOR_OUTLIER_TOLERANCE_METERS } from "../core/readiness";
import { scanFusionOptions } from "../core/fusionOptions";
import ScanRenderProgress from "./ScanRenderProgress";
import { auditCapture } from "../core/adaptiveCapture";
import { captureFeedback } from "../core/captureExperience";
import { CaptureAuditNotice, CaptureProgress } from "./CaptureFeedback";
import { createFusionWorker } from "../core/createFusionWorker";
const PartialScanScene = lazy(() => import("./PartialScanScene"));
const SHOW_SCAN_DIAGNOSTICS = process.env.NODE_ENV === "development";

class CapturePreviewBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p role="status">The preview could not open on this device. Your checked capture is still available to save.</p>
      : this.props.children;
  }
}

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
  captureDiagnostics: stats.captureDiagnostics || null,
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
  structuralRebuildValidation: fusion?.structuralRebuildValidation || null,
  untexturedEstimatedTriangles: fusion?.untexturedEstimatedTriangles || 0,
  topology: fusion?.topologyAfterRepair || null,
  recoveredCaptureGroups: fusion?.alignment?.componentRecovery || null,
  surfaceRepair: fusion?.surfaceRepair || null,
});

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
    reviewing = useRef(false),
    finished = useRef(false),
    lastFeedbackCode = useRef(""),
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
  const hasReconstructableCapture = (stats.fusionKeyframes || 0) >= 2 &&
    stats.adaptiveCapture?.connected !== false;
  const targetState = captureFeedback(stats);
  useEffect(() => {
    if (!active || busy || partial || lastFeedbackCode.current === targetState.code) return;
    lastFeedbackCode.current = targetState.code;
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    if (targetState.tone === "warning") navigator.vibrate(45);
    if (targetState.tone === "complete") navigator.vibrate([20, 45, 20]);
  }, [active, busy, partial, targetState.code, targetState.tone]);
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
    reviewing.current = false;
    lastFeedbackCode.current = "";
    setBusy(true);
    finished.current = false;
    const s = new RoomScanner({
      canvas: canvas.current,
      overlay: overlay.current,
      onUpdate: setStats,
      onEnd: () => {
        setActive(false);
        if (!finished.current && !reviewing.current)
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
    if (!active || !scanner.current || scanner.current.originChanged) return;
    setPartial(null);
    reviewing.current = false;
    scanner.current.paused = false;
    scanner.current.publish();
  }
  async function finishSurface() {
    setBusy(true);
    setError("");
    setFusion({ stage: "preparing", progress: 0 });
    try {
      const raw = scanner.current.result();
      reviewing.current = true;
      scanner.current.paused = true;
      scanner.current.publish();
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
      // Review always shows the checked saved result before asking the user
      // whether to save or add coverage. Unconfirmed observations stay out.
      setPartial({ result: surfaceResult, audit, pointCount: acceptedPoints.length });
    } catch (surfaceError) {
      reviewing.current = false;
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
    if (!busy && !finished.current) return finishSurface();
  }
  return (
    <div className={`ss-scanner ${active || partial || (busy && fusion) ? "is-scanning" : ""} ${partial ? "is-reviewing" : ""} ${active && !busy && !partial ? "is-capturing" : ""}`}>
      <canvas className="ss-xr-canvas" ref={canvas} />
      <div className="ss-scan-overlay" ref={overlay}>
        <div className="ss-scan-heading">
          <span className="ss-kicker">ScanSpace capture</span>
          <h2>
            {busy && fusion
              ? "Reconstructing capture"
              : partial
                ? "Review your capture"
              : active
                ? "Scan your space"
              : "Bring your space into ScanSpace."}
          </h2>
          <p>
            {busy && fusion
              ? "Using the accepted depth frames already captured."
              : active
                ? stats.paused
                  ? "Scanning paused."
                  : "Move slowly and overlap each pass."
              : "Your scan stays on this phone during capture. Depth and captured colors depend on the capabilities granted by your browser."}
          </p>
        </div>
        {!active && !busy && !partial && (
          <section className="ss-scan-guide" aria-labelledby="ss-scan-guide-title">
            <h3 id="ss-scan-guide-title">Before you start</h3>
            <ul>
              <li><Camera aria-hidden="true" size={20} weight="bold" /><span><strong>Move slowly</strong><small>Keep one surface in view as you take a small sideways step.</small></span></li>
              <li><ArrowsLeftRight aria-hidden="true" size={20} weight="bold" /><span><strong>Overlap each pass</strong><small>Keep part of the previous area visible while you turn.</small></span></li>
              <li><SquaresFour aria-hidden="true" size={20} weight="bold" /><span><strong>Choose your area</strong><small>Two walls, a floor, and a ceiling are fine. Unscanned space will stay open.</small></span></li>
            </ul>
          </section>
        )}
        {!active && !busy && !partial && (
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
        {(active || partial) && !busy && (
          <>
            {!partial && <CaptureProgress stats={stats} />}
            <div className="ss-scan-bottom">
              {!partial && <div className={`ss-scanning-target is-${targetState.tone}`} role="status" aria-live="polite" aria-atomic="true">
                <i aria-hidden="true" />
                <span><strong>{targetState.label}</strong><small>{targetState.hint}</small></span>
              </div>}
              {partial?.result && <div className="ss-capture-review-preview" aria-label="Captured scan preview">
                <CapturePreviewBoundary>
                  <Suspense fallback={<p role="status">Opening your preview…</p>}>
                    <PartialScanScene scan={partial.result} compact />
                  </Suspense>
                </CapturePreviewBoundary>
              </div>}
              {partial?.audit ? (
                <CaptureAuditNotice audit={partial.audit} onContinue={continueCapture}
                  onSave={() => acceptResult(partial.result, !partial.audit.passed)} saving={busy}
                  canContinue={active && !stats.originChanged} />
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
                    aria-describedby="ss-capture-next"
                    disabled={busy || stats.originChanged || !hasReconstructableCapture}
                    onClick={finishScan}
                  >
                    {stats.depthRecoveryState === "stalled" ? "Review saved scan" : "Finish & review"}
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
                      disabled={busy || !active || stats.originChanged}
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
        {!busy && SHOW_SCAN_DIAGNOSTICS && (
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
              pendingExpired: stats.adaptiveCapture?.pendingAgeDrops || 0,
              pendingCapacityDrops: stats.adaptiveCapture?.pendingCapacityDrops || 0,
              pendingRedundantDrops: stats.adaptiveCapture?.pendingRedundantDrops || 0,
              captureActiveSeconds: Math.round((stats.captureDiagnostics?.activeMs || 0) / 1000),
              recoverySeconds: Math.round((stats.captureDiagnostics?.stateMs?.recovering || 0) / 1000),
              promptsShown: stats.captureDiagnostics?.promptCount || 0,
              gateLinearSpeed: stats.gateLinearSpeed || 0,
              gateAngularSpeed: stats.gateAngularSpeed || 0,
              maxLinearSpeed: stats.maxLinearSpeed || 0,
              maxAngularSpeed: stats.maxAngularSpeed || 0,
              decisionsByReason: JSON.stringify(stats.captureDiagnostics?.decisions || {}),
              depthState: stats.depthState || "waiting",
              depthRecoveryState: stats.depthRecoveryState || "waiting",
              depthFailureKind: stats.depthFailureKind || "None",
              depthFailureMs: stats.depthFailureMs || 0,
              depthRecoveries: stats.depthRecoveries || 0,
              depthMisses: stats.depthMisses || 0,
              totalDepthMisses: stats.totalDepthMisses || 0,
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
