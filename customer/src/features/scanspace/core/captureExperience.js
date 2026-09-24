const WARNING_DELAY_MS = 1800;
const PROMPT_COOLDOWN_MS = 4500;
const COMPLETION_HOLD_MS = 4000;
const SAVED_VIEW_STALL_MS = 3000;
const CURRENT_ATTEMPT_MS = 1200;
const MAX_RECENT_DECISIONS = 48;
const states = ["starting", "tracking", "checking", "recovering", "tracking-lost", "paused"];
const reasons = ["connected", "starting", "moving-too-fast", "sparse-depth", "near-field-obstruction",
  "depth-error", "depth-missing", "invalid-depth", "checking-overlap", "overlap-lost",
  "alignment-conflict", "confirming-recovery", "confirming-bridge", "capacity", "unknown"];
const prompts = ["motion", "depth", "tracking", "reconnect", "reset", "unsupported", "capacity"];
const measurements = ["gateLinearSpeed", "gateAngularSpeed", "maxLinearSpeed", "maxAngularSpeed",
  "sampledLinearSpeed", "sampledAngularSpeed", "validDepthRatio", "overlap", "medianResidual",
  "upperResidual", "captureIntervalMs", "processingMs"];
const number = value => Number.isFinite(value) ? Math.max(0, Math.min(1e12, value)) : 0;
const counts = (value, keys) => Object.fromEntries(keys.map(key => [key, number(value?.[key])]));
const scanning = () => ({ code: "scanning", tone: "active", label: "Scanning",
  hint: "Move slowly and keep part of the last captured area in view." });

function stalledViewFeedback(latest, recoveryDirection) {
  const reason = latest.reason;
  const warning = { tone: "warning", immediate: true, stalled: true };
  if (reason === "moving-too-fast") return { ...warning, code: "stalled-motion",
    label: "Slow down to save a view", hint: "Sweep more slowly; ScanSpace will save a view automatically when it is steady." };
  if (reason === "sparse-depth") return { ...warning, code: "stalled-depth",
    label: "Depth is patchy", hint: "Step back slightly and aim at a well-lit, non-reflective surface." };
  if (reason === "near-field-obstruction") return { ...warning, code: "stalled-obstruction",
    label: "Move the phone back", hint: "Step back from nearby objects, then hold this area in view." };
  if (reason === "confirming-bridge") return { ...warning, code: "stalled-bridge",
    label: "Checking this connection", hint: "Keep the same shared edge in view and move a little sideways." };
  if (reason === "alignment-conflict") return { ...warning, code: "stalled-alignment",
    label: "Depth views disagree", hint: "Keep some saved area visible and move slowly while alignment is checked." };
  if (reason === "overlap-lost" && latest.overlap >= 0.18)
    return { ...warning, code: "stalled-alignment", label: "Aligning this view",
      hint: "Shared depth is visible. Keep moving slowly along it; ScanSpace will keep trying." };
  if (["checking-overlap", "overlap-lost"].includes(reason))
    return { ...warning, code: "stalled-overlap", label: "Connecting this view",
      hint: recoveryDirection || "Keep part of the last saved area visible and move slowly; capture continues automatically." };
  if (reason === "confirming-recovery") return { ...warning, code: "stalled-recovery",
    label: "Confirming this connection", hint: "Keep some saved area in view and move slowly; capture continues automatically." };
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
  if (!stats.depthCurrent || stats.depthState === "error") return { code: "depth", tone: "warning",
    label: "Waiting for the camera", hint: "Hold still with a well-lit surface in view." };
  if (capture?.capacityReached) return { code: "capacity", tone: "warning", immediate: true,
    label: "This section is captured", hint: "Review and save this section before starting another." };
  if (stats.captureStall) return stats.captureStall;
  if (stats.movingTooFast) return { code: "motion", tone: "warning", label: "Move a little more slowly",
    hint: "Slow your sweep; capture resumes automatically when the view is steady." };
  if (capture?.state === "recovering") {
    if (["confirming-recovery", "confirming-bridge"].includes(stats.frameQuality)) return scanning();
    return { code: "reconnect", tone: "warning", label: "Reconnecting scan",
      hint: "Keep some of the saved area visible while moving slowly; capture keeps trying." };
  }
  if (["sparse-depth", "near-field-obstruction"].includes(stats.frameQuality)) return {
    code: "depth", tone: "warning", label: "This surface is hard to capture", hint: "Step back slightly and try a small side angle." };
  if (capture?.state === "starting" || (stats.fusionKeyframes || 0) < 2) return {
    code: "starting", tone: "pending", label: "Getting started", hint: "Move a little sideways with the same surface in view." };
  if (capture?.state === "checking" || stats.currentViewChecked === false) return scanning();
  if ((stats.currentConfirmedRatio || 0) >= 0.85) return { code: "confirmed", tone: "complete",
    label: "This area has good coverage", hint: "Continue to another area, or review your scan." };
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
    if ((stats.fusionKeyframes || 0) >= 6 && (stats.currentConfirmedRatio || 0) >= 0.85) return null;
    const recent = this.diagnostics.recent.filter(event =>
      now - (this.startedAt + event.elapsedMs) <= CURRENT_ATTEMPT_MS);
    if (!recent.length) return null;
    const latest = recent.at(-1);
    if (now - (this.startedAt + latest.elapsedMs) > CURRENT_ATTEMPT_MS) return null;
    // Once enough views are saved, a stationary revisit is not a failure.
    // Existing coverage guidance can still point out a weak surface.
    if (latest.accepted && (stats.fusionKeyframes || 0) >= 6) return null;
    return stalledViewFeedback(latest, stats.recoveryDirection);
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
    if (candidate.code === "confirmed") {
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
