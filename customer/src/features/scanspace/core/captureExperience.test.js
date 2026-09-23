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
  expect(experience.update(stats, 1900)).toMatchObject({ code: "reconnect", hint: stats.recoveryDirection });
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
