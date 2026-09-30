export function createCaptureAnalysisWorker() {
  return new Worker(new URL("./captureAnalysis.worker.js", import.meta.url));
}
