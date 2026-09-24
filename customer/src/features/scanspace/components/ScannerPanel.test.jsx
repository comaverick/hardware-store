import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ScannerPanel from "./ScannerPanel";
import { RoomScanner } from "../xr/RoomScanner";
import { createFusionWorker } from "../core/createFusionWorker";

jest.mock("../xr/RoomScanner", () => ({ RoomScanner: jest.fn() }));
jest.mock("../core/createFusionWorker", () => ({ createFusionWorker: jest.fn() }));
jest.mock("../core/captureDebug", () => ({ snapshotDepthCapture: jest.fn(() => new Blob()), downloadDepthCapture: jest.fn() }));
jest.mock("./PartialScanScene", () => ({ __esModule: true,
  default: () => {
    if (mockPreviewUnavailable) throw new Error("Simulated WebGL unavailable");
    return <div data-testid="scan-preview">Interactive scan preview</div>;
  } }));

let scanner, result, diagnostics;
let mockPreviewUnavailable = false;
const cleanStats = () => ({
  depthActive: true, depthCurrent: true, tracking: true, floorY: 0, pointCount: 1200,
  stablePointCount: 1000, cameraBaseline: 0.5, fusionKeyframes: 8, features: [], errors: [],
  adaptiveCapture: { state: "tracking", connected: true, pendingCount: 0, coverage: {
    observed: 100, confirmed: 85, ratio: 0.85, regions: [{ id: "middle", observed: 100, confirmed: 85, ratio: 0.85 }],
  } },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPreviewUnavailable = false;
  diagnostics = {};
  result = { points: [], keyframes: [{ timestamp: 1 }, { timestamp: 2 }], textureKeyframes: [],
    stats: cleanStats(), floorY: 0, observer: { x: 0, z: 0 } };
  RoomScanner.mockImplementation(({ onUpdate, onEnd }) => {
    scanner = {
      paused: false, originChanged: false, stats: result.stats,
      publish: () => onUpdate({ ...result.stats, paused: scanner.paused }),
      start: jest.fn(async () => scanner.publish()), stop: jest.fn(async () => onEnd()),
      result: jest.fn(() => result), onEnd,
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
  await screen.findByRole("button", { name: /Finish & review|Review saved scan/ });
  return onSurface;
}

test("the pre-scan guide explains movement, overlap, and choosing an area", () => {
  render(<ScannerPanel capabilities={{ ar: true, secure: true }} onSurface={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.getByRole("heading", { name: "Before you start" })).toBeInTheDocument();
  expect(screen.getByText("Move slowly")).toBeInTheDocument();
  expect(screen.getByText("Overlap each pass")).toBeInTheDocument();
  expect(screen.getByText("Choose your area")).toBeInTheDocument();
});

test("weak coverage builds the preview directly, preserves frames, and can resume", async () => {
  result.stats.adaptiveCapture.coverage.regions[0].ratio = 0.3;
  const onSurface = await startPanel();
  fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
  expect(await screen.findByRole("status", { name: "Capture review" })).toBeInTheDocument();
  expect(scanner.paused).toBe(true);
  expect(createFusionWorker).toHaveBeenCalledTimes(1);
  expect(await screen.findByTestId("scan-preview")).toBeInTheDocument();
  expect(onSurface).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep scanning" }));
  expect(scanner.paused).toBe(false);
  expect(result.keyframes).toHaveLength(2);
  expect(screen.queryByRole("status", { name: "Capture review" })).not.toBeInTheDocument();
});

test("explicit partial save retains the failed audit and original raw capture", async () => {
  result.stats.adaptiveCapture.pendingCount = 2;
  const onSurface = await startPanel();
  fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
  expect(await screen.findByText("Some views failed the final alignment check.")).toBeInTheDocument();
  expect(onSurface).not.toHaveBeenCalled();
  expect(scanner.paused).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Keep scanning" }));
  expect(scanner.paused).toBe(false);
  expect(result.keyframes).toHaveLength(2);
});

test("a clean scan can be inspected before saving without reconstructing twice", async () => {
  const onSurface = await startPanel();
  fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
  const save = await screen.findByRole("button", { name: "Save scan" });
  expect(onSurface).not.toHaveBeenCalled();
  expect(await screen.findByTestId("scan-preview")).toBeInTheDocument();
  fireEvent.click(save);
  await waitFor(() => expect(onSurface).toHaveBeenCalledTimes(1));
  expect(createFusionWorker).toHaveBeenCalledTimes(1);
  expect(onSurface.mock.calls[0][0].captureQuality).toMatchObject({
    partialCapture: false, captureAudit: { passed: true, checkedReconstruction: true },
  });
});

test("checking a view keeps saved progress visible and gives one stable instruction", async () => {
  result.stats.fusionKeyframes = 4;
  result.stats.currentViewChecked = false;
  result.stats.currentConfirmedRatio = 0;
  result.stats.adaptiveCapture.state = "checking";
  await startPanel();
  expect(screen.getByText("Checking new view")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Scanning");
  expect(screen.queryByText("0% of this view has confirmed overlap.")).not.toBeInTheDocument();
  expect(screen.queryByText(/Keep moving until the visible surface/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finish & review" })).toBeEnabled();
  expect(screen.queryByText("Device diagnostics")).not.toBeInTheDocument();
});

test("a stalled scan shows the same actionable reason in progress and live status", async () => {
  result.stats.fusionKeyframes = 4;
  result.stats.currentViewChecked = false;
  result.stats.adaptiveCapture.state = "checking";
  result.stats.captureStall = { code: "stalled-overlap", stalled: true, tone: "warning",
    label: "Not enough overlap", hint: "Turn back toward the last captured area." };
  result.stats.captureFeedback = result.stats.captureStall;
  await startPanel();
  expect(screen.getByText("No new view saved")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Not enough overlap");
  expect(screen.getAllByText(/turn back toward the last captured area/i)).toHaveLength(2);
});

test("a stopped depth feed keeps review available and changes the recovery action", async () => {
  result.stats.depthCurrent = false;
  result.stats.depthRecoveryState = "stalled";
  result.stats.depthFailureKind = "depth-missing";
  result.stats.captureFeedback = { code: "depth-stalled", tone: "warning",
    label: "Depth sensor stopped responding", hint: "Your saved views are safe. Review them now." };
  await startPanel();
  expect(screen.getByRole("status")).toHaveTextContent("Depth sensor stopped responding");
  expect(screen.getByRole("button", { name: "Review saved scan" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Review saved scan" }));
  expect(await screen.findByRole("status", { name: "Capture review" })).toBeInTheDocument();
});

test.each(["during", "after"])("the captured result can be saved if XR ends %s reconstruction", async timing => {
  const onSurface = await startPanel();
  fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
  if (timing === "after") await screen.findByTestId("scan-preview");
  act(() => scanner.onEnd());
  expect(await screen.findByTestId("scan-preview")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Keep scanning" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Start camera scan" })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save scan" }));
  await waitFor(() => expect(onSurface).toHaveBeenCalledTimes(1));
});

test("a preview failure keeps the checked capture and save controls available", async () => {
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    mockPreviewUnavailable = true;
    const onSurface = await startPanel();
    fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
    expect(await screen.findByText(/The preview could not open/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save scan" }));
    await waitFor(() => expect(onSurface).toHaveBeenCalledTimes(1));
  } finally {
    errorLog.mockRestore();
  }
});

test("a reference-space reset during review does not discard the preview or allow resume", async () => {
  await startPanel();
  fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
  await screen.findByTestId("scan-preview");
  scanner.originChanged = result.stats.originChanged = true;
  act(() => scanner.publish());
  expect(screen.getByRole("button", { name: "Keep scanning" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save scan" })).toBeEnabled();
  expect(scanner.paused).toBe(true);
});

test("a tracking reset cannot be bypassed with finish or resume", async () => {
  result.stats.originChanged = true;
  await startPanel();
  expect(screen.getByRole("button", { name: "Finish & review" })).toBeDisabled();
  result.stats.originChanged = false;
  act(() => scanner.publish());
  scanner.result.mockImplementation(() => { throw new Error("Tracking origin changed. Start a new scan."); });
  fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Tracking origin changed");
  expect(createFusionWorker).not.toHaveBeenCalled();
});
