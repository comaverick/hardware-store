import { fireEvent, render, screen } from "@testing-library/react";
import { CaptureAuditNotice, CaptureCoverage, CaptureProgress } from "./CaptureFeedback";

test("coverage distinguishes unseen space from observed surface confirmation", () => {
  render(<CaptureCoverage coverage={{ regions: [
    { id: "lower", observed: 0, ratio: 0 },
    { id: "middle", observed: 100, ratio: 0.7 },
    { id: "upper", observed: 40, ratio: 0.2 },
  ] }} />);
  expect(screen.getByText("Not seen")).toBeInTheDocument();
  expect(screen.getByText("Covered")).toBeInTheDocument();
  expect(screen.getByText("Another pass")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Upper surfaces confirmed" })).toHaveAttribute("value", "20");
});

test("scan progress shows the room sweep, overlap, and the next missing area", () => {
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
  expect(screen.getByText("58%")).toBeInTheDocument();
  expect(screen.getByText("70%")).toBeInTheDocument();
  expect(screen.getByText(/include lower surfaces/i)).toBeInTheDocument();
  expect(screen.getByText("Capture saved")).toBeInTheDocument();
});

test("scan progress only declares readiness after every height and the room sweep are covered", () => {
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
  expect(screen.getByText(/Coverage looks ready/i)).toBeInTheDocument();
});

test("failed review offers both another pass and an explicit partial save", () => {
  const continueScan = jest.fn(), save = jest.fn();
  render(<CaptureAuditNotice audit={{ issues: ["Upper surfaces need another overlapping pass."] }} onContinue={continueScan} onSave={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Keep scanning" }));
  expect(continueScan).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Save partial scan" }));
  expect(save).toHaveBeenCalledTimes(1);
});
