// Replay only the live connection gate, without editing the raw capture.
// A saved export omits rejected camera frames and cannot reproduce the full
// motion stream, RGB readback cost, or a user's response to recovery guidance.
// Usage: node scripts/replay-adaptive-capture.cjs <raw-scan.json> [--verbose]
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { load } = require("./replay-scanspace.cjs");
const { parsePartialScan } = load("src/features/scanspace/core/partialScanFile.js");
const { AdaptiveCapture, adaptiveCaptureProfile, auditCapture, captureOverlap } = load("src/features/scanspace/core/adaptiveCapture.js");

if (!process.argv[2]) {
  console.error("Usage: node scripts/replay-adaptive-capture.cjs <raw-scan.json> [--verbose]");
  process.exitCode = 1;
} else {
  const raw = parsePartialScan(fs.readFileSync(path.resolve(process.argv[2]), "utf8")).rawCapture;
  if (!raw?.keyframes?.length) throw new Error("A raw RGB-D scan is required.");
  const capture = new AdaptiveCapture();
  const decisions = raw.keyframes.map((source, index) => {
    const frame = { ...source, depthType: source.depthType || raw.stats?.depthType || "" };
    const start = performance.now();
    const decision = capture.consider(frame, adaptiveCaptureProfile({
      depthType: frame.depthType, width: frame.nativeDepthWidth, height: frame.nativeDepthHeight,
    }));
    const state = capture.snapshot();
    assert(capture.frames.length <= 60 && capture.pending.length <= 6, "Capture memory limits exceeded");
    assert(!capture.frames.length || state.connected, "A disconnected view entered the saved graph");
    return { index, timestamp: frame.timestamp, reason: decision.reason,
      committed: decision.committed.length, retained: state.frameCount, pending: state.pendingCount,
      elapsedMs: Math.round(performance.now() - start),
      medianResidual: capture.lastMatch?.median ?? null };
  });
  const final = capture.snapshot();
  let checkedConnections = 0;
  capture.frames.forEach(frame => frame.captureLinks.forEach(id => {
    if (frame.captureId >= id) return;
    const neighbor = capture.frames.find(other => other.captureId === id);
    assert(neighbor && captureOverlap(frame, neighbor).accepted, "A retained connection failed independent revalidation");
    checkedConnections++;
  }));
  const times = decisions.map(row => row.elapsedMs).sort((a, b) => a - b);
  console.log(JSON.stringify({
    scope: "Saved-depth connection-gate replay, not a full WebXR or rendering test",
    inputFrames: raw.keyframes.length, retainedFrames: final.frameCount, checkedConnections,
    connected: final.connected, state: final.state, provisionalFrames: final.pendingCount,
    recoveries: final.recoveries, promoted: final.promoted, expired: final.expired,
    confirmedObservedArea: final.coverage.ratio,
    firstRecovery: decisions.find(row => ["overlap-lost", "alignment-conflict"].includes(row.reason)) || null,
    processingMs: { median: times[Math.floor(times.length * 0.5)], p95: times[Math.floor(times.length * 0.95)] },
    finishAudit: auditCapture({ fusionKeyframes: final.frameCount, adaptiveCapture: final }),
    decisions: process.argv.includes("--verbose") ? decisions : undefined,
  }, null, 2));
}
