import { useEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";

import AppLayout from "./AppLayout";

// Exercise the layout's state changes without loading unrelated UI widgets.
jest.mock("antd", () => ({
  Layout: ({ children, className }) => <div className={className}>{children}</div>,
}));
jest.mock("../Sidebar/Sidebar", () => ({ expanded, setExpanded }) => (
  <button onClick={() => setExpanded((current) => !current)}>
    {expanded ? "Collapse navigation" : "Expand navigation"}
  </button>
));
jest.mock("../Topbar/Topbar", () => ({
  onMenuClick, branchOptions, selectedBranch, onBranchChange,
}) => (
  <>
    <button onClick={onMenuClick}>Open mobile navigation</button>
    <select
      aria-label="Branch"
      value={selectedBranch}
      onChange={(event) => onBranchChange(event.target.value)}
    >
      <option value="ALL">All branches</option>
      {branchOptions.map((branch) => (
        <option key={branch._id} value={branch._id}>{branch.name}</option>
      ))}
    </select>
  </>
));

const branches = [{ _id: "branch-1", name: "Branch 1" }];

function CheckoutWorkspace({ branchScope, onBranchOptionsChange, onRender }) {
  const [quantity, setQuantity] = useState(0);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  onRender();

  useEffect(() => {
    onBranchOptionsChange(branches);
  }, [onBranchOptionsChange]);

  return (
    <>
      <input aria-label="Search products" value={search} onChange={(event) => setSearch(event.target.value)} />
      <button onClick={() => setQuantity((current) => current + 1)}>Add product</button>
      <output aria-label="Cart quantity">{quantity}</output>
      <output aria-label="Selected branch">{branchScope.selectedBranch}</output>
      <button onClick={() => setSearchParams({ reservation: "RES-001" })}>Load reservation link</button>
      <output aria-label="Reservation link">{searchParams.get("reservation") || "None"}</output>
    </>
  );
}

function renderWorkspace(onRender = jest.fn()) {
  const result = render(
    <MemoryRouter initialEntries={["/pos"]}>
      <AppLayout><CheckoutWorkspace onRender={onRender} /></AppLayout>
    </MemoryRouter>,
  );
  return { ...result, onRender };
}

test("desktop sidebar changes do not rerender checkout or reset its search and cart", () => {
  jest.useFakeTimers();
  try {
    const { onRender } = renderWorkspace();
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "paint" } });
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    const rendersBeforeNavigation = onRender.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(document.querySelector(".app-content")).toHaveClass("app-content-expanded");
    act(() => jest.advanceTimersByTime(300));
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    act(() => jest.advanceTimersByTime(300));

    expect(document.querySelector(".app-content")).toHaveClass("app-content-collapsed");
    expect(onRender).toHaveBeenCalledTimes(rendersBeforeNavigation);
    expect(screen.getByLabelText("Search products")).toHaveValue("paint");
    expect(screen.getByLabelText("Cart quantity")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    expect(screen.getByLabelText("Cart quantity")).toHaveTextContent("2");
  } finally {
    jest.useRealTimers();
  }
});

test("mobile navigation and its close controls leave checkout alone and restore scrolling", () => {
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "auto";
  try {
    const { onRender } = renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    const rendersBeforeNavigation = onRender.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Open mobile navigation" }));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).toBe("auto");

    fireEvent.click(screen.getByRole("button", { name: "Open mobile navigation" }));
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(document.body.style.overflow).toBe("auto");
    expect(onRender).toHaveBeenCalledTimes(rendersBeforeNavigation);
    expect(screen.getByLabelText("Cart quantity")).toHaveTextContent("1");
  } finally {
    document.body.style.overflow = previousOverflow;
  }
});

test("branch changes still reach the page without remounting its local state", () => {
  renderWorkspace();
  expect(screen.getByRole("option", { name: "Branch 1" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add product" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Branch" }), { target: { value: "branch-1" } });

  expect(screen.getByLabelText("Selected branch")).toHaveTextContent("branch-1");
  expect(screen.getByLabelText("Cart quantity")).toHaveTextContent("1");
});

test("route updates still reach checkout after sidebar interaction", () => {
  renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
  fireEvent.click(screen.getByRole("button", { name: "Load reservation link" }));

  expect(screen.getByLabelText("Reservation link")).toHaveTextContent("RES-001");
  expect(document.querySelector(".app-layout")).toHaveClass("app-layout-pos");
});
