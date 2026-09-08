import PartialScanScene from "./PartialScanScene";
import { downloadDepthCapture } from "../core/captureDebug";

export default function PartialScanReview({ scan, onRescan, onDone }) {
  const quality = scan.captureQuality;
  return (
    <section className="ss-partial-review">
      <header>
        <span className="ss-kicker">Partial scan finished</span>
        <h2>Your captured room.</h2>
        <p>
          This view is built from the camera colors and depth points that were
          actually captured. Missing areas remain open instead of becoming
          generated walls.
        </p>
      </header>
      {quality &&
        (quality.coverage < 50 || quality.cameraBaseline < 0.25) && (
          <p className="ss-notice">
            This is a limited viewing sector, not a room-shaped capture: {quality.coverage}%
            heading coverage and {Math.round(quality.cameraBaseline * 100)} cm
            of horizontal camera-position spread. A thin or curved open shell is expected.
            For the next scan, move sideways while keeping each wall in view.
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
          {scan.mesh?.kind === "measured-depth-surface"
            ? "single-view measured triangles"
            : scan.mesh
              ? "reconstructed triangles"
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
