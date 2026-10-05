import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import CartDrawer from "./CartDrawer";
import { useReservationCart } from "./reservationCart";

beforeEach(() => {
  useReservationCart.setState({ draft: null, open: false });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ products: [], branches: [] }) });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  document.body.style.overflow = "auto";
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
