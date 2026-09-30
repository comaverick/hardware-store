import { MIN_SURFACE_CAMERA_BASELINE_METERS, MIN_SURFACE_FUSION_KEYFRAMES } from "./readiness";

const WARNING_DELAY_MS = 1800;
const PROMPT_COOLDOWN_MS = 4500;
const COMPLETION_HOLD_MS = 4000;
const SAVED_VIEW_STALL_MS = 2000;
const REPOSITION_AFTER_MS = 4000;
const CURRENT_ATTEMPT_MS = 1200;
const MAX_RECENT_DECISIONS = 48;
const states = ["starting", "tracking", "checking", "recovering", "tracking-lost", "paused"];
const reasons = ["connected", "starting", "moving-too-fast", "sparse-depth", "near-field-obstruction",
  "depth-error", "depth-missing", "invalid-depth", "checking-overlap", "overlap-lost",
  "alignment-conflict", "rechecking-start", "confirming-recovery", "confirming-bridge", "capacity", "unknown"];
const prompts = ["motion", "depth", "depth-retrying", "depth-stalled", "tracking", "reconnect", "reset", "unsupported", "capacity",
  "stalled-motion", "stalled-depth", "stalled-obstruction", "stalled-bridge", "stalled-alignment", "stalled-overlap",
  "stalled-recovery", "stalled-position", "stalled-translation", "stalled-reposition", "stalled-start"];
const measurements = ["gateLinearSpeed", "gateAngularSpeed", "maxLinearSpeed", "maxAngularSpeed",
  "sampledLinearSpeed", "sampledAngularSpeed", "validDepthRatio", "overlap", "medianResidual",
  "upperResidual", "captureIntervalMs", "processingMs", "colorReadMs", "depthSamplingMs", "depthPreparationMs",
  "overlapProcessingMs", "confirmationProcessingMs"];
const number = value => Number.isFinite(value) ? Math.max(0, Math.min(1e12, value)) : 0;
const counts = (value, keys) => Object.fromEntries(keys.map(key => [key, number(value?.[key])]));
const scanning = () => ({ code: "scanning", tone: "active", label: "Scanning",
  hint: "Move slowly and keep part of the last captured area in view." });

function depthFailureLabel(kind, stalled) {
  if (kind === "xr-frame-stalled") return stalled ? "Camera scan stopped responding" : "Camera scan interrupted";
  if (kind === "depth-read-error") return stalled ? "Depth reads keep failing" : "Depth read failed; retrying";
  if (["depth-processing-error", "invalid-depth"].includes(kind))
    return stalled ? "Depth data keeps failing" : "Depth data failed; retrying";
  return stalled ? "Depth sensor stopped responding" : "Depth signal interrupted";
}

