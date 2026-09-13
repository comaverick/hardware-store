import { useState } from "react";
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
          <p className="ss-notice">
            This scan covers {quality.coverage}% of the heading sweep with {Math.round(
              quality.cameraBaseline * 100,
            )} cm of horizontal camera-position spread. ScanSpace only shows
            the surfaces you captured; curved walls can indicate unreliable depth.
            For the next scan, move sideways while keeping each wall in view.
          </p>
        )}
      {scan.measuredReviewWarning ? (
        <div className="ss-notice">
          <strong>Automatic checks found possible scan issues.</strong>
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
        <p className="ss-notice">
          Some regions did not provide reliable depth and remain open in this
          result. ScanSpace did not generate replacement wall geometry.
        </p>
      ) : null}
      <PartialScanScene scan={scan} />
      <div className="ss-partial-facts">
        <span>
          <strong>
            {scan.mesh
              ? scan.mesh.triangleCount.toLocaleString()
              : scan.cloud?.count?.toLocaleString() || 0}
          </strong>
          {scan.mesh
              ? "validated multi-view measured triangles"
              : "rendered depth points"}
        </span>
        <span>
          <strong>
            {scan.mesh?.textureCoverage ??
              scan.mesh?.colorCoverage ??
              scan.cloud?.colorCoverage ??
              0}%
          </strong>
          {scan.mesh
            ? "captured surface color coverage"
            : "captured point color coverage"}
        </span>
      </div>
      {scan.fusionReason && (
        <p className="ss-notice">
          {scan.mesh
            ? scan.fusionReason
            : `Surface reconstruction fallback: ${scan.fusionReason} The measured RGB-D points are shown instead.`}
        </p>
      )}
      <p className="ss-notice">
        This scan can be exported and opened on another device. Continue with
        measurements whenever you want to turn the captured surfaces into a
        room layout. Structural detection status: {scan.reason}
      </p>
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
        <button type="button" onClick={onDone}>
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
