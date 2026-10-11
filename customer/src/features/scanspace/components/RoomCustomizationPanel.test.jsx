import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useReservationCart } from "../../../cart/reservationCart";
import { fetchStorefrontCatalog } from "../../../storefrontCatalog";
import RoomCustomizationPanel from "./RoomCustomizationPanel";

jest.mock("../../../storefrontCatalog", () => ({
  ...jest.requireActual("../../../storefrontCatalog"), fetchStorefrontCatalog: jest.fn(),
}));

const paint = (id, color, finish = "Matte") => ({
  _id: id.repeat(24), name: `${color === "#eee8dd" ? "Warm white" : "Sage"} paint · ${finish} · 4 L`,
  unit: "piece", sellingPrice: 980, availableQuantity: 20,
  scanSpace: { enabled: true, materialType: "paint", color, paintFinish: finish, packageVolume: 4 },
});
const products = [paint("a", "#eee8dd"), paint("b", "#a0afa4"), paint("c", "#a0afa4", "Satin"),
  { _id: "d".repeat(24), name: "Natural oak flooring", unit: "box", sellingPrice: 1600, availableQuantity: 20,
    scanSpace: { enabled: true, materialType: "wood", floorFinishId: "oak", coveragePerPack: 2.2 } },
  { _id: "e".repeat(24), name: "Soft stone tile flooring", unit: "box", sellingPrice: 720, availableQuantity: 20,
    scanSpace: { enabled: true, materialType: "tile", floorFinishId: "stone", coveragePerPack: 1.44 } },
];

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  useReservationCart.setState({ draft: null, branchId: "", open: false });
  fetchStorefrontCatalog.mockResolvedValue({ products, branches: [] });
});

function panel(availability = { walls: 1, floor: 1, ceiling: 1 }) {
  return render(<MemoryRouter><RoomCustomizationPanel availability={availability} onApply={jest.fn()} /></MemoryRouter>);
}

test("the selected paint color and finish add the matching store product and quantity", async () => {
  const { container } = panel();
  expect(container.querySelector('input[type="color"]')).toBeNull();
  expect(screen.queryByText("Custom color")).not.toBeInTheDocument();
  await screen.findByRole("link", { name: "4 L can · Product details" });
  fireEvent.click(screen.getByRole("button", { name: "Sage", exact: true }));
  fireEvent.change(screen.getByLabelText("Paint finish"), { target: { value: "Satin" } });
  await waitFor(() => expect(screen.getByRole("link", { name: "4 L can · Product details" }))
    .toHaveAttribute("href", `/products/${"c".repeat(24)}`));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
  expect(useReservationCart.getState().open).toBe(true);
  expect(useReservationCart.getState().draft.items).toEqual([expect.objectContaining({
    productId: "c".repeat(24), name: "Sage paint · Satin · 4 L", quantity: 2, unitPrice: 980,
  })]);
});

test("flooring can be purchased without an editable floor, preserving paint already in the cart", async () => {
  useReservationCart.setState({ draft: { items: [{ productId: "a".repeat(24), name: "Paint", quantity: 1, unitPrice: 980 }] } });
  panel({ walls: 1, floor: 0, ceiling: 1 });
  await screen.findByRole("link", { name: "4 L can · Product details" });
  fireEvent.click(screen.getByRole("tab", { name: "Flooring" }));
  fireEvent.click(screen.getByRole("button", { name: /Soft stone/ }));
  expect(screen.getByRole("button", { name: "Apply to room" })).toBeDisabled();
  await screen.findByRole("link", { name: "1.44 m² / box · Product details" });
  expect(screen.getByText("₱720.00")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
  expect(useReservationCart.getState().draft.items).toEqual([
    expect.objectContaining({ productId: "a".repeat(24), quantity: 1 }),
    expect.objectContaining({ productId: "e".repeat(24), quantity: 3, unitPrice: 720 }),
  ]);
});

test("whole quantities must fit branch stock, including units already in the cart", async () => {
  useReservationCart.setState({ branchId: "f".repeat(24), draft: {
    items: [{ productId: "a".repeat(24), name: "Paint", quantity: 19, unitPrice: 980 }],
  } });
  panel();
  await screen.findByRole("link", { name: "4 L can · Product details" });
  const quantity = screen.getByRole("spinbutton", { name: "Quantity" });
  for (const value of ["0", "1.5", "2"]) {
    fireEvent.change(quantity, { target: { value } });
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  }
  fireEvent.change(quantity, { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
  expect(useReservationCart.getState().draft.items[0].quantity).toBe(20);
  expect(screen.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  expect(screen.getByText("All available units are already in your cart.")).toBeInTheDocument();
});

test("changing branch disables stale stock and rechecks the selected product", async () => {
  useReservationCart.setState({ branchId: "f".repeat(24) });
  panel();
  await screen.findByRole("link", { name: "4 L can · Product details" });
  let resolve;
  fetchStorefrontCatalog.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => useReservationCart.getState().setBranchId("9".repeat(24)));
  expect(screen.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  await act(async () => resolve({ products: products.map(product => ({ ...product, availableQuantity: 0 })), branches: [] }));
  expect(screen.getByRole("button", { name: "Out of stock" })).toBeDisabled();
  expect(fetchStorefrontCatalog).toHaveBeenLastCalledWith("9".repeat(24), expect.any(AbortSignal));
});

test("a failed catalog can be retried before adding products", async () => {
  fetchStorefrontCatalog.mockRejectedValueOnce(new Error("Offline"));
  panel();
  await screen.findByText("Store products could not load.");
  expect(screen.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("link", { name: "4 L can · Product details" });
  expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled();
});

test("sample products and a different paint finish cannot be added as the selected finish", async () => {
  fetchStorefrontCatalog.mockResolvedValue({ branches: [], products: [
    { ...products[0], _id: "sample-warm-white" }, { ...products[0], scanSpace: { ...products[0].scanSpace, paintFinish: "Satin" } },
  ] });
  panel();
  await screen.findByText("Choose a store finish to add it to your cart.");
  expect(screen.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  expect(useReservationCart.getState().draft).toBeNull();
});
