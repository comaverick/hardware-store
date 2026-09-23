import { fireEvent, render, screen } from "@testing-library/react";
import { CaptureAuditNotice, CaptureCoverage, CaptureProgress } from "./CaptureFeedback";

test("coverage distinguishes unseen space from observed surface confirmation", () => {
  render(<CaptureCoverage coverage={{ regions: [
    { id: "lower", observed: 0, ratio: 0 },
    { id: "middle", observed: 100, ratio: 0.7 },
    { id: "upper", observed: 40, ratio: 0.2 },
  ] }} />);
  expect(screen.getByText("Not scanned")).toBeInTheDocument();
  expect(screen.getByText("Covered")).toBeInTheDocument();
  expect(screen.getByText("Another pass")).toBeInTheDocument();
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
  expect(screen.getByText("70%")).toBeInTheDocument();
  expect(screen.getByText("Ready to review")).toBeInTheDocument();
  expect(screen.getByText(/selected area has overlapping views/i)).toBeInTheDocument();
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
  expect(screen.getByText(/selected area has overlapping views/i)).toBeInTheDocument();
});

test("recent fast-motion rejections tell the user to slow down before finishing", () => {
  render(<CaptureProgress stats={{ coverage: 30, fusionKeyframes: 8,
    captureDiagnostics: { attempts: 40, decisions: { "moving-too-fast": 16 },
      recent: Array.from({ length: 40 }, (_, index) => ({ reason: index < 16 ? "moving-too-fast" : "connected" })) },
    adaptiveCapture: { connected: true, pendingCount: 0, coverage: {
      regions: [{ id: "middle", observed: 100, ratio: .8 }],
    } },
  }} />);
  expect(screen.getByText("Capture saved")).toBeInTheDocument();
  expect(screen.getByText(/many attempted views were rejected/i)).toBeInTheDocument();
});

test("a narrow camera baseline prompts a sideways view", () => {
  render(<CaptureProgress stats={{ fusionKeyframes: 8, cameraBaseline: .12,
    adaptiveCapture: { connected: true, coverage: {
      regions: [{ id: "middle", observed: 100, ratio: .8 }],
    } },
  }} />);
  expect(screen.getByText("Capture saved")).toBeInTheDocument();
  expect(screen.getByText(/sideways step/i)).toBeInTheDocument();
});

test("failed review offers both another pass and an explicit partial save", () => {
  const continueScan = jest.fn(), save = jest.fn();
  render(<CaptureAuditNotice audit={{ issues: ["Upper surfaces need another overlapping pass."] }} onContinue={continueScan} onSave={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Keep scanning" }));
  expect(continueScan).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Save partial scan" }));
  expect(save).toHaveBeenCalledTimes(1);
});