function stalledViewFeedback(latest, stats, stalledMs) {
  const reason = latest.reason;
  const warning = { tone: "warning", immediate: true, stalled: true };
  if (reason === "moving-too-fast") return { ...warning, code: "stalled-motion",
    label: "Slow your sweep slightly", hint: "Keep moving smoothly across the surface; views save automatically." };
  if (reason === "sparse-depth") return { ...warning, code: "stalled-depth",
    label: "Depth is patchy", hint: "Step back slightly and aim at a well-lit, non-reflective surface." };
  if (reason === "near-field-obstruction") return { ...warning, code: "stalled-obstruction",
    label: "Move the phone back", hint: "Step back from nearby objects, then hold this area in view." };
  if (["starting", "confirming-bridge", "checking-overlap", "overlap-lost"].includes(reason) &&
      stats.adaptiveCapture?.needsTranslation) return { ...warning, code: "stalled-translation",
    label: "Add a sideways view", hint: "Take a small sideways step while keeping the same shared edge in view." };
  if (["checking-overlap", "overlap-lost", "confirming-bridge", "confirming-recovery", "alignment-conflict", "rechecking-start"].includes(reason) && stalledMs >= REPOSITION_AFTER_MS)
    return { ...warning, code: "stalled-reposition", label: "Try a wider view",
      hint: "Step back slightly to include more of the saved area, then take a small sideways step." };
  if (reason === "confirming-bridge") return { ...warning, code: "stalled-bridge",
    label: "Checking this connection", hint: "Keep the same shared edge in view and take a small sideways step." };
  if (reason === "alignment-conflict") return { ...warning, code: "stalled-alignment",
    label: "Checking depth alignment", hint: "Sweep sideways with some saved area visible; capture keeps checking." };
  if (reason === "rechecking-start") return { ...warning, code: "stalled-start",
    label: "Checking first views", hint: "Keep sweeping sideways across the same area so the starting views can be checked." };
  if (reason === "overlap-lost" && latest.overlap >= 0.18)
    return { ...warning, code: "stalled-alignment", label: "Aligning this view",
      hint: "Keep the shared edge visible and take a small sideways step to check alignment." };
  if (["checking-overlap", "overlap-lost"].includes(reason))
    return { ...warning, code: "stalled-overlap", label: "Connecting this view",
      hint: stats.recoveryTargetVisible
        ? "Keep the marked edge visible and take a small sideways step."
        : `${stats.recoveryDirection || "Bring part of the last saved area into view."} Then take a small sideways step.` };
  if (reason === "confirming-recovery") return { ...warning, code: "stalled-recovery",
    label: "Confirming this connection", hint: "Keep the saved edge visible and take a small sideways step." };
  return { ...warning, code: "stalled-position", label: "Need another viewpoint",
    hint: "Keep the same surface visible and take a small sideways step." };
}

// One source for the live instruction. The scanner applies timing below; the
// pure fallback also serves restored/legacy status snapshots and UI fixtures.
export function captureFeedbackCandidate(stats) {
  const capture = stats.adaptiveCapture;
  if (stats.originChanged) return { code: "reset", tone: "warning", immediate: true,
    label: "Camera position reset", hint: "Start a new scan to keep the surfaces aligned." };
  if (stats.paused) return { code: "paused", tone: "busy", label: "Scan paused", hint: "Your capture is saved. Resume when you are ready." };
  if (stats.depthState === "unavailable") return { code: "unsupported", tone: "warning", immediate: true,
    label: "Depth is unavailable", hint: "This device cannot capture depth in this browser." };
  if (!stats.tracking) return { code: "tracking", tone: "warning", label: "Finding your position",
    hint: "Hold still and point toward an area you already scanned." };
  if (stats.depthRecoveryState === "stalled") return { code: "depth-stalled", tone: "warning", immediate: true,
    label: depthFailureLabel(stats.depthFailureKind, true),
    hint: capture?.capacityReached
      ? "This section is also at its safe view limit. Review the saved scan now."
      : (stats.fusionKeyframes || 0) >= 2
        ? "Your saved views are safe. Review them now, or leave this open while ScanSpace keeps trying."
        : "No usable scan is saved yet. Leave this open while ScanSpace retries, or start a new scan." };
  if (stats.depthRecoveryState === "retrying") return { code: "depth-retrying", tone: "warning", immediate: true,
    label: depthFailureLabel(stats.depthFailureKind, false),
    hint: "ScanSpace is retrying automatically. Verified views remain saved." };
  if (!stats.depthCurrent || stats.depthState === "error") return { code: "depth", tone: "warning",
    label: "Waiting for the camera", hint: "Hold still with a well-lit surface in view." };
  if (capture?.capacityReached) return { code: "capacity", tone: "warning", immediate: true,
    label: "This section is captured", hint: "Review and save this section before starting another." };
  if (stats.captureStall) return stats.captureStall;
  if (stats.frameQuality === "rechecking-start") return { code: "seed-recheck", tone: "active",
    label: "Checking first views", hint: "Keep sweeping sideways across the same area; capture continues automatically." };
  if (stats.movingTooFast) return { code: "motion", tone: "warning", label: "Move a little more slowly",
    hint: "Keep a smooth sideways sweep; capture resumes automatically." };
  if (capture?.state === "recovering") {
    if (["confirming-recovery", "confirming-bridge"].includes(stats.frameQuality)) return scanning();
    return { code: "reconnect", tone: "warning", label: "Reconnecting scan",
      hint: "Bring a saved edge into view, then take a small sideways step; capture keeps trying." };
  }
  if (["sparse-depth", "near-field-obstruction"].includes(stats.frameQuality)) return {
    code: "depth", tone: "warning", label: "This surface is hard to capture", hint: "Step back slightly and try a small side angle." };
  if (capture?.state === "starting" || (stats.fusionKeyframes || 0) < 2) return {
    code: "starting", tone: "pending", label: "Getting started", hint: "Move a little sideways with the same surface in view." };
  if (capture?.state === "checking" || stats.currentViewChecked === false) return scanning();
  if ((stats.fusionKeyframes || 0) >= MIN_SURFACE_FUSION_KEYFRAMES && Number.isFinite(stats.cameraBaseline) &&
      stats.cameraBaseline < MIN_SURFACE_CAMERA_BASELINE_METERS) return { code: "baseline", tone: "pending",
    label: "Add a sideways view", hint: "Take a small sideways step while keeping the same surface visible." };
  if (stats.surfaceReady) return { code: "surface-confirmed", tone: "complete",
    label: `${({ wall: "Wall", floor: "Floor", ceiling: "Ceiling" })[stats.surfaceKind] || "Surface"} section captured`,
    hint: "Continue along the next section, or review the surfaces you captured." };
  if ((stats.currentConfirmedRatio || 0) >= 0.85 ||
      ((stats.currentMeasuredConfirmedRatio || 0) >= 0.85 && (stats.validDepthRatio || 0) >= 0.2))
    return { code: "confirmed", tone: "complete", label: "This view is checked",
      hint: "Continue sideways to the next area, or review your scan. Unseen gaps stay open." };
  return scanning();
}

