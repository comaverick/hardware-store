import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";
import { useReservationCart } from "./cart/reservationCart";

beforeEach(() => {
  localStorage.clear();
  useReservationCart.setState({ draft: null, open: false });
});

test("renders the customer storefront heading", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /everything for your next project/i })).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: /see your space before you build/i }).closest("a"),
  ).toHaveAttribute("href", "/scanspace");
});

test("search narrows the sample products", () => {
  render(<App />);
  fireEvent.change(screen.getByRole("searchbox", { name: /search products/i }), {
    target: { value: "hammer" },
  });
  expect(screen.getByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "18V Cordless Drill Set" })).not.toBeInTheDocument();
});

test("a product can be saved to the reservation draft", () => {
  render(<App />);
  const drillCard = screen.getByRole("heading", { name: "18V Cordless Drill Set" }).closest("article");
  fireEvent.click(within(drillCard).getByRole("button", { name: "Add to cart" }));
  expect(useReservationCart.getState().draft).toMatchObject({
    total: 3490,
    items: [{ productId: "drill-18v", quantity: 1 }],
  });
});
