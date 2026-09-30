import * as THREE from "three";
import { RoomScanner } from "./RoomScanner";

jest.mock("three", () => ({
  ...jest.requireActual("three"),
  WebGLRenderer: jest.fn(),
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

let scanner, session, space, renderer, order, previousXr;
beforeEach(() => {
  order = [];
  space = new EventTarget();
  session = Object.assign(new EventTarget(), {
    domOverlayState: { type: "screen" },
    enabledFeatures: ["hit-test", "depth-sensing"],
    depthUsage: "cpu-optimized", depthType: "raw", depthDataFormat: "float32",
    requestReferenceSpace: jest.fn(async () => space),
    requestHitTestSource: jest.fn(async () => ({ cancel: jest.fn() })),
  });
  session.end = jest.fn(async () => session.dispatchEvent(new Event("end")));
  renderer = {
    xr: { setReferenceSpaceType: jest.fn(), setReferenceSpace: jest.fn(),
      setSession: jest.fn(async () => session.addEventListener("end", () => order.push("xr end"))) },
    setPixelRatio: jest.fn(), setSize: jest.fn(), setClearColor: jest.fn(),
    setAnimationLoop: jest.fn(), dispose: jest.fn(() => order.push("renderer dispose")),
  };
  THREE.WebGLRenderer.mockReturnValue(renderer);
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: jest.fn(), fillRect: jest.fn(),
    createRadialGradient: () => ({ addColorStop: jest.fn() }),
  });
  jest.spyOn(window, "setInterval").mockReturnValue(99);
  jest.spyOn(window, "clearInterval").mockImplementation(() => {});
  previousXr = Object.getOwnPropertyDescriptor(navigator, "xr");
  Object.defineProperty(navigator, "xr", { configurable: true, value: {
    requestSession: jest.fn(async () => session),
  } });
  scanner = new RoomScanner({ canvas: document.createElement("canvas"),
    overlay: document.createElement("div"), onUpdate: jest.fn(), onEnd: jest.fn() });
});

afterEach(() => {
  scanner.cleanup();
  window.history.replaceState({}, "", "/");
  delete window.scanspaceDebug;
  if (previousXr) Object.defineProperty(navigator, "xr", previousXr);
  else delete navigator.xr;
  jest.restoreAllMocks();
});

test("renderer disposal follows Three.js session-end handling", async () => {
  await scanner.start();
  await scanner.stop();
  expect(order).toEqual(["xr end", "renderer dispose"]);
  expect(scanner.onEnd).toHaveBeenCalledTimes(1);
  expect(window.clearInterval).toHaveBeenCalledWith(99);
});

test("stop still cleans up if the session resolves without an end event", async () => {
  await scanner.start();
  session.end.mockResolvedValue(undefined);
  await scanner.stop();
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(scanner.closed).toBe(true);
  expect(scanner.onEnd).toHaveBeenCalledTimes(1);
});

test("concurrent stop calls end the session and notify only once", async () => {
  await scanner.start();
  const ending = deferred();
  session.end.mockReturnValue(ending.promise);
  const first = scanner.stop();
  const second = scanner.stop();
  expect(session.end).toHaveBeenCalledTimes(1);
  ending.resolve();
  await Promise.all([first, second]);
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(scanner.onEnd).toHaveBeenCalledTimes(1);
});

test("a canceled pending session request is ended without restarting capture", async () => {
  const requesting = deferred();
  navigator.xr.requestSession.mockReturnValue(requesting.promise);
  const starting = scanner.start();
  await scanner.stop();
  requesting.resolve(session);
  expect(await starting).toBe(false);
  expect(session.end).toHaveBeenCalledTimes(1);
  expect(renderer.xr.setSession).not.toHaveBeenCalled();
  expect(scanner.session).toBeNull();
  expect(scanner.onEnd).toHaveBeenCalledTimes(1);
});

test("a session ending during initialization cannot install a capture loop", async () => {
  renderer.xr.setSession.mockImplementation(async () => {
    session.dispatchEvent(new Event("end"));
  });
  expect(await scanner.start()).toBe(false);
  expect(renderer.setAnimationLoop).not.toHaveBeenCalledWith(expect.any(Function));
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
});

test("a hit source arriving after cancellation is released immediately", async () => {
  const requesting = deferred();
  const hit = { cancel: jest.fn() };
  session.requestHitTestSource.mockReturnValue(requesting.promise);
  const starting = scanner.start();
  // Wait for the request itself, without advancing camera timers.
  for (let count = 0; count < 8 && !session.requestHitTestSource.mock.calls.length; count++)
    await Promise.resolve();
  expect(session.requestHitTestSource).toHaveBeenCalledTimes(1);
  await scanner.stop();
  requesting.resolve(hit);
  expect(await starting).toBe(false);
  expect(hit.cancel).toHaveBeenCalledTimes(1);
  expect(scanner.hitSource).toBeNull();
  expect(renderer.setAnimationLoop).not.toHaveBeenCalledWith(expect.any(Function));
});

test("closed reference spaces cannot change the saved origin or publish again", async () => {
  await scanner.start();
  await scanner.stop();
  scanner.onUpdate.mockClear();
  space.dispatchEvent(new Event("reset"));
  expect(scanner.originChanged).toBeFalsy();
  expect(scanner.onUpdate).not.toHaveBeenCalled();
});

test("a partial startup failure releases resources and preserves the original error", async () => {
  session.requestHitTestSource.mockRejectedValue(new Error("hit-test setup failed"));
  await expect(scanner.start()).rejects.toThrow("hit-test setup failed");
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(scanner.onEnd).toHaveBeenCalledTimes(1);
  expect(scanner.closed).toBe(true);
});

test("zero-view sensor failures expose negotiated depth and read counts only when debugging", async () => {
  expect(window.scanspaceDebug).toBeUndefined();
  scanner.cleanup();
  window.history.replaceState({}, "", "/?scanspaceDebug=1");
  scanner = new RoomScanner({ canvas: document.createElement("canvas"),
    overlay: document.createElement("div"), onUpdate: jest.fn(), onEnd: jest.fn() });
  session.depthActive = true;
  session.visibilityState = "visible";
  renderer.render = jest.fn();
  await scanner.start();
  const transform = { position: { x: 0, y: 1.6, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    matrix: new THREE.Matrix4().makeTranslation(0, 1.6, 0).elements };
  const frame = {
    getViewerPose: () => ({ transform, views: [{ transform }] }),
    getHitTestResults: () => [], getDepthInformation: jest.fn(() => null),
  };
  scanner.frame(1000, frame);
  scanner.frame(11500, frame);
  expect(window.scanspaceDebug.snapshot().state).toMatchObject({
    fusionKeyframes: 0, xrFrames: 2, depthReads: 2, totalDepthMisses: 2,
    nativeDepthActive: true, depthUsage: "cpu-optimized", depthType: "raw",
    format: "float32", sessionVisibility: "visible", depthFailureKind: "depth-missing",
    depthRecoveryState: "stalled", depthResumeAttempts: 0,
  });
  expect(window.scanspaceDebug.snapshot().errorCount).toBe(0);
  await scanner.stop();
  expect(window.scanspaceDebug.snapshot().state.closed).toBe(true);
  expect(scanner.keyframes).toHaveLength(0);
});
