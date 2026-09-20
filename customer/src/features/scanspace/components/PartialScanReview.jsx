import { useEffect, useState } from "react";
import { CheckCircle, Info, WarningCircle } from "@phosphor-icons/react";
import PartialScanScene from "./PartialScanScene";
import ScanRenderProgress from "./ScanRenderProgress";
import { downloadDepthCapture } from "../core/captureDebug";
import { downloadScan } from "../core/partialScanFile";
import { buildScanCloud } from "../core/scanCloud";
import { scanFusionOptions } from "../core/fusionOptions";
import { createFusionWorker } from "../core/createFusionWorker";
import {
  MIN_CAMERA_BASELINE_METERS,
  MIN_DIRECTION_COVERAGE,
} from "../core/readiness";

const hasCheckedPreview = scan => !!(scan.mesh && scan.fusionDiagnostics &&
  scan.captureQuality?.captureAudit?.checkedReconstruction === true);

export default function PartialScanReview({
  scan,
  onCompleteManually,
  onRescan,
  onDone,
}) {
  const [exportError, setExportError] = useState("");
  const [renderedScan, setRenderedScan] = useState(() =>
    scan.rawCapture && !hasCheckedPreview(scan) ? null : scan,
  );
  const [renderError, setRenderError] = useState("");
  const [renderProgress, setRenderProgress] = useState({
    stage: "preparing",
    progress: 0,
  });
  useEffect(() => {
    // The live review already reconstructed this exact capture. Reuse its
    // checked mesh on save; imported raw files still require reconstruction.
    if (!scan.rawCapture?.keyframes?.length || hasCheckedPreview(scan)) {
      setRenderedScan(scan);
      setRenderError("");
      setRenderProgress(null);
      return undefined;
    }
    let active = true;
    const worker = createFusionWorker();
    setRenderedScan(null);
    setRenderError("");
    setRenderProgress({ stage: "preparing", progress: 0 });
    worker.onmessage = (event) => {
      if (!active) return;
      if (event.data.type === "progress") {
        setRenderProgress({
          stage: event.data.stage || "preparing",
          progress: event.data.progress,
        });
        return;
      }
      if (event.data.type === "error") {
        setRenderProgress(null);
        setRenderError(event.data.error || "The raw scan could not be rendered.");
        const points = rawCapturePoints(scan.rawCapture);
        setRenderedScan({
          ...scan,
          mesh: null,
          cloud: points.length
            ? buildScanCloud(points, {
                floorY: scan.rawCapture.floorY,
                observer: scan.rawCapture.observer,
                voxelSize: scan.rawCapture.stats?.cloudCellSize,
              })
            : null,
        });
        return;
      }
      if (event.data.type !== "complete") return;
      setRenderProgress(null);
      const fused = event.data.result;
      const points = observationPoints(fused.observations) || rawCapturePoints(scan.rawCapture);
      const cloud = points.length
        ? buildScanCloud(points, {
            floorY: scan.rawCapture.floorY,
            observer: scan.rawCapture.observer,
            voxelSize: scan.rawCapture.stats?.cloudCellSize,
          })
        : null;
      if (!fused.mesh && !cloud) {
        setRenderError(fused.diagnostics?.reason || "The raw scan did not contain enough measured depth.");
        return;
      }
      setRenderedScan({
        ...scan,
        mesh: fused.mesh || null,
        cloud,
        pointCount: points.length || scan.pointCount,
        fusionMode: "raw-import-rendered",
        fusionDiagnostics: fused.diagnostics,
        fusionReason: fused.diagnostics?.reason || scan.fusionReason,
        measuredReviewWarning: fused.diagnostics?.measuredReviewWarning || null,
        measuredGapWarning: fused.diagnostics?.measuredGapWarning || null,
        captureQuality: {
          ...(scan.captureQuality || {}),
          algorithmVersion: fused.diagnostics?.algorithmVersion || scan.captureQuality?.algorithmVersion,
          fusionSettings:
            fused.diagnostics?.fusionSettings || scan.captureQuality?.fusionSettings || null,
          fusedKeyframes: fused.diagnostics?.keyframes || 0,
          independentTextureFrames: fused.diagnostics?.independentTextureFrames || 0,
          planarConsolidation: fused.diagnostics?.planarConsolidation || null,
          denoising: fused.diagnostics?.denoising || null,
          synchronizedTextureFrames: fused.diagnostics?.alignment?.synchronizedTextureFrames || 0,
          poseRefinement: fused.diagnostics?.alignment?.poseRefinement || null,
          jointPoseRefinement: fused.diagnostics?.alignment?.jointPoseRefinement || null,
          surfaceRepair: fused.diagnostics?.surfaceRepair || null,
          structuralDepth: fused.diagnostics?.structuralDepth || null,
          structuralRebuild: fused.diagnostics?.structuralRebuild || null,
          topology: fused.diagnostics?.topologyAfterRepair || null,
          recoveredCaptureGroups: fused.diagnostics?.alignment?.componentRecovery || null,
          textureSelection: fused.diagnostics?.textureSelection || null,
          textureRegistration: fused.diagnostics?.textureRegistration || [],
        },
      });
    };
    worker.onerror = () => {
      if (!active) return;
      setRenderProgress(null);
      setRenderError("The raw scan renderer stopped unexpectedly.");
      const points = rawCapturePoints(scan.rawCapture);
      setRenderedScan({
        ...scan,
        mesh: null,
        cloud: points.length
          ? buildScanCloud(points, {
              floorY: scan.rawCapture.floorY,
              observer: scan.rawCapture.observer,
              voxelSize: scan.rawCapture.stats?.cloudCellSize,
            })
          : null,
      });
    };
    worker.postMessage({
      keyframes: scan.rawCapture.keyframes,
      options: scanFusionOptions(scan.rawCapture, "surface"),
    });
    return () => {
      active = false;
      worker.terminate();
    };
  }, [scan]);
  const displayScan = renderedScan || scan;
  const quality = displayScan.captureQuality;
  const repair = displayScan.mesh?.surfaceRepair || quality?.surfaceRepair;
  const rawRendering = !!scan.rawCapture && !renderedScan && !renderError;
  if (rawRendering)
    return (
      <section className="ss-partial-review ss-partial-review--rendering">
        <ScanRenderProgress
          stage={renderProgress?.stage}
          progress={renderProgress?.progress}
          title="Rendering your captured scan"
        />
      </section>
    );
  if (renderError && !renderedScan)
    return (
      <section className="ss-partial-review">
        <div className="ss-notice ss-notice--warning" role="alert">
          <strong>Raw scan could not be rendered</strong>
          <p>{renderError}</p>
        </div>
        <button type="button" onClick={onDone}>Back to ScanSpace</button>
      </section>
    );
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
    }).filter((point) => [point.x, point.y, point.z].every(Number.isFinite));
  }
  function rawCapturePoints(capture) {
    const points = [];
    for (const frame of capture.keyframes || [])
      for (let index = 0; index < frame.positions.length / 3; index++) {
        const offset = index * 3;
        if (![frame.positions[offset], frame.positions[offset + 1], frame.positions[offset + 2]].every(Number.isFinite)) continue;
        const point = { x: frame.positions[offset], y: frame.positions[offset + 1], z: frame.positions[offset + 2] };
        if (frame.colorMask?.[index]) point.color = Array.from(frame.colors.slice(offset, offset + 3));
        points.push(point);
      }
    return points;
  }
  return (
    <section className="ss-partial-review">
      {renderError && (
        <div className="ss-notice ss-notice--warning" role="status">
          <strong>Showing captured points</strong>
          <p>{renderError} The raw source is still available for export.</p>
        </div>
      )}
      <header>
        <span className="ss-kicker">Scan result</span>
        <h2>Your captured scan.</h2>
        <p>
          Rebuilt from your captured camera images and depth. Small, supported
          wall, floor, or ceiling gaps may be repaired as estimates; larger unscanned areas
          and uncertain object details remain open.
        </p>
        {quality?.algorithmVersion && (
          <p className="ss-notice-detail">Reconstruction v{quality.algorithmVersion}
            {quality.fusedKeyframes ? ` · ${quality.fusedKeyframes} depth views` : ""}
            {quality.independentTextureFrames ? ` · ${quality.independentTextureFrames} photos` : ""}
          </p>
        )}
      </header>
      {quality &&
        (quality.coverage < MIN_DIRECTION_COVERAGE ||
          quality.cameraBaseline < MIN_CAMERA_BASELINE_METERS) && (
          <div className="ss-notice ss-notice--guidance">
            <div className="ss-notice-title">
              <Info size={17} weight="fill" aria-hidden="true" />
              <strong>Capture coverage</strong>
            </div>
            <p>
              This scan covers {quality.coverage}% of the heading sweep with {Math.round(
                quality.cameraBaseline * 100,
              )} cm of horizontal camera-position spread. ScanSpace only shows
              supported surfaces and separately identifies estimated repairs; curved walls can indicate unreliable depth.
              For the next scan, move sideways while keeping each wall in view.
            </p>
          </div>
        )}
      {displayScan.measuredReviewWarning ? (
        <div className="ss-notice ss-notice--warning" role="status">
          <div className="ss-notice-title">
            <WarningCircle size={17} weight="fill" aria-hidden="true" />
            <strong>Automatic checks found possible scan issues</strong>
          </div>
          <p>
            Inspect the reconstructed surface before accepting it. Any small
            estimated repairs are listed separately below.
          </p>
          <ul>
            {displayScan.measuredReviewWarning.issues?.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : displayScan.measuredGapWarning ? (
        <div className="ss-notice ss-notice--warning" role="status">
          <div className="ss-notice-title">
            <WarningCircle size={17} weight="fill" aria-hidden="true" />
            <strong>Some areas remain unmeasured</strong>
          </div>
          <p>
            Some regions did not provide reliable depth and remain open in this
            result. No unseen object detail has been generated.
          </p>
        </div>
      ) : null}
      {repair?.estimatedHoleCount > 0 && (
        <div className="ss-notice ss-notice--guidance" role="status">
          <strong>Estimated gap repairs</strong>
          <p>{repair.estimatedHoleCount} small, enclosed surface gaps
            ({repair.estimatedArea.toFixed(2)} m²) were repaired from their surrounding surfaces.
            These patches are estimates, not measured depth.</p>
        </div>
      )}
      {quality?.structuralRebuild?.reconstructedArea > 0 && (
        <p className="ss-notice-detail" role="status">
          Supported floor and ceiling regions were rebuilt from overlapping depth views.
          Check the sides and the ceiling in Walk inside; unscanned object faces remain open.
        </p>
      )}
      <PartialScanScene scan={displayScan} />
      <div className="ss-partial-facts" aria-label="Scan measurements">
        <div>
          <strong>
            {displayScan.mesh
              ? displayScan.mesh.triangleCount.toLocaleString()
              : displayScan.cloud?.count?.toLocaleString() || 0}
          </strong>
          <span>{displayScan.mesh ? "surface triangles" : "captured depth points"}</span>
        </div>
        <div>
          <strong>
            {displayScan.mesh?.textureCoverage ??
              displayScan.mesh?.colorCoverage ??
              displayScan.cloud?.colorCoverage ??
              0}%
          </strong>
          <span>{displayScan.mesh ? "surface color coverage" : "point color coverage"}</span>
        </div>
      </div>
      {displayScan.mesh?.observedSideOriented && (
        <p className="ss-notice-detail">Unscanned backs are shown in neutral gray, without a mirrored photograph.</p>
      )}
      {displayScan.fusionReason && (
        <div className="ss-notice ss-notice--status">
          <div className="ss-notice-title">
            <Info size={17} weight="fill" aria-hidden="true" />
            <strong>{displayScan.mesh ? "Measured surface" : "Surface preview fallback"}</strong>
          </div>
          <p>
            {displayScan.mesh
              ? displayScan.fusionReason
              : `Surface reconstruction fallback: ${displayScan.fusionReason} The measured RGB-D points are shown instead.`}
          </p>
        </div>
      )}
      <div className="ss-notice ss-notice--success">
        <div className="ss-notice-title">
          <CheckCircle size={17} weight="fill" aria-hidden="true" />
          <strong>Scan saved</strong>
        </div>
        <p>
          This scan can be exported and opened on another device. Continue with
          measurements whenever you want to turn the captured surfaces into a
          room layout.
        </p>
        <p className="ss-notice-detail">
          <strong>Structural detection status:</strong> {displayScan.reason}
        </p>
        {displayScan.rawCapture && (
          <p className="ss-notice-detail">
            <strong>Export format:</strong> Raw RGB-D capture; importing it rebuilds this result on the device.
          </p>
        )}
      </div>
      {exportError && (
        <p role="alert" className="ss-error">
          {exportError}
        </p>
      )}
      <div className="ss-actions">
        <button
          type="button"
          onClick={() => {
            try {
              downloadScan(displayScan);
              setExportError("");
            } catch (reason) {
              setExportError(
                reason.message || "The scan could not be exported.",
              );
            }
          }}
        >
          Export raw scan
        </button>
        {scan.debugCapture && (
          <button type="button" onClick={() =>
            downloadDepthCapture(scan.debugCapture, scan.fusionDiagnostics)}>
            Download scan diagnostics
          </button>
        )}
        <button className="ss-action-quiet" type="button" onClick={onDone}>
          Back to ScanSpace
        </button>
        <button type="button" onClick={onRescan}>
          Start a new scan
        </button>
        <button
          className="ss-primary"
          type="button"
          onClick={() => onCompleteManually(displayScan)}
        >
          Continue with measurements
        </button>
      </div>
    </section>
  );
}
