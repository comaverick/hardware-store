import PartialScanScene from "./PartialScanScene";

export default function PartialScanReview({ scan, onRescan, onDone }) {
  return (
    <section className="ss-partial-review">
      <header>
        <span className="ss-kicker">Partial scan finished</span>
        <h2>Only what the camera measured.</h2>
        <p>
          ScanSpace found {scan.walls.length} stable wall
          {scan.walls.length === 1 ? "" : "s"}. Missing walls were left open
          instead of being guessed.
        </p>
      </header>
      <PartialScanScene scan={scan} />
      <div className="ss-partial-facts">
        <span>
          <strong>{scan.walls.length}</strong>
          measured wall{scan.walls.length === 1 ? "" : "s"}
        </span>
        <span>
          <strong>{scan.ceilingObserved ? "Measured" : "Not measured"}</strong>
          ceiling
        </span>
      </div>
      <p className="ss-notice">
        {scan.reason} The room editor and material estimates stay unavailable
        until a closed footprint is measured.
      </p>
      <p className="ss-small">
        The grid is only a scale reference. It is not a generated floor.
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
