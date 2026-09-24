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

function directionalAgreement(first, second) {
  const errors = [], tiles = new Set();
  let samples = 0, compared = 0, agreeing = 0, freeSpace = 0;
  const stride = Math.max(1, Math.ceil(first.filteredDepth.length / 280));
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
  const forward = directionalAgreement(prepareCaptureFrame(left), prepareCaptureFrame(right));
  const backward = directionalAgreement(prepareCaptureFrame(right), prepareCaptureFrame(left));
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

// A small shared patch can connect two larger views (for example, a wall
// while turning toward the floor). It needs stronger absolute, spatial and
// residual evidence than an ordinary full-frame match, and is never enough
// by itself to join two capture sections.
export function captureBridgeOverlap(result) {
  if (!result || result.conflict) return false;
  if (result.accepted) return true;
  const passes = value => value && value.compared >= 24 && value.agreeing >= 20 &&
    value.tiles >= 4 && value.support >= 0.06 && value.agreement >= 0.78 &&
    value.median <= 0.045 && value.upper <= 0.07 && value.freeSpaceRatio <= 0.2;
  return passes(result.forward) && passes(result.backward);
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
    this.provisionalSegments = [];
    this.nextSegmentId = 0;
    this.links = new Map();
    this.sequence = 0;
    this.state = "starting";
    this.reason = "starting";
    this.recoveryMatches = 0;
    this.pendingSupport = new WeakMap();
    this.events = { recoveries: 0, promoted: 0, expired: 0, removed: 0, capacityStops: 0,
      pendingAgeDrops: 0, pendingCapacityDrops: 0, pendingRedundantDrops: 0,
      pendingConflictDrops: 0, pendingResetDrops: 0, provisionalStarted: 0,
      provisionalSaved: 0, provisionalMerged: 0, provisionalCapacityStops: 0 };
  }
  provisionalFrameCount() {
    return this.provisionalSegments.reduce((count, segment) => count + segment.frames.length, 0);
  }
  provisionalFrames() {
    return this.provisionalSegments.flatMap(segment => segment.frames);
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
      conflict: results.some(value => value.result.conflict),
      best: results.sort((a, b) => b.result.overlap - a.result.overlap)[0]?.result };
  }
  provisionalMatch(frame) {
    return this.provisionalSegments.map(segment => {
      const nearest = segment.frames.slice().sort((a, b) =>
        distance(camera(a), camera(frame)) + angle(a, frame) - distance(camera(b), camera(frame)) - angle(b, frame));
      const references = [...new Set([...segment.frames.slice(-4), ...nearest.slice(0, 3)])];
      const results = references.map(reference => ({ reference, result: this.compare(frame, reference) }));
      return { segment, edges: results.filter(value => value.result.accepted).map(value => value.reference.captureId),
        conflict: results.some(value => value.result.conflict),
        support: Math.max(0, ...results.map(value => value.result.overlap || 0)) };
    }).filter(match => !match.conflict && match.edges.length)
      .sort((a, b) => b.support - a.support)[0];
  }
  considerProvisional(frame, profile) {
    const match = this.provisionalMatch(frame);
    if (match) {
      const segment = match.segment;
      const last = segment.frames[segment.frames.length - 1];
      const novel = distance(camera(last), camera(frame)) >= profile.spacing || angle(last, frame) >= profile.turn;
      if (novel && this.frames.length + this.provisionalFrameCount() >= this.maximumFrames) {
        this.events.provisionalCapacityStops++;
        this.capacityReached = true;
        return { accepted: false, committed: [], provisionalCommitted: [], reason: "capacity" };
      }
      if (novel) {
        segment.frames.push(frame);
        segment.links.set(frame.captureId, new Set(match.edges));
        match.edges.forEach(id => segment.links.get(id)?.add(frame.captureId));
        this.events.provisionalSaved++;
      }
      this.capacityReached = false;
      this.state = "capturing-new-area";
      this.reason = "provisional-connected";
      const merged = novel ? this.tryMergeProvisional(frame.timestamp) : [];
      return { accepted: true, committed: merged, provisionalCommitted: merged.length || !novel ? [] : [frame],
        reason: merged.length ? "connected" : "provisional-connected" };
    }
    if (this.provisionalSegments.length >= 2) {
      this.events.provisionalCapacityStops++;
      this.capacityReached = true;
      return { accepted: false, committed: [], provisionalCommitted: [], reason: "capacity" };
    }
    const seed = this.pending.find(value => distance(camera(frame), camera(value)) >= 0.04 &&
      this.compare(frame, value).accepted);
    if (!seed) return null;
    if (this.frames.length + this.provisionalFrameCount() + 2 > this.maximumFrames) {
      this.events.provisionalCapacityStops++;
      this.capacityReached = true;
      return { accepted: false, committed: [], provisionalCommitted: [], reason: "capacity" };
    }
    const segment = { id: ++this.nextSegmentId, frames: [seed, frame],
      links: new Map([[seed.captureId, new Set([frame.captureId])], [frame.captureId, new Set([seed.captureId])]]) };
    this.pending = this.pending.filter(value => value !== seed);
    this.provisionalSegments.push(segment);
    this.events.provisionalStarted++;
    this.events.provisionalSaved += 2;
    this.capacityReached = false;
    this.state = "capturing-new-area";
    this.reason = "provisional-connected";
    const merged = this.tryMergeProvisional(frame.timestamp);
    return { accepted: true, committed: merged, provisionalCommitted: merged.length ? [] : [seed, frame],
      reason: merged.length ? "connected" : "provisional-connected" };
  }
  bridgeMatches(frame) {
    const references = this.references(frame).sort((left, right) =>
      distance(camera(frame), camera(left)) + angle(frame, left) -
      distance(camera(frame), camera(right)) - angle(frame, right)).slice(0, 5);
    const results = references.map(reference => ({ reference, result: this.compare(frame, reference) }));
    if (results.some(value => value.result.conflict)) return [];
    return results.filter(value => captureBridgeOverlap(value.result)).map(value => value.reference.captureId);
  }
  tryMergeProvisional(timestamp) {
    const joined = [];
    for (const segment of this.provisionalSegments.slice()) {
      // Keep bridge checks bounded during live capture. Revisit old views when
      // the trusted path approaches them, but do not compare every retained
      // frame against the entire map on every camera observation.
      const nearest = segment.frames.slice().sort((left, right) => {
        const proximity = frame => Math.min(...this.frames.map(main =>
          distance(camera(frame), camera(main)) + angle(frame, main)));
        return proximity(left) - proximity(right);
      }).slice(0, 4);
      const candidates = [...new Set([segment.frames[0], ...segment.frames.slice(-3), ...nearest])];
      const bridges = candidates.map(frame => ({ frame, edges: this.bridgeMatches(frame) }))
        .filter(value => value.edges.length);
      const first = bridges.find((value, index) => bridges.slice(index + 1).some(other =>
        distance(camera(value.frame), camera(other.frame)) >= 0.04 &&
        segment.links.get(value.frame.captureId)?.has(other.frame.captureId)));
      if (!first) continue;
      this.provisionalSegments = this.provisionalSegments.filter(value => value !== segment);
      const remaining = new Map(segment.frames.map(frame => [frame.captureId, frame]));
      this.commit(first.frame, first.edges);
      remaining.delete(first.frame.captureId);
      joined.push(first.frame);
      while (remaining.size) {
        const next = [...remaining.values()].map(frame => ({ frame, edges: [
          ...(segment.links.get(frame.captureId) || []),
          ...(bridges.find(value => value.frame === frame)?.edges || []),
        ].filter(id => this.links.has(id)) })).find(value => value.edges.length);
        if (!next) break;
        this.commit(next.frame, [...new Set(next.edges)]);
        remaining.delete(next.frame.captureId);
        joined.push(next.frame);
      }
      if (remaining.size) {
        segment.frames = [...remaining.values()];
        segment.links = new Map(segment.frames.map(frame => [frame.captureId,
          new Set([...(segment.links.get(frame.captureId) || [])].filter(id => remaining.has(id)))]));
        this.provisionalSegments.push(segment);
      } else this.events.provisionalMerged++;
    }
    if (joined.length) {
      this.frames.sort((a, b) => a.timestamp - b.timestamp);
      this.state = "tracking";
      this.reason = "connected";
      this.lastReliableAt = timestamp;
      this.uncertainSince = null;
      this.clearRecoveryEvidence();
    }
    return joined.sort((left, right) => left.timestamp - right.timestamp);
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
    if (this.frames.length + this.provisionalFrameCount() > this.maximumFrames) {
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
    if (this.lastReliableAt != null && time - this.lastReliableAt > RECOVERY_EVIDENCE_MS &&
        ["tracking", "checking"].includes(this.state))
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
      this.clearRecoveryEvidence();
      if (this.state === "tracking") {
        this.state = "checking";
        this.uncertainSince = time;
      }
      if (this.state === "checking" && time - this.uncertainSince >= OVERLAP_GRACE_MS)
        this.recover("overlap-lost", time);
      const provisional = this.considerProvisional(frame, profile);
      if (provisional) return provisional;
      this.reason = this.state === "recovering" ? "overlap-lost" : "checking-overlap";
      this.buffer(frame, match.best?.overlap || 0);
      return { accepted: false, committed: [], reason: this.reason };
    }
    this.lastReliableAt = time;
    if (this.state === "capturing-new-area") this.state = "recovering";
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
    this.capacityReached = false;
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
    if (this.frames.some(value => !before.has(value))) this.tryMergeProvisional(time);
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
    this.provisionalSegments.forEach(segment => segment.frames.forEach(frame => {
      frame.captureLinks = [...(segment.links.get(frame.captureId) || [])];
    }));
    return { version: ADAPTIVE_CAPTURE_VERSION, state: this.state, reason: this.reason,
      connected: this.frames.length >= 2 && graphConnected(this.frames, this.links),
      frameCount: this.frames.length, pendingCount: this.pending.length,
      provisionalFrameCount: this.provisionalFrameCount(),
      provisionalSegmentCount: this.provisionalSegments.length,
      provisionalSegments: this.provisionalSegments.map(segment => ({ id: segment.id,
        frameCount: segment.frames.length, connected: graphConnected(segment.frames, segment.links) })),
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
  if (capture?.provisionalSegmentCount) issues.push(`${capture.provisionalSegmentCount} captured area${capture.provisionalSegmentCount === 1 ? " remains" : "s remain"} separate because their connection to the main scan was not verified. Review each area before saving.`);
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
