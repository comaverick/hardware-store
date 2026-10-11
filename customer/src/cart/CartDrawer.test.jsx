import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import CartDrawer from "./CartDrawer";
import { useReservationCart } from "./reservationCart";
import { CustomerAuthProvider } from "../auth/CustomerAuthContext";
import { reserveCart, fetchReservations, cancelReservation } from "./reservationApi";

jest.mock("./reservationApi");
const branchId = "a".repeat(24), secondBranch = "f".repeat(24), productId = "b".repeat(24);
const user = { uid: "customer-one", emailVerified: true, displayName: "Alex Customer", email: "alex@example.com" };
const catalog = { branches: [{ _id: branchId, name: "Main branch", code: "MAIN", address: "12 Main St" }, { _id: secondBranch, name: "North branch", code: "NORTH" }],
  products: [{ _id: productId, name: "Hammer", unit: "piece", sellingPrice: 25, availableQuantity: 5 }] };
const receipt = () => ({ id: "reservation-1", reservationNumber: "RES-WEB-123", status: "ACTIVE", branch: { id: branchId, name: "Main branch", address: "12 Main St" },
  customerName: "Alex Customer", expiresAt: new Date(Date.now() + 7200000).toISOString(), total: 50,
  items: [{ productId, name: "Hammer", unit: "piece", quantity: 2, unitPrice: 25, total: 50 }] });
function renderCart(account = user, path = "/products") {
  let listener;
  const services = { watchUser: (next) => { listener = next; next(account); return () => {}; }, emit: (next) => listener(next),
    signInEmail: async () => { services.emit(user); return { user }; } };
  const result = render(<MemoryRouter initialEntries={[path]}><CustomerAuthProvider services={services}
    loadProfile={async (activeUser) => ({ id: "customer-1", name: activeUser.displayName, email: activeUser.email, emailVerified: activeUser.emailVerified })}><App /><CartDrawer /></CustomerAuthProvider></MemoryRouter>);
  return { ...result, services };
}
function addHammer(quantity = 2) {
  useReservationCart.getState().addItem({ id: productId, name: "Hammer", price: 99 }, quantity);
  useReservationCart.getState().setBranchId(branchId);
}

beforeEach(() => {
  localStorage.clear();
  useReservationCart.setState({ draft: null, open: false, branchId: "" });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ products: [], branches: [] }) });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  document.body.style.overflow = "auto";
});

test("the cart uses current branch prices and submits one authenticated reservation", async () => {
  addHammer();
  global.fetch.mockResolvedValue({ ok: true, json: async () => catalog });
  reserveCart.mockResolvedValue(receipt());
  renderCart();
  expect(await screen.findByText("5 available at this branch")).toBeInTheDocument();
  const dialog = screen.getByRole("dialog", { name: "Reservation cart" });
  expect(within(dialog).getByText("12 Main St")).toBeInTheDocument();
  expect(within(dialog).getAllByText("₱50.00")).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole("button", { name: "Reserve at this branch" }));
  expect(await screen.findByRole("heading", { name: "Your items are reserved" })).toBeInTheDocument();
  expect(reserveCart).toHaveBeenCalledWith(user, { branch: branchId, customerName: "Alex Customer", customerPhone: "", items: [{ product: productId, quantity: 2, unitPrice: 25 }] }, expect.any(String), expect.any(AbortSignal));
  expect(useReservationCart.getState().draft).toBeNull();
  expect(screen.getByText("RES-WEB-123")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close cart" }));
  act(() => useReservationCart.getState().addItem({ id: productId, name: "Hammer", price: 25 }));
  await screen.findByText("5 available at this branch");
  expect(screen.queryByRole("heading", { name: "Your items are reserved" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reserve at this branch" })).toBeInTheDocument();
});

test("switching the pickup branch blocks reservation when its stock is short", async () => {
  addHammer(3);
  global.fetch.mockImplementation(async (url) => ({ ok: true, json: async () => ({ ...catalog, products: [{ ...catalog.products[0], availableQuantity: String(url).includes(secondBranch) ? 1 : 5 }] }) }));
  renderCart();
  await screen.findByText("5 available at this branch");
  fireEvent.change(screen.getByLabelText("Choose pickup branch"), { target: { value: secondBranch } });
  expect(await screen.findByText("Only 1 available. Reduce quantity.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check branch stock" })).toBeDisabled();
  expect(useReservationCart.getState().branchId).toBe(secondBranch);
  expect(reserveCart).not.toHaveBeenCalled();
});

test("sign-in returns to the saved cart with its chosen branch", async () => {
  addHammer();
  global.fetch.mockResolvedValue({ ok: true, json: async () => catalog });
  renderCart(null);
  await screen.findByText("5 available at this branch");
  fireEvent.click(screen.getByRole("button", { name: "Sign in to reserve" }));
  expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
  expect(useReservationCart.getState().draft.items[0].quantity).toBe(2);
  expect(useReservationCart.getState().branchId).toBe(branchId);
  expect(useReservationCart.getState().open).toBe(false);
  expect(reserveCart).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "alex@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in", exact: true }));
  expect(await screen.findByRole("dialog", { name: "Reservation cart" })).toBeInTheDocument();
  await screen.findByText("5 available at this branch");
  expect(screen.getByRole("button", { name: "Reserve at this branch" })).toBeEnabled();
  expect(screen.getByLabelText("Choose pickup branch")).toHaveValue(branchId);
});

