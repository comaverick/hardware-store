import { captureOverlap, connectedCoverage, prepareCaptureFrame } from "./adaptiveCapture";
import { observedCaptureSurfaces } from "./captureSurfaces";

const geometryArrays = ["positions", "depths", "colors", "colorMask", "projectionMatrix", "transformMatrix", "camera"];

export function copyAnalysisFrame(frame) {
  const copy = { captureId: frame.captureId, columns: frame.columns, rows: frame.rows,
    timestamp: frame.timestamp, depthType: frame.depthType, geometryMode: frame.geometryMode,
    validCount: frame.validCount };
  geometryArrays.forEach(key => { copy[key] = frame[key]?.slice(); });
  return copy;
}

export class CaptureAnalysisStore {
  frames = new Map();
  comparisons = new Map();
  constructor(compare = captureOverlap) {
    this.compare = compare;
  }
  analyze({ ids, changed, floorY }) {
    if (ids.length > 60 || new Set(ids).size !== ids.length) throw new Error("Invalid live capture analysis size.");
    const keep = new Set(ids);
    for (const id of this.frames.keys()) if (!keep.has(id)) this.frames.delete(id);
    const changedIds = new Set(changed.filter(frame => this.frames.get(frame.captureId) !== frame).map(frame => frame.captureId));
    for (const [key, entry] of this.comparisons) {
      if (changedIds.has(entry.left.captureId) || changedIds.has(entry.right.captureId)) this.comparisons.delete(key);
    }
    changed.forEach(frame => { if (keep.has(frame.captureId)) this.frames.set(frame.captureId, frame); });
    const frames = ids.map(id => this.frames.get(id));
    if (frames.some(frame => !frame)) throw new Error("Live analysis is missing a retained view.");
    for (const [key, entry] of this.comparisons) {
      if (!keep.has(entry.left.captureId) || !keep.has(entry.right.captureId)) this.comparisons.delete(key);
    }
    const links = new Map(ids.map(id => [id, new Set()]));
    const poseDistance = (a, b) => Math.hypot(...[0, 1, 2].map(i => a.camera[i] - b.camera[i]));
    // Compare a bounded local neighbourhood in the worker. A failed match to
    // the first wall cannot veto a later, independently agreeing sweep.
    frames.forEach((frame, index) => {
      const nearest = frames.filter(other => other !== frame && poseDistance(frame, other) >= 0.04).sort((a, b) =>
        poseDistance(frame, a) - poseDistance(frame, b)).slice(0, 4);
      const references = new Set([...frames.slice(Math.max(0, index - 2), index),
        ...frames.slice(index + 1, index + 3), ...nearest]);
      for (const reference of references) {
        if (poseDistance(frame, reference) < 0.04) continue;
        const [left, right] = [frame, reference].sort((a, b) => a.captureId - b.captureId);
        const key = `${left.captureId}:${right.captureId}`;
        let entry = this.comparisons.get(key);
        if (entry?.left !== left || entry?.right !== right) {
          entry = { left, right, result: this.compare(left, right) };
          this.comparisons.set(key, entry);
        }
        if (!entry.result.accepted || entry.result.conflict) continue;
        links.get(left.captureId).add(right.captureId);
        links.get(right.captureId).add(left.captureId);
      }
    });
    const seen = new Set(), groups = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const group = [id];
      seen.add(id);
      for (let i = 0; i < group.length; i++) for (const next of links.get(group[i])) {
        if (!seen.has(next)) { seen.add(next); group.push(next); }
      }
      groups.push(group);
    }
    groups.sort((a, b) => b.length - a.length);
    const checkedIds = groups[0]?.length >= 2 ? groups[0] : [];
    const checked = frames.filter(frame => checkedIds.includes(frame.captureId));
    const { preview, ...coverage } = connectedCoverage(checked, { includePoints: true });
    return { checkedIds, groupCount: groups.length,
      links: Object.fromEntries([...links].map(([id, values]) => [id, [...values]])),
      measuredCounts: Object.fromEntries(frames.map(frame => [frame.captureId, prepareCaptureFrame(frame).measuredCount])),
      coverage, preview, surfaces: observedCaptureSurfaces(checked, floorY) };
  }
}

// At most one worker job and one latest request. Copies are made only when a
// job is dispatched, and unchanged depth views stay resident in the worker.
export class CaptureAnalysisController {
  constructor(worker, onResult, onError) {
    this.worker = worker;
    this.onResult = onResult;
    this.onError = onError;
    this.sent = new Map();
    this.revision = 0;
    worker.onmessage = ({ data }) => {
      if (this.closed || data.revision !== this.revision) return;
      if (data.type === "error") return this.fail(onError);
      if (data.type !== "analysis") return;
      const sources = this.inFlight;
      this.inFlight = null;
      onResult(data.result, sources);
      this.flush();
    };
    worker.onerror = () => this.fail(onError);
  }
  fail(onError) {
    if (this.closed) return;
    this.close();
    onError?.();
  }
  request(frames, floorY) {
    if (this.closed) return;
    this.latest = { frames: frames.slice(), floorY };
    this.flush();
  }
  flush() {
    if (this.closed || this.inFlight || !this.latest) return;
    const sources = this.latest;
    this.latest = null;
    const changed = sources.frames.filter(frame => this.sent.get(frame.captureId) !== frame).map(copyAnalysisFrame);
    this.sent = new Map(sources.frames.map(frame => [frame.captureId, frame]));
    this.inFlight = sources;
    const transfer = changed.flatMap(frame => geometryArrays.map(key => frame[key]?.buffer).filter(Boolean));
    try {
      this.worker.postMessage({ type: "analyze", revision: ++this.revision,
        ids: sources.frames.map(frame => frame.captureId), changed, floorY: sources.floorY }, transfer);
    } catch {
      this.fail(this.onError);
    }
  }
  close() {
    this.closed = true;
    this.worker.terminate();
    this.latest = this.inFlight = null;
    this.sent.clear();
  }
}
