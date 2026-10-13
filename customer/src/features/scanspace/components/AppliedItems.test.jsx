import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useReservationCart } from "../../../cart/reservationCart";
import { fetchStorefrontCatalog } from "../../../storefrontCatalog";
import { sanitizeScanCustomization } from "../core/scanCustomization";
import AppliedItems from "./AppliedItems";
import RoomCustomizationPanel from "./RoomCustomizationPanel";

jest.mock("../../../storefrontCatalog", () => ({
  ...jest.requireActual("../../../storefrontCatalog"), fetchStorefrontCatalog: jest.fn(),
}));

const paint = (id, color, finish = "Matte") => ({
  _id: id.repeat(24), name: `${color === "#eee8dd" ? "Warm white" : "Sage"} paint · ${finish} · 4 L`,
  image: "/assets/paint.png", unit: "piece", sellingPrice: 980, availableQuantity: 20,
  scanSpace: { enabled: true, materialType: "paint", color, paintFinish: finish, packageVolume: 4 },
});
const products = [paint("a", "#eee8dd"), paint("b", "#a0afa4"), paint("c", "#a0afa4", "Satin"),
  { _id: "d".repeat(24), name: "Natural oak flooring", unit: "box", sellingPrice: 1600, availableQuantity: 20,
    scanSpace: { enabled: true, materialType: "wood", floorFinishId: "oak", coveragePerPack: 2.2 } },
  { _id: "e".repeat(24), name: "Soft stone tile flooring", image: "/assets/stone.png", unit: "box", sellingPrice: 720, availableQuantity: 20,
    scanSpace: { enabled: true, materialType: "tile", floorFinishId: "stone", coveragePerPack: 1.44 } },
];
const paintAndFloor = { version: 1, walls: { color: "#a0afa4", finish: "Satin" }, floor: { finishId: "stone", direction: "crosswise" } };

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  useReservationCart.setState({ draft: null, branchId: "", open: false });
  fetchStorefrontCatalog.mockResolvedValue({ products, branches: [] });
});

function renderItems(customization = paintAndFloor) {
  return render(<MemoryRouter><AppliedItems customization={customization} /></MemoryRouter>);
}

function Design() {
  const [customization, setCustomization] = useState(null);
  return <>
    <RoomCustomizationPanel customization={customization} availability={{ walls: 1, floor: 1, ceiling: 1 }}
      onApply={(kind, selection) => setCustomization(previous => sanitizeScanCustomization({ ...previous, version: 1, [kind]: selection }))}
      onReset={() => setCustomization(null)} />
    <AppliedItems customization={customization} />
  </>;
}

test("only applied finishes enter the list; replacement and reset update it without editing the cart", async () => {
  render(<MemoryRouter><Design /></MemoryRouter>);
  expect(screen.getByText("Apply paint or flooring to your room to build your list.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sage", exact: true }));
  fireEvent.change(screen.getByLabelText("Paint finish"), { target: { value: "Satin" } });
  expect(fetchStorefrontCatalog).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Add all" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply to room" }));
  await screen.findByRole("link", { name: products[2].name });
  fireEvent.change(screen.getByRole("spinbutton", { name: `Quantity for ${products[2].name}` }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Warm white", exact: true }));
  fireEvent.change(screen.getByLabelText("Paint finish"), { target: { value: "Matte" } });
  expect(screen.getByRole("link", { name: products[2].name })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: products[0].name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply to room" }));
  expect(screen.getByRole("link", { name: products[0].name })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: products[2].name })).not.toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: `Quantity for ${products[0].name}` })).toHaveValue(1);
  fireEvent.click(screen.getByRole("button", { name: "Reset finish selections" }));
  expect(screen.getByText("Apply paint or flooring to your room to build your list.")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Applied finishes" })).not.toBeInTheDocument();
  expect(useReservationCart.getState().draft).toBeNull();
});

