import { depthPosition, filterDepth, gridIndex, projectWorld, sampleProjectiveDepth } from "./fusion";
import { fastMotionShare } from "./captureExperience";
import { MIN_SURFACE_CAMERA_BASELINE_METERS } from "./readiness";

export const ADAPTIVE_CAPTURE_VERSION = 2;
export const MIN_REGION_OBSERVATIONS = 12;
export const MIN_REGION_CONFIRMATION = 0.55;
const OVERLAP_GRACE_MS = 900;
const RECOVERY_EVIDENCE_MS = 1800;
const PENDING_AGE_MS = 8000;
const hardFailures = new Set(["tracking-lost", "tracking-reset", "camera-jump", "alignment-conflict"]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const camera = (frame) => Array.from(frame.camera || frame.transformMatrix.slice(12, 15));
const direction = (frame) => [-frame.transformMatrix[8], -frame.transformMatrix[9], -frame.transformMatrix[10]];
const angle = (a, b) => Math.acos(clamp(direction(a).reduce((sum, value, axis) => sum + value * direction(b)[axis], 0), -1, 1));
const prepared = new WeakMap();
const depthTolerance = (depth) => clamp(0.025 + depth * 0.012, 0.04, 0.065);

// Keep original observations intact. All decisions use the same filtered
// view-aligned rays and projective depth sampler as final reconstruction.
export function prepareCaptureFrame(frame) {
  if (prepared.has(frame)) return prepared.get(frame);
  const filtered = filterDepth(frame);
  const positions = new Float32Array(frame.positions.length).fill(NaN);
  let measuredCount = 0;
  filtered.measuredMask.forEach((measured, index) => {
    if (!measured) return;
    const point = depthPosition(frame, index, filtered.filtered[index]);
    if (!point?.every(Number.isFinite)) return;
    positions.set(point, index * 3);
    measuredCount++;
  });
  const result = { ...frame, positions, filteredDepth: filtered.filtered, measuredMask: filtered.measuredMask, measuredCount };
  prepared.set(frame, result);
  return result;
}

// A spatial cell is only a lookup bucket, not proof that two measurements
// describe the same surface. Validate the original ray before confirming it.
export function capturePointObserved(frame, point) {
  const view = prepareCaptureFrame(frame);
  const p = projectWorld(view, ...point);
  if (!p || p.u < 0 || p.v < 0 || p.u >= 1 || p.v >= 1) return false;
  if (!view.measuredMask[gridIndex(view, p.u, p.v)]) return false;
  const depth = sampleProjectiveDepth(view, p.u, p.v);
  return depth > 0 && Math.abs(depth - p.depth) <= depthTolerance(depth);
}

export function confirmedViewRatio(frame, savedFrames, maximumSamples = 480) {
  const view = prepareCaptureFrame(frame);
  const references = savedFrames.map(saved => ({ frame: saved, camera: camera(saved) }));
  const stride = Math.max(1, Math.ceil(view.filteredDepth.length / maximumSamples));
  let sampled = 0, confirmed = 0;
  for (let index = 0; index < view.filteredDepth.length; index += stride) {
    sampled++;
    if (!view.measuredMask[index]) continue;
    const point = view.positions.subarray(index * 3, index * 3 + 3), observers = [];
    for (const reference of references) {
      if (!capturePointObserved(reference.frame, point)) continue;
      if (observers.some(observer => distance(observer, reference.camera) >= 0.04)) {
        confirmed++;
        break;
      }
      observers.push(reference.camera);
    }
  }
  // Missing depth stays in the denominator. A stationary live view is not an
  // additional saved viewpoint, even when it contains a clearer measurement.
  return confirmed / Math.max(1, sampled);
}

export function captureDetail(frame) {
  const differences = [];
  let edges = 0, count = 0;
  const stride = Math.max(1, Math.ceil(frame.depths.length / 600));
  for (let index = frame.columns; index < frame.depths.length - frame.columns; index += stride) {
    if (index % frame.columns < 1 || index % frame.columns >= frame.columns - 1) continue;
    const d = frame.depths[index], left = frame.depths[index - 1], right = frame.depths[index + 1];
    if (!(d > 0 && left > 0 && right > 0)) continue;
    count++;
    const jump = Math.max(Math.abs(left - d), Math.abs(right - d));
    const colorEdge = frame.colorMask?.[index] && frame.colorMask?.[index + 1] &&
      [0, 1, 2].some(channel => Math.abs(frame.colors[index * 3 + channel] - frame.colors[(index + 1) * 3 + channel]) > 55);
    if (jump > Math.max(0.045, d * 0.025) || colorEdge) edges++;
    // Second differences on locally smooth patches estimate noise without
    // treating a shelf silhouette or a sloping wall as sensor noise.
    if (jump < 0.045) differences.push(Math.abs(left + right - 2 * d) * 0.5);
  }
  differences.sort((a, b) => a - b);
  return { edgeRatio: edges / Math.max(1, count), noise: differences[Math.floor(differences.length / 2)] || 0 };
}

export function adaptiveCaptureProfile({ depthType = "", width = 0, height = 0, validRatio = 1,
  noise = 0, edgeRatio = 0, processingMs = 0, linearSpeed = 0, angularSpeed = 0 } = {}) {
  const limited = depthType !== "raw" || (width * height > 0 && width * height < 20000);
  const weak = validRatio < 0.45 || noise > 0.012;
  const detail = edgeRatio > 0.09;
  const spacing = detail ? 0.045 : limited ? 0.055 : 0.07;
  const turn = detail ? 0.075 : 0.11;
  const motionInterval = Math.min(spacing / Math.max(0.001, linearSpeed), turn / Math.max(0.001, angularSpeed)) * 700;
  const minimumInterval = clamp(processingMs * 3, 120, 600);
  return {
    name: detail ? "detail" : limited || weak ? "careful" : "standard",
    spacing, turn,
    interval: Math.round(clamp(motionInterval, minimumInterval, Math.max(350, minimumInterval))),
    maxLinearSpeed: weak ? 0.25 : limited ? 0.35 : 0.45,
    maxAngularSpeed: weak ? 0.38 : limited ? 0.5 : 0.6,
    // Readback and matching costs affect resolution as well as cadence.
    sampleLongSide: processingMs > 90 ? 64 : detail && processingMs < 45 ? 128 : 96,
  };
}

function directionalAgreement(first, second, maximumSamples = 280) {
  const errors = [], tiles = new Set();
  let samples = 0, compared = 0, agreeing = 0, freeSpace = 0;
  const stride = Math.max(1, Math.ceil(first.filteredDepth.length / maximumSamples));
  for (let index = 0; index < first.filteredDepth.length; index += stride) {
    if (!first.measuredMask[index]) continue;
    samples++;
    const p = projectWorld(second, ...first.positions.subarray(index * 3, index * 3 + 3));
    if (!p || p.u < 0 || p.v < 0 || p.u >= 1 || p.v >= 1) continue;
    if (!second.measuredMask[gridIndex(second, p.u, p.v)]) continue;
    const depth = sampleProjectiveDepth(second, p.u, p.v);
    if (!(depth > 0)) continue;
    compared++;
    const difference = depth - p.depth;
    const tolerance = depthTolerance(depth);
    if (difference > Math.max(0.12, depth * 0.055)) freeSpace++;
    // Foreground surfaces can hide old geometry. They do not validate it.
    if (difference < -Math.max(0.12, depth * 0.055)) continue;
    errors.push(Math.abs(difference));
    if (Math.abs(difference) <= tolerance) {
      agreeing++;
      tiles.add(`${Math.floor(p.u * 4)},${Math.floor(p.v * 4)}`);
    }
  }
  errors.sort((a, b) => a - b);
  return {
    samples, compared, agreeing, tiles: tiles.size,
    overlap: compared / Math.max(1, samples),
    support: agreeing / Math.max(1, samples),
    agreement: agreeing / Math.max(1, errors.length),
    median: errors[Math.floor(errors.length * 0.5)] ?? Infinity,
    upper: errors[Math.floor(errors.length * 0.75)] ?? Infinity,
    freeSpaceRatio: freeSpace / Math.max(1, compared),
  };
}

export function captureOverlap(left, right) {
  const first = prepareCaptureFrame(left), second = prepareCaptureFrame(right);
  let forward = directionalAgreement(first, second);
  let backward = directionalAgreement(second, first);
  const strongOneWay = value => value.agreeing >= 20 && value.tiles >= 4 &&
    value.support >= 0.07 && value.agreement >= 0.8 && value.median <= 0.04;
  // A fixed coarse sampling phase can miss a thin overlap at the edge of a
  // turn, even though the opposite projection measured it. Recheck only that
  // sparse direction; a direction with actual disagreeing depth is never
  // rescued by picking a more favorable phase.
  if (strongOneWay(forward) && backward.compared < 18)
    backward = directionalAgreement(second, first, 1200);
  if (strongOneWay(backward) && forward.compared < 18)
    forward = directionalAgreement(first, second, 1200);
  const passes = value => value.compared >= 18 && value.agreeing >= 14 && value.tiles >= 4 &&
    value.support >= 0.12 && value.agreement >= 0.6 && value.median <= 0.055 && value.upper <= 0.09;
  return {
    accepted: passes(forward) && passes(backward),
    // A strong one-direction free-space contradiction must not be hidden by
    // an occluded reverse projection or a matching recent drifted frame.
    conflict: [forward, backward].some(value => value.compared >= 65 && value.overlap > 0.55 && value.freeSpaceRatio > 0.65),
    overlap: Math.min(forward.support, backward.support),
    median: Math.max(forward.median, backward.median),
    upper: Math.max(forward.upper, backward.upper),
    forward, backward,
  };
}

// A narrow shared strip (for example, where a wall meets the ceiling) can be
// enough to reconnect two *locally agreeing* views. It is not enough by itself
// to save a frame: consider() requires a second, displaced view of that strip.
export function captureBridgeOverlap(result) {
  if (!result || result.conflict) return false;
  const passes = value => value && value.compared >= 20 && value.agreeing >= 18 &&
    value.tiles >= 4 && value.support >= 0.07 && value.agreement >= 0.8 &&
    value.median <= 0.04 && value.upper <= 0.06 && value.freeSpaceRatio <= 0.15;
  return !!(passes(result.forward) && passes(result.backward));
}

function graphConnected(frames, links, omit = null) {
  const ids = new Set(frames.map(frame => frame.captureId).filter(id => id !== omit));
  if (!ids.size) return false;
  const queue = [ids.values().next().value], visited = new Set(queue);
  for (let i = 0; i < queue.length; i++) for (const id of links.get(queue[i]) || []) {
    if (ids.has(id) && !visited.has(id)) { visited.add(id); queue.push(id); }
  }
  return visited.size === ids.size;
}

export function connectedCoverage(frames) {
  const cells = new Map(), cellSize = 0.16;
  for (const frame of frames) {
    const view = prepareCaptureFrame(frame), observer = camera(frame), seen = new Set();
    const stride = Math.max(1, Math.ceil(view.filteredDepth.length / 850));
    for (let index = 0; index < view.filteredDepth.length; index += stride) {
      if (!view.measuredMask[index]) continue;
      const p = Array.from(view.positions.subarray(index * 3, index * 3 + 3));
      if (!p.every(Number.isFinite)) continue;
      const key = p.map(value => Math.floor(value / cellSize)).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = cells.get(key);
      if (existing) {
        if (!existing.confirmed && distance(existing.observer, observer) >= 0.04 &&
            capturePointObserved(frame, existing.point)) existing.confirmed = true;
      } else {
        const height = p[1] - observer[1];
        cells.set(key, { point: p, observer, confirmed: false,
          region: height > 0.65 ? "upper" : height < -0.65 ? "lower" : "middle" });
      }
    }
  }
  const regions = ["lower", "middle", "upper"].map(id => {
    const values = [...cells.values()].filter(cell => cell.region === id);
    const confirmed = values.filter(cell => cell.confirmed).length;
    return { id, observed: values.length, confirmed, ratio: confirmed / Math.max(1, values.length) };
  });
  const confirmed = [...cells.values()].filter(cell => cell.confirmed).length;
  const weakest = regions.filter(region => region.observed >= MIN_REGION_OBSERVATIONS).sort((a, b) => a.ratio - b.ratio)[0];
  const target = weakest && [...cells.values()].find(cell => cell.region === weakest.id && !cell.confirmed)?.point;
  return { observed: cells.size, confirmed, ratio: confirmed / Math.max(1, cells.size), regions, target: target || null };
}

export class AdaptiveCapture {
  constructor({ maximumFrames = 60, maximumPending = 6, compare = captureOverlap } = {}) {
    this.maximumFrames = maximumFrames;
    this.maximumPending = maximumPending;
    this.compare = compare;
    this.frames = [];
    this.pending = [];
    this.links = new Map();
    this.sequence = 0;
    this.state = "starting";
    this.reason = "starting";
    this.recoveryMatches = 0;
    this.pendingSupport = new WeakMap();
    this.pendingBridgeEdges = new WeakMap();
    this.events = { recoveries: 0, promoted: 0, expired: 0, removed: 0, capacityStops: 0,
      pendingAgeDrops: 0, pendingCapacityDrops: 0, pendingRedundantDrops: 0,
      pendingConflictDrops: 0, pendingResetDrops: 0 };
  }
  clearRecoveryEvidence() {
    this.recoveryMatches = 0;
    this.recoveryEvidence = null;
    this.lastRecoveryMatchAt = null;
  }
  recover(reason, timestamp = this.lastSeen) {
    if (!this.frames.length) return;
    if (this.state !== "recovering") {
      this.events.recoveries++;
      this.recoveryStartedAt = timestamp;
    }
    this.state = "recovering";
    this.reason = reason;
    this.clearRecoveryEvidence();
  }
  failure(reason, timestamp) {
    // Motion, sparse depth and sensor read failures describe this observation,
    // not a change of coordinate system. Keep recent validated recovery evidence
    // across those skips; a contradictory pose or stale evidence invalidates it.
    if (hardFailures.has(reason)) this.recover(reason, timestamp);
    else if (this.lastRecoveryMatchAt != null && timestamp - this.lastRecoveryMatchAt > RECOVERY_EVIDENCE_MS)
      this.clearRecoveryEvidence();
    if (reason === "tracking-reset") {
      this.events.pendingResetDrops += this.pending.length;
      this.pending = [];
    }
    if (this.state === "checking" && timestamp - this.uncertainSince >= OVERLAP_GRACE_MS)
      this.recover("overlap-lost", timestamp);
    this.lastSeen = timestamp;
    this.expire(timestamp);
  }
  expire(timestamp) {
    const kept = this.pending.filter(frame => timestamp - frame.timestamp <= PENDING_AGE_MS);
    const removed = this.pending.length - kept.length;
    this.events.expired += removed;
    this.events.pendingAgeDrops += removed;
    this.pending = kept;
  }
  buffer(frame, support = 0) {
    // Keep the starting pose fixed until there is enough translation. Replacing
    // it on each tiny step makes slow continuous movement look stationary forever.
    const anchor = this.frames.length ? null : this.pending[0];
    const near = this.pending.findIndex(value => value !== anchor &&
      distance(camera(value), camera(frame)) < 0.025 && angle(value, frame) < 0.04);
    const quality = value => (value.measuredDepthCount ?? value.validCount ?? 0) / Math.max(1, value.depths.length);
    this.pendingSupport.set(frame, support);
    if (near >= 0) {
      this.events.pendingRedundantDrops++;
      if (quality(this.pending[near]) > quality(frame) + 0.05) return;
      this.pending.splice(near, 1);
    }
    this.pending.push(frame);
    if (this.pending.length > this.maximumPending) {
      const poseDistance = (a, b) => distance(camera(a), camera(b)) + angle(a, b) * 0.3;
      // Protect the most promising connection back to saved geometry. Blindly
      // dropping the oldest candidate can discard the only bridge on a revisit.
      const frontierScore = value => (this.pendingSupport.get(value) || 0) * 2 -
        Math.min(...this.frames.map(saved => poseDistance(value, saved)), 4);
      const bridge = anchor || this.pending.reduce((best, value) =>
        frontierScore(value) > frontierScore(best) ? value : best, this.pending[0]);
      const utility = value => Math.min(1, ...this.pending.filter(other => other !== value)
        .map(other => poseDistance(value, other))) + quality(value) * 0.15 + (this.pendingSupport.get(value) || 0) * 0.5;
      const removable = this.pending.filter(value => value !== bridge)
        .sort((a, b) => utility(a) - utility(b) || a.timestamp - b.timestamp)[0];
      this.pending.splice(this.pending.indexOf(removable), 1);
      this.events.expired++;
      this.events.pendingCapacityDrops++;
    }
  }
  references(frame) {
    const nearest = this.frames.slice().sort((a, b) =>
      distance(camera(a), camera(frame)) + angle(a, frame) - distance(camera(b), camera(frame)) - angle(b, frame));
    // Recent path, spatial revisits, and an old anchor all get a vote.
    return [...new Set([...this.frames.slice(-4), ...nearest.slice(0, 5), this.frames[0]])].filter(Boolean);
  }
  matches(frame) {
    const results = this.references(frame).map(reference => ({ reference, result: this.compare(frame, reference) }));
    return { edges: results.filter(value => value.result.accepted).map(value => value.reference.captureId),
      bridgeEdges: results.filter(value => captureBridgeOverlap(value.result)).map(value => value.reference.captureId),
      conflict: results.some(value => value.result.conflict),
      best: results.sort((a, b) => b.result.overlap - a.result.overlap)[0]?.result };
  }
  reconnectPendingBridge(frame, timestamp) {
    // A single small coincidental patch must never enter the saved scan. Two
    // displaced observations must agree with each other, and at least one must
    // independently agree with a saved view on that patch. Pending frames stay
    // invisible to preview, fusion and export until this succeeds.
    if (!this.pending.includes(frame)) return false;
    // The saved graph has not changed while these views were pending, so any
    // newly possible pair must contain the newest view. Limit work on mobile.
    for (const other of this.pending) {
      if (other === frame || distance(camera(frame), camera(other)) < 0.04) continue;
      const choices = [frame, other].filter(value => (this.pendingBridgeEdges.get(value) || []).length);
      if (!choices.length) continue;
      const agreement = this.compare(frame, other);
      if (!agreement.accepted || agreement.conflict) continue;
      const bridge = choices.sort((a, b) =>
        (this.pendingSupport.get(b) || 0) - (this.pendingSupport.get(a) || 0))[0];
      const companion = bridge === frame ? other : frame;
      // A normal saved view may have arrived since this candidate was
      // buffered. Revalidate against the current graph before adding a link.
      const verified = this.matches(bridge);
      if (verified.conflict || !verified.bridgeEdges.length) continue;
      // Do not half-commit a corroborated pair at the frame limit. Tell the
      // user the area is full rather than leaving this path checking forever.
      if (this.frames.length + 2 > this.maximumFrames) {
        this.capacityReached = true;
        this.events.capacityStops++;
        this.reason = "capacity";
        return "capacity";
      }
      this.commit(bridge, verified.bridgeEdges);
      this.commit(companion, [bridge.captureId]);
      this.pending = this.pending.filter(value => value !== bridge && value !== companion);
      this.events.promoted += 2;
      this.frames.sort((a, b) => a.timestamp - b.timestamp);
      this.lastReliableAt = timestamp;
      this.state = "tracking";
      this.reason = "connected";
      this.uncertainSince = null;
      this.clearRecoveryEvidence();
      return true;
    }
    return false;
  }
  remove(frame) {
    this.links.delete(frame.captureId);
    for (const neighbors of this.links.values()) neighbors.delete(frame.captureId);
    this.frames = this.frames.filter(value => value !== frame);
  }
  commit(frame, edges) {
    this.frames.push(frame);
    this.links.set(frame.captureId, new Set(edges));
    edges.forEach(id => this.links.get(id)?.add(frame.captureId));
    if (this.frames.length > this.maximumFrames) {
      const candidates = this.frames.slice(1, -1).filter(value => !value.colorImage?.length)
        .sort((a, b) => {
          const novelty = value => Math.min(...this.frames.filter(other => other !== value)
            .map(other => distance(camera(value), camera(other)) + angle(value, other) * 0.3));
          return novelty(a) - novelty(b);
        });
      const removable = candidates.find(value => graphConnected(this.frames, this.links, value.captureId));
      if (!removable) {
        this.remove(frame);
        this.capacityReached = true;
        this.events.capacityStops++;
        return false;
      }
      this.remove(removable);
      this.events.removed++;
    }
    this.capacityReached = false;
    this.coverage = null;
    return true;
  }
  consider(frame, profile = adaptiveCaptureProfile()) {
    frame.captureId = ++this.sequence;
    const time = frame.timestamp;
    this.expire(time);
    if (this.state !== "recovering" && this.lastReliableAt != null &&
        time - this.lastReliableAt > RECOVERY_EVIDENCE_MS)
      this.recover("capture-gap", time);
    if (this.lastObserved && distance(camera(frame), camera(this.lastObserved)) > 0.5)
      this.recover("camera-jump", time);
    this.lastSeen = time;
    this.lastObserved = frame;
    if (!this.frames.length) {
      const seed = this.pending.find(value => distance(camera(frame), camera(value)) >= 0.04 && this.compare(frame, value).accepted);
      if (!seed) { this.buffer(frame); return { accepted: false, committed: [], reason: "starting" }; }
      this.commit(seed, []);
      this.commit(frame, [seed.captureId]);
      this.pending = [];
      this.state = "tracking";
      this.reason = "connected";
      this.lastReliableAt = time;
      return { accepted: true, committed: [seed, frame], reason: "connected" };
    }
    const before = new Set(this.frames);
    const match = this.matches(frame);
    this.lastMatch = match.best;
    if (match.conflict) {
      this.recover("alignment-conflict", time);
      return { accepted: false, committed: [], reason: this.reason };
    }
    if (!match.edges.length) {
      // A single uncertain depth read is not evidence that the previous good
      // recovery view was wrong. Keep it briefly; the next good view must still
      // agree with that exact observation before recovery can complete.
      if (this.lastRecoveryMatchAt != null && time - this.lastRecoveryMatchAt > RECOVERY_EVIDENCE_MS)
        this.clearRecoveryEvidence();
      if (this.state === "tracking") {
        this.state = "checking";
        this.uncertainSince = time;
      }
      if (this.state === "checking" && time - this.uncertainSince >= OVERLAP_GRACE_MS)
        this.recover("overlap-lost", time);
      this.reason = this.state === "recovering" ? "overlap-lost" : "checking-overlap";
      this.pendingBridgeEdges.set(frame, match.bridgeEdges);
      this.buffer(frame, match.best?.overlap || 0);
      const bridgeResult = this.reconnectPendingBridge(frame, time);
      if (bridgeResult === "capacity") return { accepted: false, committed: [], reason: "capacity" };
      if (bridgeResult)
        return { accepted: true, committed: this.frames.filter(value => !before.has(value)), reason: "connected", match: match.best };
      if (match.bridgeEdges.length && this.pending.includes(frame)) this.reason = "confirming-bridge";
      return { accepted: false, committed: [], reason: this.reason };
    }
    this.lastReliableAt = time;
    if (this.state === "recovering") {
      // Both observations must agree with the saved map AND each other. Mere
      // motion skips can separate them; drift, different patches and stale
      // confirmations cannot be combined into a successful recovery.
      const evidence = this.recoveryEvidence;
      const continuity = evidence && this.compare(frame, evidence);
      if (!evidence || time - evidence.timestamp > RECOVERY_EVIDENCE_MS ||
          !continuity.accepted || continuity.conflict) {
        this.recoveryEvidence = frame;
        this.lastRecoveryMatchAt = time;
        this.recoveryMatches = 1;
      } else if (time - evidence.timestamp >= 120) {
        this.recoveryMatches = 2;
      }
      if (this.recoveryMatches < 2) return { accepted: false, committed: [], reason: "confirming-recovery" };
    }
    this.state = "tracking";
    this.uncertainSince = null;
    this.clearRecoveryEvidence();
    const last = this.frames[this.frames.length - 1];
    const novel = distance(camera(last), camera(frame)) >= profile.spacing || angle(last, frame) >= profile.turn;
    if (novel && !this.commit(frame, match.edges)) return { accepted: false, committed: [], reason: "capacity" };
    // Revisit buffered areas only after reconnection to confirmed geometry.
    // Each promoted view must independently pass the same bidirectional test.
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of this.pending.slice()) {
        const result = this.matches(candidate);
        if (result.conflict) {
          this.pending = this.pending.filter(value => value !== candidate);
          this.events.pendingConflictDrops++;
          continue;
        }
        if (result.edges.length && this.commit(candidate, result.edges)) {
          this.pending = this.pending.filter(value => value !== candidate);
          this.events.promoted++;
          changed = true;
        }
      }
    }
    this.frames.sort((a, b) => a.timestamp - b.timestamp);
    this.reason = "connected";
    return { accepted: true, committed: this.frames.filter(value => !before.has(value)), reason: "connected", match: match.best };
  }
  replace(previous, candidate) {
    const neighbors = this.links.get(previous.captureId);
    if (!neighbors?.size) return false;
    // A depth refresh must keep every existing connection valid.
    if ([...neighbors].some(id => !this.compare(candidate, this.frames.find(frame => frame.captureId === id)).accepted)) return false;
    candidate.captureId = previous.captureId;
    this.frames[this.frames.indexOf(previous)] = candidate;
    this.coverage = null;
    return true;
  }
  snapshot() {
    this.coverage ||= connectedCoverage(this.frames);
    this.frames.forEach(frame => { frame.captureLinks = [...(this.links.get(frame.captureId) || [])]; });
    return { version: ADAPTIVE_CAPTURE_VERSION, state: this.state, reason: this.reason,
      connected: this.frames.length >= 2 && graphConnected(this.frames, this.links),
      frameCount: this.frames.length, pendingCount: this.pending.length,
      capacityReached: !!this.capacityReached, coverage: this.coverage, ...this.events };
  }
}

