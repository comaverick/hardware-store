import { fireEvent, render, screen } from "@testing-library/react";
import RoomCustomizationPanel from "./RoomCustomizationPanel";

test("finish choices stay separate from applying and shopping", () => {
  const onApply = jest.fn();
  const { container } = render(<RoomCustomizationPanel availability={{ walls: 1, floor: 1, ceiling: 1 }} onApply={onApply} />);
  expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Walls", "Flooring"]);
  expect(container.querySelector('input[type="color"]')).toBeNull();
  expect(screen.queryByText("Custom color")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sage", exact: true }));
  fireEvent.change(screen.getByLabelText("Paint finish"), { target: { value: "Satin" } });
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply to room" }));
  expect(onApply).toHaveBeenCalledWith("walls", { color: "#a0afa4", finish: "Satin" });
});

test("a missing editable surface cannot apply its finish", () => {
  const onApply = jest.fn();
  render(<RoomCustomizationPanel availability={{ walls: 1, floor: 0, ceiling: 1 }} onApply={onApply} />);
  fireEvent.click(screen.getByRole("tab", { name: "Flooring" }));
  fireEvent.click(screen.getByRole("button", { name: /Soft stone/ }));
  const apply = screen.getByRole("button", { name: "Apply to room" });
  expect(apply).toBeDisabled();
  fireEvent.click(apply);
  expect(onApply).not.toHaveBeenCalled();
});

test("reset clears the design and restores the initial selections", () => {
  const onReset = jest.fn();
  render(<RoomCustomizationPanel customization={{ version: 1, walls: { color: "#a0afa4", finish: "Satin" } }}
    availability={{ walls: 1 }} onApply={jest.fn()} onReset={onReset} />);
  expect(screen.getByRole("button", { name: "Sage", exact: true })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Reset finish selections" }));
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Warm white", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Paint finish")).toHaveValue("Matte");
});
