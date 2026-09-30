// Replays saved observations, not the phone's missing/rejected sensor stream.
// Usage: node scripts/replay-continuous-capture.cjs <raw-scan.json>
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { load } = require("./replay-scanspace.cjs");
const { ContinuousCapture } = load("src/features/scanspace/core/continuousCapture.js");
const { CaptureAnalysisStore } = load("src/features/scanspace/core/captureAnalysis.js");
const { adaptiveCaptureProfile, captureOverlap } = load("src/features/scanspace/core/adaptiveCapture.js");
const { parsePartialScan } = load("src/features/scanspace/core/partialScanFile.js");
const { restoreDepthCapture } = load("src/features/scanspace/core/captureDebug.js");

if (!process.argv[2]) {
  console.error("Usage: node scripts/replay-continuous-capture.cjs <raw-scan.json>");
  process.exitCode = 1;
} else {
  const source = fs.readFileSync(path.resolve(process.argv[2]), "utf8");
  const parsed = JSON.parse(source);
  const raw = parsed.format ? parsePartialScan(source).rawCapture : {
    ...restoreDepthCapture(parsed), stats: (parsed.capture || parsed).stats || {},
  };
  const capture = new ContinuousCapture(), acquisitionTimes = [], decisions = {};
  for (const original of raw.keyframes) {
    const frame = { ...original, depthType: original.depthType || raw.stats?.depthType || "" };
    const start = performance.now();
    const decision = capture.consider(frame, adaptiveCaptureProfile({
      depthType: frame.depthType, width: frame.nativeDepthWidth, height: frame.nativeDepthHeight,
    }));
    acquisitionTimes.push(performance.now() - start);
    decisions[decision.reason] = (decisions[decision.reason] || 0) + 1;
    assert(capture.frames.length <= 60, "Capture exceeded its geometry budget");
  }
  const store = new CaptureAnalysisStore(), frames = capture.frames.slice();
  const started = performance.now();
  const result = store.analyze({ ids: frames.map(frame => frame.captureId), changed: frames, floorY: raw.floorY });
  const analysisMs = performance.now() - started;
  assert(capture.applyAnalysis(result, frames));
  let checkedEdges = 0;
  for (const frame of capture.checkedFrames) for (const id of frame.captureLinks) {
    if (id <= frame.captureId) continue;
    const other = frames.find(saved => saved.captureId === id);
    const match = captureOverlap(frame, other);
    assert(match.accepted && !match.conflict, "A checked link failed independent revalidation");
    checkedEdges++;
  }
  acquisitionTimes.sort((a, b) => a - b);
  console.log(JSON.stringify({
    scope: "Saved-observation acquisition replay; no WebXR, phone timing or final mesh",
    inputViews: raw.keyframes.length, retainedViews: capture.frames.length,
    acquiredViews: capture.events.captured, checkedViews: capture.checkedFrames.length,
    unconnectedViewsPreserved: capture.snapshot().pendingCount,
    checkedGroups: result.groupCount, checkedEdges, decisions,
    acquisitionMs: { median: acquisitionTimes[Math.floor(acquisitionTimes.length * 0.5)],
      p95: acquisitionTimes[Math.floor(acquisitionTimes.length * 0.95)] },
    backgroundAnalysisMs: analysisMs,
  }, null, 2));
}
