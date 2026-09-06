import PartialScanScene from "./PartialScanScene";

export default function PartialScanReview({ scan, onRescan, onDone }) {
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
      <PartialScanScene scan={scan} />
      <div className="ss-partial-facts">
        <span>
          <strong>
            {scan.mesh
              ? scan.mesh.triangleCount.toLocaleString()
              : scan.cloud?.count?.toLocaleString() || 0}
          </strong>
          {scan.mesh ? "reconstructed triangles" : "rendered depth points"}
        </span>
        <span>
          <strong>
            {scan.mesh?.textureCoverage ??
              scan.mesh?.colorCoverage ??
              scan.cloud?.colorCoverage ??
              0}%
          </strong>
          textured surface coverage
        </span>
      </div>
      <p className="ss-notice">
        The room editor and material estimates stay unavailable until a closed
        footprint is measured. Structural detection status: {scan.reason}
      </p>
      <div className="ss-actions">
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