test("unverified customers must verify their email before reserving", async () => {
  addHammer();
  global.fetch.mockResolvedValue({ ok: true, json: async () => catalog });
  renderCart({ ...user, emailVerified: false });
  await screen.findByText("5 available at this branch");
  expect(screen.getByRole("button", { name: "Verify email to reserve" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reserve at this branch" })).not.toBeInTheDocument();
});

test("a lost confirmation retries the original request even if the held units now appear unavailable", async () => {
  addHammer();
  let stock = 5;
  global.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ ...catalog, products: [{ ...catalog.products[0], availableQuantity: stock }] }) }));
  reserveCart.mockRejectedValueOnce(new TypeError("Network connection lost")).mockResolvedValueOnce(receipt());
  renderCart();
  await screen.findByText("5 available at this branch");
  fireEvent.click(screen.getByRole("button", { name: "Reserve at this branch" }));
  await screen.findByRole("alert");
  stock = 0;
  fireEvent.click(screen.getByRole("button", { name: "Refresh stock" }));
  await screen.findByText("Out of stock at this branch");
  expect(screen.getByRole("button", { name: "Retry reservation safely" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry reservation safely" }));
  await screen.findByRole("heading", { name: "Your items are reserved" });
  expect(reserveCart.mock.calls[1][2]).toBe(reserveCart.mock.calls[0][2]);
  expect(reserveCart.mock.calls[1][1]).toEqual(reserveCart.mock.calls[0][1]);
});

test("a stock conflict retains the cart and refreshes availability", async () => {
  addHammer();
  global.fetch.mockResolvedValue({ ok: true, json: async () => catalog });
  reserveCart.mockRejectedValue(Object.assign(new Error("Not enough stock of Hammer."), { status: 409 }));
  renderCart();
  await screen.findByText("5 available at this branch");
  fireEvent.click(screen.getByRole("button", { name: "Reserve at this branch" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Not enough stock");
  expect(useReservationCart.getState().draft.items).toHaveLength(1);
  expect(useReservationCart.getState().draft.reservationRequest).toBeUndefined();
  await waitFor(() => expect(screen.getByRole("button", { name: "Reserve at this branch" })).toBeEnabled());
});

test("customers can review reservations and explicitly cancel their hold", async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => catalog });
  fetchReservations.mockResolvedValue([receipt()]);
  cancelReservation.mockResolvedValue({ ...receipt(), status: "CANCELLED" });
  renderCart(user, "/account/reservations");
  expect(await screen.findByText("RES-WEB-123")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation", exact: true }));
  expect(cancelReservation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect(await screen.findByText("Cancelled", { exact: true })).toBeInTheDocument();
  expect(cancelReservation).toHaveBeenCalledWith(user, "reservation-1", expect.any(AbortSignal));
  await act(async () => {});
});

test("an old cancellation response cannot appear after switching customer accounts", async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => catalog });
  fetchReservations.mockResolvedValueOnce([receipt()]).mockResolvedValueOnce([]);
  let finishCancel;
  cancelReservation.mockImplementation(() => new Promise((resolve) => { finishCancel = resolve; }));
  const { services } = renderCart(user, "/account/reservations");
  await screen.findByText("RES-WEB-123");
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  await act(async () => services.emit({ ...user, uid: "customer-two" }));
  await screen.findByRole("heading", { name: "No reservations yet" });
  await act(async () => finishCancel({ ...receipt(), status: "CANCELLED" }));
  expect(screen.queryByText("RES-WEB-123")).not.toBeInTheDocument();
  expect(screen.queryByText(/Reservation cancelled\. The stock/)).not.toBeInTheDocument();
});
afterEach(() => { document.body.style.overflow = ""; });

test("Continue shopping opens Products and restores background scrolling", async () => {
  render(<MemoryRouter initialEntries={["/"]}><App /><CartDrawer /></MemoryRouter>);
  const banner = screen.getByRole("banner");
  fireEvent.click(within(banner).getByRole("button", { name: "Reservation cart, 0 items" }));
  const cart = screen.getByRole("dialog", { name: "Reservation cart" });
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.click(within(cart).getByRole("button", { name: "Continue shopping" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeInTheDocument();
  expect(cart).not.toHaveAttribute("open");
  expect(document.body.style.overflow).toBe("auto");
  expect(useReservationCart.getState().open).toBe(false);
});
