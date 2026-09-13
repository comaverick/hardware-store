import { useState } from "react";
import { CheckCircle, Info, WarningCircle } from "@phosphor-icons/react";
import PartialScanScene from "./PartialScanScene";
import { downloadDepthCapture } from "../core/captureDebug";
import { downloadScan } from "../core/partialScanFile";
import {
  MIN_CAMERA_BASELINE_METERS,
  MIN_DIRECTION_COVERAGE,
} from "../core/readiness";

export default function PartialScanReview({
  scan,
  onCompleteManually,
  onRescan,
  onDone,
}) {
  const [exportError, setExportError] = useState("");
  const quality = scan.captureQuality;
  return (
    <section className="ss-partial-review">
      <header>
        <span className="ss-kicker">Scan result</span>
        <h2>Your captured scan.</h2>
        <p>
          This view is built from the camera colors and depth points that were
          actually captured. Missing areas remain open instead of becoming
          generated walls.
        </p>
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
              the surfaces you captured; curved walls can indicate unreliable depth.
              For the next scan, move sideways while keeping each wall in view.
            </p>
          </div>
        )}
      {scan.measuredReviewWarning ? (
        <div className="ss-notice ss-notice--warning" role="status">
          <div className="ss-notice-title">
            <WarningCircle size={17} weight="fill" aria-hidden="true" />
            <strong>Automatic checks found possible scan issues</strong>
          </div>
          <p>
            This is still the real measured mesh. Inspect it before accepting;
            ScanSpace did not add replacement wall geometry.
          </p>
          <ul>
            {scan.measuredReviewWarning.issues?.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : scan.measuredGapWarning ? (
        <div className="ss-notice ss-notice--warning" role="status">
          <div className="ss-notice-title">
            <WarningCircle size={17} weight="fill" aria-hidden="true" />
            <strong>Some areas remain unmeasured</strong>
          </div>
          <p>
            Some regions did not provide reliable depth and remain open in this
            result. ScanSpace did not generate replacement wall geometry.
          </p>
        </div>
      ) : null}
      <PartialScanScene scan={scan} />
      <div className="ss-partial-facts" aria-label="Scan measurements">
        <div>
          <strong>
            {scan.mesh
              ? scan.mesh.triangleCount.toLocaleString()
              : scan.cloud?.count?.toLocaleString() || 0}
          </strong>
          <span>{scan.mesh ? "measured triangles" : "captured depth points"}</span>
        </div>
        <div>
          <strong>
            {scan.mesh?.textureCoverage ??
              scan.mesh?.colorCoverage ??
              scan.cloud?.colorCoverage ??
              0}%
          </strong>
          <span>{scan.mesh ? "surface color coverage" : "point color coverage"}</span>
        </div>
      </div>
      {scan.fusionReason && (
        <div className="ss-notice ss-notice--status">
          <div className="ss-notice-title">
            <Info size={17} weight="fill" aria-hidden="true" />
            <strong>{scan.mesh ? "Measured surface" : "Surface preview fallback"}</strong>
          </div>
          <p>
            {scan.mesh
              ? scan.fusionReason
              : `Surface reconstruction fallback: ${scan.fusionReason} The measured RGB-D points are shown instead.`}
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
          <strong>Structural detection status:</strong> {scan.reason}
        </p>
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
              downloadScan(scan);
              setExportError("");
            } catch (reason) {
              setExportError(
                reason.message || "The scan could not be exported.",
              );
            }
          }}
        >
          Export scan
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
          onClick={onCompleteManually}
        >
          Continue with measurements
        </button>
      </div>
    </section>
  );
}
