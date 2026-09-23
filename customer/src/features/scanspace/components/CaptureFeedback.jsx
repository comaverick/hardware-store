import { CheckCircle, EyeSlash, WarningCircle } from "@phosphor-icons/react";
import {
  MIN_REGION_CONFIRMATION,
  MIN_REGION_OBSERVATIONS,
} from "../core/adaptiveCapture";
import { MIN_SURFACE_CAMERA_BASELINE_METERS, MIN_SURFACE_FUSION_KEYFRAMES } from "../core/readiness";
import { fastMotionShare } from "../core/captureExperience";

const regionIds = ["lower", "middle", "upper"];
const names = {
  upper: { short: "Upper", long: "Upper surfaces" },
  middle: { short: "Walls", long: "Walls and objects" },
  lower: { short: "Lower", long: "Lower surfaces" },
};
const clampPercent = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

function normalizedRegions(coverage) {
  return regionIds.map(id => ({
    id,
    observed: 0,
    confirmed: 0,
    ratio: 0,
    ...(coverage?.regions || []).find(region => region.id === id),
  }));
}

function regionState(region) {
  if (!region.observed) return "unseen";
  if (region.observed < MIN_REGION_OBSERVATIONS) return "building";
  if (region.ratio < MIN_REGION_CONFIRMATION) return "weak";
  return "complete";
}

export function captureProgressSummary(stats = {}) {
  const adaptive = stats.adaptiveCapture || {};
  const coverage = adaptive.coverage || {};
  const normalized = normalizedRegions(coverage).map(region => ({
    ...region,
    state: regionState(region),
    percent: clampPercent(region.ratio * 100),
  }));
  const overlap = clampPercent(
    Number.isFinite(coverage.ratio)
      ? coverage.ratio * 100
      : stats.connectedSurfaceCoverage,
  );
  const frames = Math.max(0, Number(stats.fusionKeyframes) || 0);
  const weak = normalized.find(region => region.state === "weak");
  const building = normalized.find(region => region.state === "building");
  const observed = normalized.some(region => region.observed > 0);
  const movingTooFast = fastMotionShare(stats, true) >= 0.25;
  const shortBaseline = Number.isFinite(stats.cameraBaseline) && frames >= MIN_SURFACE_FUSION_KEYFRAMES &&
    stats.cameraBaseline < MIN_SURFACE_CAMERA_BASELINE_METERS;
  const hasCapture = frames >= 2 && adaptive.connected !== false;
  const reviewReady = frames >= MIN_SURFACE_FUSION_KEYFRAMES &&
    adaptive.connected !== false && observed && !weak && !building &&
    !(adaptive.pendingCount || 0) && !movingTooFast && !shortBaseline;
  const checking = adaptive.state === "checking" || stats.currentViewChecked === false;
  let next = "Keep one surface in view and take a small step sideways.";
  if (movingTooFast) {
    next = "Slow down and repeat the affected area with a small sideways move; many attempted views were rejected.";
  } else if (shortBaseline) {
    next = "Take a small sideways step while keeping the same surface in view to add depth from another position.";
  } else if (frames >= 2 && weak) {
    next = `Aim at ${names[weak.id].long.toLowerCase()} and make another overlapping pass.`;
  } else if (frames >= 2 && frames < MIN_SURFACE_FUSION_KEYFRAMES) {
    const remaining = MIN_SURFACE_FUSION_KEYFRAMES - frames;
    next = `Keep moving sideways for ${remaining} more overlapping ${remaining === 1 ? "view" : "views"}.`;
  } else if (reviewReady) {
    next = "Your selected area has overlapping views. Finish and inspect the result.";
  }
  return {
    checking,
    hasCapture,
    next,
    overlap,
    regions: normalized,
    reviewReady,
    frames,
  };
}

export function CaptureCoverage({ coverage }) {
  return (
    <div className="ss-connected-coverage" aria-label="Overlap by view height; unscanned heights are optional">
      {normalizedRegions(coverage).map(region => {
        const state = regionState(region);
        const percent = clampPercent(region.ratio * 100);
        const Icon = state === "complete"
          ? CheckCircle
          : state === "unseen"
            ? EyeSlash
            : WarningCircle;
        const status = state === "complete"
          ? "Covered"
          : state === "weak"
            ? "Another pass"
            : state === "building"
              ? "Keep scanning"
              : "Not scanned";
        return (
          <div className={`ss-coverage-region is-${state}`} key={region.id}>
            <span>
              <Icon aria-hidden="true" size={13} weight={state === "complete" ? "fill" : "bold"} />
              {names[region.id].short}
            </span>
            <strong>{status}</strong>
            <progress
              aria-label={`${names[region.id].long} confirmed`}
              max="100"
              value={region.observed ? percent : 0}
            />
          </div>
        );
      })}
    </div>
  );
}

export function CaptureProgress({ stats }) {
  const summary = captureProgressSummary(stats);
  const stateLabel = summary.reviewReady
    ? "Ready to review"
    : summary.hasCapture
      ? summary.checking ? "Checking new view" : "Capture saved"
      : "Building first area";
  return (
    <section className="ss-capture-progress" aria-label="Scan progress">
      <div className="ss-capture-progress-head">
        <p><span>Saved depth views</span><strong>{summary.frames}</strong></p>
        <span className={`ss-capture-state ${summary.reviewReady ? "is-ready" : ""}`}>
          {stateLabel}
        </span>
      </div>
      <p className="ss-capture-overlap">Observed-surface overlap <strong>{summary.overlap}%</strong> · Unscanned areas may stay open.</p>
      <p className="ss-capture-next" id="ss-capture-next"><strong>Next:</strong> {summary.next}</p>
      <CaptureCoverage coverage={stats.adaptiveCapture?.coverage} />
    </section>
  );
}

export function CaptureAuditNotice({ audit, onContinue, onSave, saving = false, canContinue = true }) {
  return (
    <section className={`ss-partial-capture ${audit.passed ? "is-ready" : ""}`} role="status" aria-label="Capture review">
      <strong>{audit.passed ? "Ready to save" : "Your captured area is ready to review"}</strong>
      <p>{audit.passed ? "Look around the preview, then save or add more coverage."
        : "Some areas may be incomplete. You can save this partial scan or keep scanning."}</p>
      {!canContinue && <p>The camera session cannot continue. You can still save this captured result.</p>}
      {!!audit.issues.length && <details>
        <summary>Areas you can improve</summary>
        <ul>{audit.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      </details>}
      <div className="ss-actions">
        <button type="button" disabled={saving || !canContinue} onClick={onContinue}>Keep scanning</button>
        <button type="button" className="ss-primary" disabled={saving} onClick={onSave}>{audit.passed ? "Save scan" : "Save partial scan"}</button>
      </div>
    </section>
  );
}
