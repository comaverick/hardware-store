import { CaptureExperience, captureFeedback, sanitizeCaptureDiagnostics } from "./captureExperience";

const good = () => ({ tracking: true, depthCurrent: true, depthState: "active", currentViewChecked: true,
  fusionKeyframes: 12, adaptiveCapture: { state: "tracking", connected: true }, currentConfirmedRatio: 0.7 });

test("a short shake is quiet; sustained motion gets one prompt that clears immediately", () => {
  const experience = new CaptureExperience(), stats = good();
  expect(experience.update(stats, 0).code).toBe("scanning");
  const moving = { ...stats, movingTooFast: true, currentViewChecked: false };
  expect(experience.update(moving, 100).code).toBe("scanning");
  expect(experience.update(stats, 300).code).toBe("scanning");
  expect(experience.snapshot().promptCount).toBe(0);
  experience.update(moving, 400);
  expect(experience.update(moving, 2100).code).toBe("scanning");
  expect(experience.update(moving, 2300).code).toBe("motion");
  expect(experience.update(stats, 2400).code).toBe("scanning");
  experience.update(moving, 2500);
  expect(experience.update(moving, 4400).code).toBe("scanning");
  expect(experience.snapshot().prompts.motion).toBe(1);
  expect(experience.update(moving, 6900).code).toBe("motion");
  expect(experience.snapshot().prompts.motion).toBe(2);
});

test("reconnection guidance waits through a hiccup and disappears when overlap is being confirmed", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), currentViewChecked: false, adaptiveCapture: { state: "recovering" },
    recoveryDirection: "Turn gently left toward your last scanned area." };
  expect(experience.update(stats, 0).code).toBe("scanning");
  expect(experience.update(stats, 1700).code).toBe("scanning");
  expect(experience.update(stats, 1900)).toMatchObject({ code: "reconnect",
    hint: expect.stringMatching(/capture keeps trying/i) });
  expect(experience.update({ ...stats, frameQuality: "confirming-recovery" }, 2000).code).toBe("scanning");
  expect(captureFeedback({ ...good(), currentViewChecked: false }).label).toBe("Scanning");
});

test("good coverage stays visible long enough to be understood", () => {
  const experience = new CaptureExperience();
  const confirmed = { ...good(), currentConfirmedRatio: 0.9 };
  expect(experience.update(confirmed, 0).code).toBe("confirmed");
  expect(experience.update(good(), 1000).code).toBe("confirmed");
  expect(experience.update(good(), 4100).code).toBe("scanning");
});

test("tracking reset overrides motion guidance immediately and stale depth cannot request slowing", () => {
  const experience = new CaptureExperience();
  expect(experience.update({ ...good(), originChanged: true, movingTooFast: true }, 0).code).toBe("reset");
  const noDepth = { ...good(), depthCurrent: false, movingTooFast: true };
  experience.update(noDepth, 100);
  expect(experience.update(noDepth, 1800).code).toBe("scanning");
  expect(experience.update(noDepth, 2000).code).toBe("depth");
});

test("persistent depth failures have actionable status that clears on recovery", () => {
  const experience = new CaptureExperience();
  const interrupted = { ...good(), depthCurrent: false, depthState: "stalled",
    depthRecoveryState: "retrying", depthFailureKind: "depth-read-error" };
  expect(experience.update(interrupted, 2000)).toMatchObject({ code: "depth-retrying",
    label: "Depth read failed; retrying" });
  expect(experience.update({ ...interrupted, depthRecoveryState: "stalled" }, 11000))
    .toMatchObject({ code: "depth-stalled", label: "Depth reads keep failing",
      hint: expect.stringMatching(/review them now/i) });
  expect(experience.update(good(), 11200).code).toBe("scanning");
});

test("a stalled scan names the current rejection and clears as soon as a view is saved", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), fusionKeyframes: 2, currentConfirmedRatio: 0.3 };
  experience.update(stats, 0);
  experience.recordFrame({ timestamp: 100, reason: "connected", accepted: true, committed: 2, state: "tracking" });
  experience.update(stats, 100);
  experience.recordFrame({ timestamp: 3200, reason: "checking-overlap", state: "checking" });
  expect(experience.update(stats, 3200)).toMatchObject({ code: "stalled-overlap", stalled: true,
    label: "Connecting this view" });
  expect(experience.captureStall.hint).toMatch(/last saved area/i);
  experience.recordFrame({ timestamp: 3300, reason: "connected", accepted: true, committed: 1, state: "tracking" });
  expect(experience.update({ ...stats, fusionKeyframes: 3 }, 3300).code).toBe("scanning");
  expect(experience.captureStall).toBeNull();
});

