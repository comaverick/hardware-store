import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { useReservationCart } from "./cart/reservationCart";

const branchId = "a".repeat(24);
const hammerId = "b".repeat(24);
const paintId = "c".repeat(24);
const catalog = {
  branches: [{ _id: branchId, name: "Main branch", code: "MAIN" }],
  products: [
    { _id: hammerId, name: "Steel Claw Hammer", sku: "HAM-1", category: "Hand Tools", brand: "", description: "For carpentry", sellingPrice: 445, unit: "piece", image: "", availableQuantity: null },
    { _id: paintId, name: "Interior Paint", sku: "PNT-1", category: "Paint", brand: "", description: "White wall paint", sellingPrice: 1280, unit: "liter", image: "", availableQuantity: null },
  ],
};

beforeEach(() => {
  localStorage.clear();
  useReservationCart.setState({ draft: null, open: false });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => catalog });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("renders the customer storefront heading and loads database products", async () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /everything for your next project/i })).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: /see your space before you build/i }).closest("a"),
  ).toHaveAttribute("href", "/scanspace");
  expect(await screen.findByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
  expect(within(screen.getByRole("navigation", { name: "Shop categories" })).getByRole("link", { name: "Hand Tools" })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/storefront/catalog"), expect.any(Object));
});

test("search narrows the database products", async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "Steel Claw Hammer" });
  fireEvent.change(screen.getByRole("searchbox", { name: /search products/i }), {
    target: { value: "hammer" },
  });
  expect(screen.getByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Interior Paint" })).not.toBeInTheDocument();
});

test("a database product can be saved to the reservation draft", async () => {
  render(<App />);
  const hammerCard = (await screen.findByRole("heading", { name: "Steel Claw Hammer" })).closest("article");
  fireEvent.click(within(hammerCard).getByRole("button", { name: "Add to cart" }));
  expect(useReservationCart.getState().draft).toMatchObject({
    total: 445,
    items: [{ productId: hammerId, quantity: 1, unitPrice: 445 }],
  });
});

test("selected branch stock comes from the API and out of stock products cannot be added", async () => {
  global.fetch.mockImplementation(async (url) => ({
    ok: true,
    json: async () => url.includes("?branch=")
      ? { ...catalog, products: catalog.products.map((product) => ({ ...product, availableQuantity: product._id === hammerId ? 3 : 0 })) }
      : catalog,
  }));
  render(<App />);
  await screen.findByRole("heading", { name: "Steel Claw Hammer" });
  fireEvent.change(screen.getByLabelText("Check stock at"), { target: { value: branchId } });
  const hammerCard = (await screen.findByRole("heading", { name: "Steel Claw Hammer" })).closest("article");
  const paintCard = screen.getByRole("heading", { name: "Interior Paint" }).closest("article");
  expect(within(hammerCard).getByText("3 available at Main branch")).toBeInTheDocument();
  expect(within(paintCard).getByRole("button", { name: "Out of stock" })).toBeDisabled();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining(`?branch=${branchId}`), expect.any(Object),
  ));
});

test("an API failure shows a retry instead of sample products", async () => {
  global.fetch.mockRejectedValueOnce(new Error("offline"));
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Products are unavailable" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Steel Claw Hammer" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
});
