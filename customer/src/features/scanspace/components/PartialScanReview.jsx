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
        <span className="ss-kicker">Incomplete scan preview</span>
        <h2>Your measured surfaces.</h2>
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
      <PartialScanScene scan={scan} />
      {scan.structuralRepair?.cleanSurface && (
        <p className="ss-notice ss-inference-notice">
          Clean walls is shown by default. It replaces bowed depth fragments
          with flat wall panels constrained to the measured wall bounds, so
          sensor holes do not remain in the presentation
          {scan.structuralRepair.inferredWindowCount
            ? ` and marks ${scan.structuralRepair.inferredWindowCount} enclosed rectangular dropout as a probable window panel`
            : ""}
          . Switch to Captured to inspect the unchanged raw reconstruction.
          These fitted panels do not claim that unscanned room directions were
          measured.
        </p>
      )}
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