test("measured shared depth reports alignment instead of blaming overlap", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), fusionKeyframes: 2, currentConfirmedRatio: 0.3 };
  experience.update(stats, 0);
  experience.recordFrame({ timestamp: 100, reason: "connected", accepted: true, committed: 2, state: "tracking" });
  experience.recordFrame({ timestamp: 3200, reason: "overlap-lost", state: "recovering",
    overlap: 0.27, medianResidual: 0.058, upperResidual: 0.095 });
  expect(experience.update(stats, 3200)).toMatchObject({ code: "stalled-alignment",
    label: "Aligning this view", hint: expect.stringMatching(/sideways step/i) });
});

test("bridge confirmation and conflicting depth have distinct guidance", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), fusionKeyframes: 2, currentConfirmedRatio: 0.3,
    adaptiveCapture: { state: "recovering", connected: true } };
  experience.update(stats, 0);
  experience.recordFrame({ timestamp: 100, reason: "connected", accepted: true, committed: 2, state: "tracking" });
  experience.recordFrame({ timestamp: 3200, reason: "confirming-bridge", state: "recovering" });
  expect(experience.update(stats, 3200)).toMatchObject({ code: "stalled-bridge",
    label: "Checking this connection" });
  experience.recordFrame({ timestamp: 3400, reason: "alignment-conflict", state: "recovering" });
  expect(experience.update(stats, 3400)).toMatchObject({ code: "stalled-alignment",
    label: "Checking depth alignment" });
  expect(experience.snapshot().decisions["confirming-bridge"]).toBe(1);
});

test("start rechecking invites a continuous sweep and escalates a persistent conflict after four seconds", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), fusionKeyframes: 2, currentViewChecked: false, frameQuality: "rechecking-start",
    adaptiveCapture: { state: "recovering", connected: true } };
  experience.recordFrame({ timestamp: 0, reason: "connected", accepted: true, committed: 2, state: "tracking" });
  experience.recordFrame({ timestamp: 400, reason: "rechecking-start", state: "recovering" });
  expect(experience.update(stats, 400)).toMatchObject({ code: "seed-recheck", tone: "active",
    hint: expect.stringMatching(/keep sweeping sideways/i) });
  experience.recordFrame({ timestamp: 2100, reason: "rechecking-start", state: "recovering" });
  expect(experience.update(stats, 2100).code).toBe("stalled-start");
  experience.recordFrame({ timestamp: 4100, reason: "rechecking-start", state: "recovering" });
  expect(experience.update(stats, 4100)).toMatchObject({ code: "stalled-reposition", label: "Try a wider view" });
  expect(experience.snapshot().decisions["rechecking-start"]).toBe(3);
});

test("a long spell of accepted but redundant views asks for a small sideways step", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), fusionKeyframes: 2, currentConfirmedRatio: 0.3 };
  experience.update(stats, 0);
  experience.recordFrame({ timestamp: 100, reason: "connected", accepted: true, committed: 0, state: "tracking" });
  experience.recordFrame({ timestamp: 3100, reason: "connected", accepted: true, committed: 0, state: "tracking" });
  expect(experience.update(stats, 3100)).toMatchObject({ code: "stalled-position", stalled: true,
    hint: expect.stringMatching(/sideways step/i) });
});

test("a completed area is not called stalled just because the phone stops moving", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), fusionKeyframes: 8, currentConfirmedRatio: 0.7 };
  experience.update(stats, 0);
  experience.recordFrame({ timestamp: 100, reason: "connected", accepted: true, committed: 0, state: "tracking" });
  experience.recordFrame({ timestamp: 3100, reason: "connected", accepted: true, committed: 0, state: "tracking" });
  expect(experience.update(stats, 3100).code).toBe("scanning");
  expect(experience.captureStall).toBeNull();
});

test("camera permission and setup time do not count as a capture stall", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), fusionKeyframes: 0, currentConfirmedRatio: 0 };
  experience.update(stats, 0);
  experience.recordFrame({ timestamp: 4000, reason: "starting", state: "starting" });
  expect(experience.update(stats, 4000).code).toBe("starting");
  expect(experience.captureStall).toBeNull();
  experience.recordFrame({ timestamp: 7100, reason: "starting", state: "starting" });
  expect(experience.update(stats, 7100).code).toBe("stalled-position");
});

test("stall guidance uses a fresh attempt, not old motion history", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), fusionKeyframes: 2, currentConfirmedRatio: 0.3 };
  experience.update(stats, 0);
  experience.recordFrame({ timestamp: 100, reason: "moving-too-fast", state: "tracking" });
  expect(experience.update(stats, 3200).code).toBe("scanning");
  experience.recordFrame({ timestamp: 3300, reason: "sparse-depth", state: "tracking" });
  expect(experience.update(stats, 3300)).toMatchObject({ code: "stalled-depth", stalled: true });
});

