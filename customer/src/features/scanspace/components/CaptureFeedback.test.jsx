import { fireEvent, render, screen } from "@testing-library/react";
import { CaptureAuditNotice, CaptureCoverage, CaptureProgress } from "./CaptureFeedback";

test("coverage distinguishes unseen space from observed surface confirmation", () => {
  render(<CaptureCoverage coverage={{ regions: [
    { id: "lower", observed: 0, ratio: 0 },
    { id: "middle", observed: 100, ratio: 0.7 },
    { id: "upper", observed: 40, ratio: 0.2 },
  ] }} />);
  expect(screen.getByText("Not seen")).toBeInTheDocument();
  expect(screen.getByText("Checked")).toBeInTheDocument();
  expect(screen.getByText("Partial")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Upper surfaces confirmed" })).toHaveAttribute("value", "20");
});

test("partial capture readiness depends on observed overlap, not a room sweep or unseen heights", () => {
  render(<CaptureProgress stats={{
    coverage: 58,
    fusionKeyframes: 8,
    currentViewChecked: true,
    adaptiveCapture: { connected: true, pendingCount: 0, state: "tracking", coverage: {
      ratio: 0.7,
      regions: [
        { id: "lower", observed: 0, ratio: 0 },
        { id: "middle", observed: 100, ratio: 0.7 },
        { id: "upper", observed: 40, ratio: 0.8 },
      ],
    } },
  }} />);
  expect(screen.queryByText("58%")).not.toBeInTheDocument();
  expect(screen.queryByText("70%")).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Walls and objects confirmed" })).toHaveAttribute("value", "70");
  expect(screen.getByText("Ready to review")).toBeInTheDocument();
  expect(screen.queryByText(/another overlapping pass/i)).not.toBeInTheDocument();
});

test("scan progress still accepts complete coverage across every height", () => {
  render(<CaptureProgress stats={{
    coverage: 79,
    fusionKeyframes: 8,
    currentViewChecked: true,
    adaptiveCapture: { connected: true, pendingCount: 0, state: "tracking", coverage: {
      ratio: 0.8,
      regions: ["lower", "middle", "upper"].map(id => ({ id, observed: 40, ratio: 0.8 })),
    } },
  }} />);
  expect(screen.getByText("Ready to review")).toBeInTheDocument();
  expect(screen.queryByText(/another overlapping pass/i)).not.toBeInTheDocument();
});

test("old motion rejections do not mask current capture progress", () => {
  render(<CaptureProgress stats={{ coverage: 30, fusionKeyframes: 8,
    captureDiagnostics: { attempts: 40, decisions: { "moving-too-fast": 16 },
      recent: Array.from({ length: 40 }, (_, index) => ({ reason: index < 16 ? "moving-too-fast" : "connected" })) },
    captureFeedback: { code: "scanning" },
    adaptiveCapture: { connected: true, pendingCount: 0, coverage: {
      regions: [{ id: "middle", observed: 100, ratio: .8 }],
    } },
  }} />);
  expect(screen.getByText("Ready to review")).toBeInTheDocument();
  expect(screen.queryByText(/many attempted views were rejected/i)).not.toBeInTheDocument();
});

test("progress reports a stall without duplicating the primary instruction", () => {
  render(<CaptureProgress stats={{ fusionKeyframes: 4, currentViewChecked: false,
    captureStall: { stalled: true, code: "stalled-overlap",
      hint: "Turn back until part of the last captured area is visible, then continue slowly." },
    adaptiveCapture: { state: "checking", connected: true, coverage: { ratio: .6 } },
  }} />);
  expect(screen.getByText("No new view saved")).toBeInTheDocument();
  expect(screen.queryByText(/turn back until part of the last captured area/i)).not.toBeInTheDocument();
  expect(screen.queryByText("Checking new view")).not.toBeInTheDocument();
});

test("passive progress does not call a narrow baseline ready or add competing guidance", () => {
  render(<CaptureProgress stats={{ fusionKeyframes: 8, cameraBaseline: .12,
    adaptiveCapture: { connected: true, coverage: {
      regions: [{ id: "middle", observed: 100, ratio: .8 }],
    } },
  }} />);
  expect(screen.getByText("Capture saved")).toBeInTheDocument();
  expect(screen.queryByText(/sideways step/i)).not.toBeInTheDocument();
  expect(screen.queryByText("Ready to review")).not.toBeInTheDocument();
});

test("a depth outage replaces overlap guidance and explains the retained-view count", () => {
  render(<CaptureProgress stats={{ fusionKeyframes: 60, fusionKeyframeLimit: 60,
    depthRecoveryState: "stalled", currentViewChecked: false,
    captureDiagnostics: { committedFrames: 72 },
    adaptiveCapture: { state: "checking", connected: true, coverage: {
      regions: [{ id: "middle", observed: 100, ratio: .3 }],
    } },
  }} />);
  expect(screen.getByText("Saved views")).toBeInTheDocument();
  expect(screen.getByText("Depth stopped")).toBeInTheDocument();
  expect(screen.getByText("72")).toBeInTheDocument();
  expect(screen.getByText(/60 views kept for review/i)).toBeInTheDocument();
  expect(screen.queryByText(/Review your saved scan now/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/another overlapping pass/i)).not.toBeInTheDocument();
});

test("a true view-capacity stop is distinguished from a retained count of 60", () => {
  render(<CaptureProgress stats={{ fusionKeyframes: 60, fusionKeyframeLimit: 60,
    adaptiveCapture: { connected: true, capacityReached: true, coverage: {
      regions: [{ id: "middle", observed: 100, ratio: .3 }],
    } },
  }} />);
  expect(screen.getByText("Section captured")).toBeInTheDocument();
  expect(screen.queryByText(/reached its safe view capacity/i)).not.toBeInTheDocument();
});

test("failed review offers both another pass and an explicit partial save", () => {
  const continueScan = jest.fn(), save = jest.fn();
  render(<CaptureAuditNotice audit={{ issues: ["Upper surfaces need another overlapping pass."] }} onContinue={continueScan} onSave={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Keep scanning" }));
  expect(continueScan).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Save partial scan" }));
  expect(save).toHaveBeenCalledTimes(1);
});
