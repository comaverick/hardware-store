import PartialScanScene from "./PartialScanScene";
import { downloadDepthCapture } from "../core/captureDebug";
import {
  MIN_CAMERA_BASELINE_METERS,
  MIN_DIRECTION_COVERAGE,
} from "../core/readiness";

export default function PartialScanReview({ scan, onRescan, onDone }) {
  const quality = scan.captureQuality;
  return (
    <section className="ss-partial-review">
      <header>
        <span className="ss-kicker">Measured wall result</span>
        <h2>Your captured 3D surface.</h2>
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
            This is a limited viewing sector, not a room-shaped capture: {quality.coverage}%
            heading coverage and {Math.round(quality.cameraBaseline * 100)} cm
            of horizontal camera-position spread. Only part of the room was covered;
            curved walls can also indicate unreliable depth.
            For the next scan, move sideways while keeping each wall in view.
          </p>
        )}
      {scan.measuredGapWarning && (
        <p className="ss-notice">
          Some regions did not provide reliable depth and remain open in this
          result. ScanSpace did not generate replacement wall geometry.
        </p>
      )}
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
            ? "surface texture coverage — not room coverage"
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
        The room editor and material estimates stay unavailable until a closed
        footprint is measured. Structural detection status: {scan.reason}
      </p>
      <div className="ss-actions">
        {scan.debugCapture && (
          <button type="button" onClick={() =>
            downloadDepthCapture(scan.debugCapture, scan.fusionDiagnostics)}>
            Download scan diagnostics
          </button>
        )}
        <button type="button" onClick={onDone}>
          Back to ScanSpace
        </button>
        <button className="ss-primary" type="button" onClick={onRescan}>
          Start a new scan
        </button>
      </div>
    </section>
  );
}
