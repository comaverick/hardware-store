// Acquisition never waits for registration. Original, same-frame RGB-D views
// remain available to the reconstruction worker, including unconnected views.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const position = frame => Array.from(frame.camera || frame.transformMatrix.slice(12, 15));
const distance = (a, b) => Math.hypot(...position(a).map((v, i) => v - position(b)[i]));
const angle = (a, b) => Math.acos(clamp([8, 9, 10].reduce((sum, i) =>
  sum + a.transformMatrix[i] * b.transformMatrix[i], 0), -1, 1));
const quality = frame => (frame.measuredDepthCount > 0 ? frame.measuredDepthCount : frame.validCount || 0) /
  Math.max(1, frame.columns * frame.rows);
const emptyCoverage = () => ({ observed: 0, confirmed: 0, ratio: 0, regions: [] });

export class ContinuousCapture {
  constructor({ maximumFrames = 60 } = {}) {
    this.maximumFrames = Math.max(3, Math.min(60, maximumFrames));
    this.frames = [];
    this.checkedFrames = [];
    this.sequence = 0;
    this.state = "starting";
    this.reason = "starting";
    this.coverage = emptyCoverage();
    this.coverageDirty = true;
    this.events = { captured: 0, removed: 0, refreshed: 0, redundant: 0 };
  }
  needsObservation(frame, profile, timestamp) {
    const last = this.frames.at(-1);
    return !last || this.lastFailure || timestamp - last.timestamp >= 1000 ||
      distance(frame, last) >= profile.spacing || angle(frame, last) >= profile.turn;
  }
  failure(reason) {
    this.lastFailure = reason;
    if (reason === "tracking-reset") this.reset = true;
    if (["tracking-lost", "tracking-reset"].includes(reason)) this.state = "recovering";
  }
  consider(frame, profile = { spacing: 0.055, turn: 0.11 }) {
    if (this.reset || frame.tracking === false || frame.transformMatrix?.length !== 16 ||
        frame.projectionMatrix?.length !== 16 || !Number.isFinite(frame.timestamp) ||
        !Array.from(frame.transformMatrix).every(Number.isFinite) ||
        !Array.from(frame.projectionMatrix).every(Number.isFinite) ||
        !position(frame).every(Number.isFinite))
      return { accepted: false, committed: [], reason: "tracking-lost" };
    if (quality(frame) < 0.2 || !frame.depths?.length)
      return { accepted: false, committed: [], reason: "sparse-depth" };
    const last = this.frames.at(-1);
    if (last && frame.timestamp - last.timestamp < 500 && distance(last, frame) > 0.5)
      return { accepted: false, committed: [], reason: "camera-jump" };
    this.lastFailure = null;
    this.state = "tracking";
    const near = this.frames.find(saved => distance(saved, frame) < profile.spacing &&
      angle(saved, frame) < profile.turn);
    if (near) {
      // Repeated stationary depth is not a new viewpoint. Replace only when
      // measured support improves substantially; confirmation must run again.
      if (quality(frame) > quality(near) + 0.08 &&
          (frame.validCount || 0) >= (near.validCount || 0) + 12) {
        this.replace(near, frame);
        return { accepted: true, committed: [], replaced: true, reason: "depth-refreshed" };
      }
      this.events.redundant++;
      return { accepted: true, committed: [], reason: "repeat-view" };
    }
    frame.captureId = ++this.sequence;
    frame.captureStatus = "captured";
    frame.captureLinks = [];
    this.frames.push(frame);
    this.events.captured++;
    if (this.frames.length > this.maximumFrames) {
      // Preserve the beginning, the newest two views and pose diversity.
      // Evict a dense repeat rather than stopping at the memory limit.
      const utility = saved => Math.min(...this.frames.filter(other => other !== saved)
        .map(other => distance(saved, other) + angle(saved, other) * 0.6)) + quality(saved) * 0.02;
      const removed = this.frames.slice(1, -2).map(saved => ({ saved, utility: utility(saved) }))
        .sort((a, b) => a.utility - b.utility || a.saved.timestamp - b.saved.timestamp)[0].saved;
      this.frames.splice(this.frames.indexOf(removed), 1);
      this.checkedFrames = this.checkedFrames.filter(saved => saved !== removed);
      this.events.removed++;
    }
    this.reason = "captured";
    this.coverageDirty = true;
    return { accepted: true, committed: [frame], reason: "captured" };
  }
  replace(previous, frame) {
    const index = this.frames.indexOf(previous);
    if (index < 0) return false;
    Object.assign(frame, { captureId: previous.captureId, captureStatus: "captured", captureLinks: [] });
    this.frames[index] = frame;
    this.checkedFrames = this.checkedFrames.filter(saved => saved !== previous);
    this.events.refreshed++;
    this.coverageDirty = true;
    return true;
  }
  applyAnalysis(result, sources) {
    if (!sources.every(frame => this.frames.includes(frame))) return false;
    const ids = new Set(result.checkedIds || []);
    this.checkedFrames = sources.filter(frame => ids.has(frame.captureId));
    const retainedIds = new Set(this.frames.map(frame => frame.captureId));
    for (const frame of sources) {
      frame.captureStatus = ids.has(frame.captureId) ? "checked" : "captured";
      frame.captureLinks = (result.links?.[frame.captureId] || []).filter(id => retainedIds.has(id));
    }
    this.coverage = result.coverage || emptyCoverage();
    this.groupCount = result.groupCount || 0;
    this.coverageDirty = sources.length !== this.frames.length;
    return true;
  }
  snapshot() {
    return { version: 4, mode: "continuous", state: this.state, reason: this.reason,
      frameCount: this.checkedFrames.length, capturedCount: this.frames.length,
      pendingCount: this.frames.length - this.checkedFrames.length,
      connected: this.checkedFrames.length >= 2, capacityReached: false,
      groupCount: this.groupCount || 0, coverage: this.coverage, ...this.events };
  }
}
