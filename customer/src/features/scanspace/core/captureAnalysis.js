import { connectedCoverage } from "./adaptiveCapture";
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
  analyze({ ids, changed, floorY }) {
    if (ids.length > 60 || new Set(ids).size !== ids.length) throw new Error("Invalid live capture analysis size.");
    const keep = new Set(ids);
    for (const id of this.frames.keys()) if (!keep.has(id)) this.frames.delete(id);
    changed.forEach(frame => { if (keep.has(frame.captureId)) this.frames.set(frame.captureId, frame); });
    const frames = ids.map(id => this.frames.get(id));
    if (frames.some(frame => !frame)) throw new Error("Live analysis is missing a retained view.");
    return { coverage: connectedCoverage(frames), surfaces: observedCaptureSurfaces(frames, floorY) };
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