test("diagnostics distinguish gate peaks, useful commits, recovery time and paused time", () => {
  const experience = new CaptureExperience();
  experience.update(good(), 0);
  experience.recordFrame({ timestamp: 100, reason: "moving-too-fast", state: "tracking",
    gateLinearSpeed: 1.2, sampledLinearSpeed: 0, maxLinearSpeed: 0.35 });
  experience.update({ ...good(), adaptiveCapture: { state: "recovering" } }, 200);
  experience.recordFrame({ timestamp: 600, reason: "connected", accepted: true, committed: 1, matched: true, state: "tracking" });
  experience.update(good(), 600);
  experience.update({ ...good(), paused: true }, 700);
  experience.update({ ...good(), paused: true }, 1700);
  const stats = experience.snapshot();
  expect(stats).toMatchObject({ attempts: 2, accepted: 1, rejected: 1, committedFrames: 1, elapsedMs: 1700, activeMs: 700,
    stateMs: { recovering: 400, paused: 1000 }, decisions: { "moving-too-fast": 1, connected: 1 } });
  expect(stats.recent[0]).toMatchObject({ gateLinearSpeed: 1.2, sampledLinearSpeed: 0, maxLinearSpeed: 0.35 });
  stats.decisions.connected = 999;
  expect(experience.snapshot().decisions.connected).toBe(1);
});

test("a narrow connection asks for translation and a prolonged overlap stall changes the action", () => {
  const experience = new CaptureExperience();
  const stats = { ...good(), currentViewChecked: false, currentConfirmedRatio: 0,
    adaptiveCapture: { state: "recovering", connected: true, needsTranslation: true } };
  experience.recordFrame({ timestamp: 0, reason: "connected", accepted: true, committed: 2, state: "tracking" });
  experience.recordFrame({ timestamp: 3200, reason: "confirming-bridge", state: "recovering" });
  expect(experience.update(stats, 3200)).toMatchObject({ code: "stalled-translation",
    hint: expect.stringMatching(/sideways step.*shared edge/i) });
  experience.recordFrame({ timestamp: 11500, reason: "overlap-lost", state: "recovering" });
  expect(experience.update({ ...stats, adaptiveCapture: { ...stats.adaptiveCapture, needsTranslation: false } }, 11500))
    .toMatchObject({ code: "stalled-reposition", hint: expect.stringMatching(/step back.*sideways step/i) });
  expect(experience.snapshot().prompts["stalled-translation"]).toBe(1);
  expect(experience.snapshot().prompts["stalled-reposition"]).toBe(1);
});

test("saved-view geometry drives guidance without requiring all missing raw-depth pixels to fill", () => {
  expect(captureFeedback({ ...good(), surfaceReady: true, surfaceKind: "wall" })).toMatchObject({
    code: "surface-confirmed", label: "Wall section captured" });
  expect(captureFeedback({ ...good(), currentConfirmedRatio: 0.3, currentMeasuredConfirmedRatio: 0.94,
    validDepthRatio: 0.3 })).toMatchObject({ code: "confirmed", label: "This view is checked" });
  expect(captureFeedback({ ...good(), currentViewChecked: false, surfaceReady: true })).toMatchObject({ code: "scanning" });
  expect(captureFeedback({ ...good(), surfaceReady: true, cameraBaseline: 0.12 })).toMatchObject({ code: "baseline" });
});

test("a completed-view message clears when the next area is unconfirmed", () => {
  const experience = new CaptureExperience();
  expect(experience.update({ ...good(), currentConfirmedRatio: 0.9 }, 0).code).toBe("confirmed");
  expect(experience.update({ ...good(), currentViewChecked: false,
    adaptiveCapture: { state: "checking", connected: true } }, 500).code).toBe("scanning");
});

test("raw diagnostics are bounded and exclude images, positions and arbitrary keys", () => {
  const sanitized = sanitizeCaptureDiagnostics({ attempts: Infinity, decisions: { arbitrary: 999 },
    recent: Array.from({ length: 1000 }, (_, index) => ({ elapsedMs: index, reason: "moving-too-fast",
      gateLinearSpeed: Infinity, camera: [1, 2, 3], colorImage: "not exported" })) });
  expect(sanitized.attempts).toBe(0);
  expect(sanitized.recent).toHaveLength(48);
  expect(sanitized.recent[0].elapsedMs).toBe(952);
  expect(sanitized.recent[0].camera).toBeUndefined();
  expect(sanitized.recent[0].colorImage).toBeUndefined();
  expect(sanitized.recent[0].gateLinearSpeed).toBe(0);
  expect(sanitized.decisions.arbitrary).toBeUndefined();
});
