import { fireEvent, render, screen } from "@testing-library/react";
import { CaptureAuditNotice, CaptureCoverage } from "./CaptureFeedback";

test("coverage distinguishes unseen space from observed surface confirmation", () => {
  render(<CaptureCoverage coverage={{ regions: [
    { id: "lower", observed: 0, ratio: 0 },
    { id: "middle", observed: 100, ratio: 0.7 },
    { id: "upper", observed: 40, ratio: 0.2 },
  ] }} />);
  expect(screen.getByText("Not seen")).toBeInTheDocument();
  expect(screen.getByText("70% confirmed")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Upper surfaces confirmed" })).toHaveAttribute("value", "20");
});

test("failed review offers both another pass and an explicit partial save", () => {
  const continueScan = jest.fn(), save = jest.fn();
  render(<CaptureAuditNotice audit={{ issues: ["Upper surfaces need another overlapping pass."] }} onContinue={continueScan} onSave={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Keep scanning" }));
  expect(continueScan).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Save partial scan" }));
  expect(save).toHaveBeenCalledTimes(1);
});
