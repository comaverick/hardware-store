// Keep bundler-specific worker construction separate from capture/UI logic.
export function createFusionWorker() {
  return new Worker(new URL("./fusion.worker.js", import.meta.url));
}