test("Add selected adds only checked products, with quantities, prices, and images, preserving the cart", async () => {
  useReservationCart.setState({ draft: { items: [{ productId: "f".repeat(24), name: "Hammer", quantity: 1, unitPrice: 445 }],
    pickupDate: "2026-10-12", pickupTime: "14:00" } });
  renderItems();
  await screen.findByRole("link", { name: products[2].name });
  expect(screen.getByRole("img", { name: products[2].name })).toHaveAttribute("src", "http://localhost:5000/assets/paint.png");
  fireEvent.change(screen.getByRole("spinbutton", { name: `Quantity for ${products[2].name}` }), { target: { value: "2" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: `Quantity for ${products[4].name}` }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("checkbox", { name: `Select ${products[4].name}` }));
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  expect(screen.getByText("₱1,960.00")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
  expect(useReservationCart.getState()).toMatchObject({ open: true, draft: {
    total: 2405, pickupDate: "2026-10-12", pickupTime: "14:00", items: [
      expect.objectContaining({ productId: "f".repeat(24), quantity: 1 }),
      expect.objectContaining({ productId: products[2]._id, quantity: 2, unitPrice: 980, image: "http://localhost:5000/assets/paint.png" }),
    ],
  } });
});

test("Add all includes unchecked items and ignores saved ceiling paint", async () => {
  renderItems({ ...paintAndFloor, ceiling: { ...paintAndFloor.walls } });
  await screen.findByRole("link", { name: products[2].name });
  expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
  expect(screen.getByText("Walls · 4 L can")).toBeInTheDocument();
  expect(screen.queryByText(/Ceiling/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: `Quantity for ${products[2].name}` }), { target: { value: "3" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: `Quantity for ${products[4].name}` }), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("checkbox", { name: `Select ${products[4].name}` }));
  fireEvent.click(screen.getByRole("button", { name: "Add all" }));
  expect(useReservationCart.getState().draft).toMatchObject({ total: 5820, items: [
    expect.objectContaining({ productId: products[2]._id, quantity: 3 }),
    expect.objectContaining({ productId: products[4]._id, quantity: 4 }),
  ] });
});

test("invalid quantities block the entire group and units already in the cart count toward branch stock", async () => {
  useReservationCart.setState({ branchId: "branch-one", draft: {
    items: [{ productId: products[2]._id, name: products[2].name, quantity: 19, unitPrice: 980 }],
  } });
  renderItems();
  await screen.findByRole("link", { name: products[2].name });
  const quantity = screen.getByRole("spinbutton", { name: `Quantity for ${products[2].name}` });
  expect(quantity).toHaveAttribute("max", "1");
  for (const value of ["", "0", "1.5", "2"]) {
    fireEvent.change(quantity, { target: { value } });
    expect(screen.getByRole("button", { name: "Add all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add selected" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));
    expect(useReservationCart.getState().draft.items).toHaveLength(1);
  }
  fireEvent.click(screen.getByRole("checkbox", { name: `Select ${products[2].name}` }));
  expect(screen.getByRole("button", { name: "Add selected" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Add all" })).toBeDisabled();
  fireEvent.change(quantity, { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Add all" }));
  expect(useReservationCart.getState().draft.items).toEqual([
    expect.objectContaining({ productId: products[2]._id, quantity: 20 }),
    expect.objectContaining({ productId: products[4]._id, quantity: 1 }),
  ]);
  expect(screen.getByText("All available units are already in your cart.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add all" })).toBeDisabled();
});

test("branch changes disable stale stock; available items can be selected without an out-of-stock finish", async () => {
  useReservationCart.setState({ branchId: "branch-one" });
  renderItems();
  await screen.findByRole("link", { name: products[2].name });
  let resolve;
  fetchStorefrontCatalog.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => useReservationCart.getState().setBranchId("branch-two"));
  expect(screen.getByRole("button", { name: "Add all" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add selected" })).toBeDisabled();
  await act(async () => resolve({ products: products.map(product => ({ ...product,
    availableQuantity: product._id === products[2]._id ? 0 : 4 })), branches: [] }));
  expect(screen.getByText("Out of stock at your pickup branch.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add all" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: `Select ${products[2].name}` }));
  expect(screen.getByRole("button", { name: "Add selected" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
  expect(useReservationCart.getState().draft.items).toEqual([
    expect.objectContaining({ productId: products[4]._id, quantity: 1 }),
  ]);
  expect(fetchStorefrontCatalog).toHaveBeenLastCalledWith("branch-two", expect.any(AbortSignal));
});

test("a failed catalog can be retried before shopping", async () => {
  fetchStorefrontCatalog.mockRejectedValueOnce(new Error("Offline"));
  renderItems();
  await screen.findByText("Store products could not load.");
  expect(screen.getByRole("button", { name: "Add all" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("link", { name: products[2].name });
  expect(screen.getByRole("button", { name: "Add all" })).toBeEnabled();
});

test("sample products and different paint finishes cannot substitute for an applied finish", async () => {
  fetchStorefrontCatalog.mockResolvedValue({ branches: [], products: [
    { ...products[0], _id: "sample-warm-white" },
    { ...products[0], scanSpace: { ...products[0].scanSpace, paintFinish: "Satin" } }, products[4],
  ] });
  renderItems({ ...paintAndFloor, walls: { color: "#eee8dd", finish: "Matte" } });
  await screen.findByText("This finish is not available in the store.");
  expect(screen.getByRole("checkbox", { name: "Select Warm white paint · Matte" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add all" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add selected" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Add selected" }));
  expect(useReservationCart.getState().draft.items).toEqual([
    expect.objectContaining({ productId: products[4]._id, quantity: 1 }),
  ]);
});