export function captureFeedback(stats) {
  return stats.captureFeedback || captureFeedbackCandidate(stats);
}

// A recent-window signal can recover after the user slows down; the full
// capture share is retained for the final quality audit.
export function fastMotionShare(stats = {}, recentOnly = false) {
  const diagnostics = stats.captureDiagnostics || {};
  const recent = Array.isArray(diagnostics.recent) ? diagnostics.recent : [];
  const attempts = recentOnly && recent.length ? recent.length : Number(diagnostics.attempts) || 0;
  const rejected = recentOnly && recent.length
    ? recent.filter(event => event.reason === "moving-too-fast").length
    : Number(diagnostics.decisions?.["moving-too-fast"]) || 0;
  return attempts >= 20 ? rejected / attempts : 0;
}

// Local, bounded telemetry: no images or coordinates. The same sanitizer is
// used for exports and imports so a raw file cannot add unbounded event data.
export function sanitizeCaptureDiagnostics(value) {
  if (!value || typeof value !== "object") return null;
  const scalars = ["elapsedMs", "activeMs", "attempts", "accepted", "rejected", "committedFrames", "promptCount"];
  return {
    version: 1,
    ...counts(value, scalars),
    decisions: counts(value.decisions, reasons),
    stateMs: counts(value.stateMs, states),
    prompts: counts(value.prompts, prompts),
    recent: (Array.isArray(value.recent) ? value.recent : []).slice(-MAX_RECENT_DECISIONS).map(event => ({
      elapsedMs: number(event?.elapsedMs), reason: reasons.includes(event?.reason) ? event.reason : "unknown",
      accepted: event?.accepted === true, committed: number(event?.committed), matched: event?.matched === true,
      state: states.includes(event?.state) ? event.state : "starting",
      ...counts(event, measurements),
    })),
  };
}

