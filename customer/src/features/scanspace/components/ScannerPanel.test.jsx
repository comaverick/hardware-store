import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ScannerPanel from "./ScannerPanel";
import { RoomScanner } from "../xr/RoomScanner";
import { createFusionWorker } from "../core/createFusionWorker";

jest.mock("../xr/RoomScanner", () => ({ RoomScanner: jest.fn() }));
jest.mock("../core/createFusionWorker", () => ({ createFusionWorker: jest.fn() }));
jest.mock("../core/captureDebug", () => ({ snapshotDepthCapture: jest.fn(() => new Blob()), downloadDepthCapture: jest.fn() }));

let scanner, result, diagnostics;
const cleanStats = () => ({
  depthActive: true, depthCurrent: true, tracking: true, floorY: 0, pointCount: 1200,
  stablePointCount: 1000, cameraBaseline: 0.5, fusionKeyframes: 8, features: [], errors: [],
  adaptiveCapture: { state: "tracking", connected: true, pendingCount: 0, coverage: {
    observed: 100, confirmed: 85, ratio: 0.85, regions: [{ id: "middle", observed: 100, confirmed: 85, ratio: 0.85 }],
  } },
});

beforeEach(() => {
  jest.clearAllMocks();
  diagnostics = {};
  result = { points: [], keyframes: [{ timestamp: 1 }, { timestamp: 2 }], textureKeyframes: [],
    stats: cleanStats(), floorY: 0, observer: { x: 0, z: 0 } };
  RoomScanner.mockImplementation(({ onUpdate, onEnd }) => {
    scanner = {
      paused: false, originChanged: false, stats: result.stats,
      publish: () => onUpdate({ ...result.stats, paused: scanner.paused }),
      start: jest.fn(async () => scanner.publish()), stop: jest.fn(async () => onEnd()),
      result: jest.fn(() => result),
    };
    return scanner;
  });
  createFusionWorker.mockImplementation(() => {
    const worker = { terminate: jest.fn(), postMessage: jest.fn(() => {
      Promise.resolve().then(() => worker.onmessage({ data: { type: "complete", result: {
        mesh: { triangleCount: 100 }, diagnostics,
      } } }));
    }) };
    return worker;
  });
});

async function startPanel() {
  const onSurface = jest.fn();
  render(<ScannerPanel capabilities={{ ar: true, secure: true }} onSurface={onSurface} onCancel={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Start camera scan" }));
  await screen.findByRole("button", { name: "Review scan" });
  return onSurface;
}

test("weak coverage pauses for review, preserves frames, and can resume", async () => {
  result.stats.adaptiveCapture.coverage.regions[0].ratio = 0.3;
  const onSurface = await startPanel();
  fireEvent.click(screen.getByRole("button", { name: "Review scan" }));
  expect(await screen.findByRole("status", { name: "Capture review" })).toBeInTheDocument();
  expect(scanner.paused).toBe(true);
  expect(createFusionWorker).not.toHaveBeenCalled();
  expect(onSurface).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep scanning" }));
  expect(scanner.paused).toBe(false);
  expect(result.keyframes).toHaveLength(2);
  expect(screen.queryByRole("status", { name: "Capture review" })).not.toBeInTheDocument();
});

test("explicit partial save retains the failed audit and original raw capture", async () => {
  result.stats.adaptiveCapture.pendingCount = 2;
  const onSurface = await startPanel();
  fireEvent.click(screen.getByRole("button", { name: "Review scan" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save partial scan" }));
  await waitFor(() => expect(onSurface).toHaveBeenCalledTimes(1));
  const saved = onSurface.mock.calls[0][0];
  expect(saved.rawCapture.keyframes).toBe(result.keyframes);
  expect(saved.captureQuality.partialCapture).toBe(true);
  expect(saved.captureQuality.captureAudit).toMatchObject({ passed: false, checkedReconstruction: true });
  expect(scanner.stop).toHaveBeenCalledTimes(1);
});

test("final reconstruction rechecks disconnections even when live coverage passed", async () => {
  diagnostics = { alignment: { disconnectedFrameIds: [4] } };
  const onSurface = await startPanel();
  fireEvent.click(screen.getByRole("button", { name: "Review scan" }));
  expect(await screen.findByText("Some views failed the final alignment check.")).toBeInTheDocument();
  expect(onSurface).not.toHaveBeenCalled();
  expect(scanner.paused).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Keep scanning" }));
  expect(scanner.paused).toBe(false);
  expect(result.keyframes).toHaveLength(2);
});

test("a clean scan finishes after both live and reconstruction checks", async () => {
  const onSurface = await startPanel();
  fireEvent.click(screen.getByRole("button", { name: "Review scan" }));
  await waitFor(() => expect(onSurface).toHaveBeenCalledTimes(1));
  expect(onSurface.mock.calls[0][0].captureQuality).toMatchObject({
    partialCapture: false, captureAudit: { passed: true, checkedReconstruction: true },
  });
});

test("a tracking reset cannot be bypassed with finish or resume", async () => {
  result.stats.originChanged = true;
  await startPanel();
  expect(screen.getByRole("button", { name: "Review scan" })).toBeDisabled();
  result.stats.originChanged = false;
  act(() => scanner.publish());
  scanner.result.mockImplementation(() => { throw new Error("Tracking origin changed. Start a new scan."); });
  fireEvent.click(screen.getByRole("button", { name: "Review scan" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Tracking origin changed");
  expect(createFusionWorker).not.toHaveBeenCalled();
});
