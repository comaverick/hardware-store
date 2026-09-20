const WARNING_DELAY_MS = 800;
const PROMPT_COOLDOWN_MS = 3000;
const MAX_RECENT_DECISIONS = 48;
const states = ["starting", "tracking", "checking", "recovering", "tracking-lost", "paused"];
const reasons = ["connected", "starting", "moving-too-fast", "sparse-depth", "near-field-obstruction",
  "depth-error", "depth-missing", "invalid-depth", "checking-overlap", "overlap-lost",
  "alignment-conflict", "confirming-recovery", "capacity", "unknown"];
const prompts = ["motion", "depth", "tracking", "reconnect", "reset", "unsupported", "capacity"];
const measurements = ["gateLinearSpeed", "gateAngularSpeed", "maxLinearSpeed", "maxAngularSpeed",
  "sampledLinearSpeed", "sampledAngularSpeed", "validDepthRatio", "overlap", "medianResidual",
  "upperResidual", "captureIntervalMs", "processingMs"];
const number = value => Number.isFinite(value) ? Math.max(0, Math.min(1e12, value)) : 0;
const counts = (value, keys) => Object.fromEntries(keys.map(key => [key, number(value?.[key])]));
const checking = () => ({ code: "checking", tone: "pending", label: "Checking this view",
  hint: "Your captured area is kept while this view is checked." });

// One source for the live instruction. The scanner applies timing below; the
// pure fallback also serves restored/legacy status snapshots and UI fixtures.
export function captureFeedbackCandidate(stats) {
  const capture = stats.adaptiveCapture;
  if (stats.originChanged) return { code: "reset", tone: "warning", immediate: true,
    label: "Camera position reset", hint: "Start a new scan to keep the surfaces aligned." };
  if (stats.paused) return { code: "paused", tone: "busy", label: "Scan paused", hint: "Your captured area is kept." };
  if (stats.depthState === "unavailable") return { code: "unsupported", tone: "warning", immediate: true,
    label: "Depth is unavailable", hint: "This device cannot capture depth in this browser." };
  if (!stats.tracking) return { code: "tracking", tone: "warning", label: "Finding your position",
    hint: "Point toward an area you already scanned." };
  if (!stats.depthCurrent || stats.depthState === "error") return { code: "depth", tone: "warning",
    label: "Waiting for the camera", hint: "Keep a well-lit surface in view. Your captured area is kept." };
  if (stats.movingTooFast) return { code: "motion", tone: "warning", label: "Move a little more slowly",
    hint: "Your captured area is kept. Continue when the view settles." };
  if (capture?.capacityReached) return { code: "capacity", tone: "warning", immediate: true,
    label: "This section is captured", hint: "Review and save this section before starting another." };
  if (capture?.state === "recovering") {
    if (stats.frameQuality === "confirming-recovery") return { ...checking(), label: "Checking the connection" };
    return { code: "reconnect", tone: "warning", label: "Reconnect this view",
      hint: stats.recoveryDirection || "Point back toward the last area you scanned." };
  }
  if (["sparse-depth", "near-field-obstruction"].includes(stats.frameQuality)) return {
    code: "depth", tone: "warning", label: "This surface is hard to capture", hint: "Try a different angle or continue to another surface." };
  if (capture?.state === "starting" || (stats.fusionKeyframes || 0) < 2) return {
    code: "starting", tone: "pending", label: "Getting started", hint: "Move a little sideways with the same surface in view." };
  if (capture?.state === "checking" || stats.currentViewChecked === false) return checking();
  if ((stats.currentConfirmedRatio || 0) >= 0.85) return { code: "confirmed", tone: "complete",
    label: "This area has good coverage", hint: "Continue to another area, or review your scan." };
  return { code: "scanning", tone: "active", label: "Scanning", hint: "Move around the surfaces you want to include." };
}

export function captureFeedback(stats) {
  return stats.captureFeedback || captureFeedbackCandidate(stats);
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

    const candidate = captureFeedbackCandidate(stats);
    if (candidate.code !== this.candidateCode) {
      this.candidateCode = candidate.code;
      this.candidateSince = now;
    }
    let feedback = candidate;
    if (candidate.tone === "warning" && !candidate.immediate &&
        (now - this.candidateSince < WARNING_DELAY_MS ||
          (this.feedback?.code !== candidate.code && now - (this.lastPromptAt.get(candidate.code) ?? -Infinity) < PROMPT_COOLDOWN_MS))) {
      feedback = checking();
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