export class CaptureExperience {
  constructor() {
    this.diagnostics = sanitizeCaptureDiagnostics({});
    this.lastPromptAt = new Map();
  }
  recordFrame({ timestamp, reason, accepted = false, committed = 0, matched = false, state, ...values }) {
    this.startedAt ??= timestamp;
    this.firstAttemptAt ??= timestamp;
    if (committed > 0) this.lastCommittedAt = timestamp;
    const key = reasons.includes(reason) ? reason : "unknown";
    const data = this.diagnostics;
    data.attempts++;
    data[accepted ? "accepted" : "rejected"]++;
    data.committedFrames += committed;
    data.decisions[key]++;
    data.recent.push({ elapsedMs: Math.max(0, timestamp - this.startedAt), reason: key,
      accepted, committed, matched, state, ...counts(values, measurements) });
    if (data.recent.length > MAX_RECENT_DECISIONS) data.recent.shift();
  }
  stalledView(stats, now) {
    const lastProgressAt = this.lastCommittedAt ?? this.firstAttemptAt;
    if (stats.paused || stats.originChanged || !stats.tracking || !stats.depthCurrent ||
        stats.depthState === "unavailable" || stats.adaptiveCapture?.capacityReached ||
        lastProgressAt == null || now - lastProgressAt < SAVED_VIEW_STALL_MS) return null;
    // A complete, confirmed area does not need another saved viewpoint.
    if ((stats.fusionKeyframes || 0) >= 6 && stats.currentViewChecked !== false &&
        stats.adaptiveCapture?.state === "tracking" && (stats.surfaceReady || (stats.currentConfirmedRatio || 0) >= 0.85)) return null;
    const recent = this.diagnostics.recent.filter(event =>
      now - (this.startedAt + event.elapsedMs) <= CURRENT_ATTEMPT_MS);
    if (!recent.length) return null;
    const latest = recent.at(-1);
    if (now - (this.startedAt + latest.elapsedMs) > CURRENT_ATTEMPT_MS) return null;
    // Once enough views are saved, a stationary revisit is not a failure.
    // Existing coverage guidance can still point out a weak surface.
    if (latest.accepted && (stats.fusionKeyframes || 0) >= 6) return null;
    return stalledViewFeedback(latest, stats, now - lastProgressAt);
  }
  update(stats, timestamp) {
    this.startedAt ??= timestamp;
    const now = Math.max(timestamp, this.lastUpdateAt ?? timestamp);
    const elapsed = now - (this.lastUpdateAt ?? now);
    const state = stats.paused ? "paused" : !stats.tracking ? "tracking-lost" : stats.adaptiveCapture?.state || "starting";
    if (this.lastState) this.diagnostics.stateMs[this.lastState] += elapsed;
    this.lastState = states.includes(state) ? state : "starting";
    this.lastUpdateAt = now;
    this.diagnostics.elapsedMs = now - this.startedAt;
    this.diagnostics.activeMs = this.diagnostics.elapsedMs - this.diagnostics.stateMs.paused;

    this.captureStall = this.stalledView(stats, now);
    const candidate = captureFeedbackCandidate({ ...stats, captureStall: this.captureStall });
    if (candidate.code !== this.candidateCode) {
      this.candidateCode = candidate.code;
      this.candidateSince = now;
    }
    if (stats.currentViewChecked === false || stats.adaptiveCapture?.state !== "tracking" ||
        (candidate.tone === "warning" && candidate.immediate)) this.completedHoldUntil = 0;
    if (candidate.tone === "complete") {
      this.completedFeedback = candidate;
      this.completedHoldUntil = now + COMPLETION_HOLD_MS;
    }
    let feedback = candidate;
    if (candidate.tone === "warning" && !candidate.immediate &&
        (now - this.candidateSince < WARNING_DELAY_MS ||
          (this.feedback?.code !== candidate.code && now - (this.lastPromptAt.get(candidate.code) ?? -Infinity) < PROMPT_COOLDOWN_MS))) {
      feedback = this.completedHoldUntil > now && this.completedFeedback
        ? this.completedFeedback
        : scanning();
    } else if (candidate.code === "scanning" && this.completedHoldUntil > now && this.completedFeedback) {
      feedback = this.completedFeedback;
    }
    if (feedback.tone === "warning" && feedback.code !== this.feedback?.code) {
      this.lastPromptAt.set(feedback.code, now);
      this.diagnostics.promptCount++;
      this.diagnostics.prompts[feedback.code]++;
    }
    this.feedback = feedback;
    return feedback;
  }
  snapshot() {
    return sanitizeCaptureDiagnostics(this.diagnostics);
  }
}
