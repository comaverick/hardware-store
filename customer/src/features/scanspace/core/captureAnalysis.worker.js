/* global globalThis */
import { CaptureAnalysisStore } from "./captureAnalysis";

const store = new CaptureAnalysisStore();
globalThis.onmessage = ({ data }) => {
  if (data.type !== "analyze") return;
  const started = performance.now();
  try {
    const result = store.analyze(data);
    globalThis.postMessage({ type: "analysis", revision: data.revision,
      result: { ...result, processingMs: performance.now() - started } });
  } catch (error) {
    globalThis.postMessage({ type: "error", revision: data.revision, error: error.message });
  }
};