export function auditCapture(stats, diagnostics = null) {
  const issues = [], capture = stats.adaptiveCapture;
  if (fastMotionShare(stats) >= 0.25)
    issues.push("Many attempted views were rejected for fast motion. Inspect the result for torn areas and repeat them slowly if possible.");
  if (Number.isFinite(stats.cameraBaseline) && stats.cameraBaseline < MIN_SURFACE_CAMERA_BASELINE_METERS)
    issues.push("Camera positions were too close together for strong depth overlap. Repeat the area from a small sideways step.");
  if (capture && !capture.connected) issues.push("The saved views need a reliable connection.");
  if (["recovering", "checking"].includes(capture?.state)) issues.push("The latest view could not be connected. Previously saved views are included.");
  if (capture?.pendingCount) issues.push(`${capture.pendingCount} unconfirmed views were left out of this result.`);
  if (capture?.capacityReached) issues.push("This section reached its safe capacity. Save it as a partial scan before starting another section.");
  const coverage = capture?.coverage;
  const labels = { upper: "Upper surfaces", middle: "Walls and objects", lower: "Lower surfaces" };
  for (const region of coverage?.regions || []) {
    if (region.observed >= MIN_REGION_OBSERVATIONS && region.ratio < MIN_REGION_CONFIRMATION)
      issues.push(`${labels[region.id]} have limited overlapping coverage.`);
  }
  if ((stats.fusionKeyframes || 0) < 6) issues.push("A few more overlapping viewpoints will strengthen this surface.");
  if (diagnostics?.alignment?.disconnectedFrameIds?.length) issues.push("Some views failed the final alignment check.");
  const ambiguousEdges = diagnostics?.topologyAfterRepair?.nonManifoldEdges || 0;
  if (ambiguousEdges >= 200 && ambiguousEdges / Math.max(1, diagnostics?.triangles || 0) >= 0.01)
    issues.push("The reconstructed mesh has possible overlapping or torn edges. Inspect Geometry from the side before saving; depth points can help distinguish a reconstruction defect from missing capture data.");
  for (const issue of diagnostics?.measuredReviewWarning?.issues || []) {
    // Detached furniture is not evidence that the capture path is broken.
    if (issue.code !== "disconnected-mesh-patches" && issue.code !== "disconnected-capture-frames") issues.push(issue.message);
  }
  return { passed: issues.length === 0, scope: "observed-surfaces", issues: [...new Set(issues)],
    connected: capture?.connected ?? null, checkedReconstruction: !!diagnostics };
}
