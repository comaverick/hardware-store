import { render, screen } from "@testing-library/react";
import ScanRenderProgress from "./ScanRenderProgress";

test("shows the current reconstruction stage and determinate progress", () => {
  render(<ScanRenderProgress stage="meshing" progress={78} />);

  expect(screen.getByText("Building a continuous measured surface.")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "78");
  expect(screen.getByText("Surface").closest("li")).toHaveAttribute(
    "aria-current",
    "step",
  );
});

test("uses an indeterminate progress bar while a scan file is being read", () => {
  render(<ScanRenderProgress progress={undefined} title="Opening your scan" />);

  expect(screen.getByText("Opening your scan")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
});
