import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
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
function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}{location.search}</output>;
}
function renderStore(path = "/products") {
  return render(<MemoryRouter initialEntries={[path]}><App /><LocationProbe /></MemoryRouter>);
}
beforeEach(() => {
  localStorage.clear();
  useReservationCart.setState({ draft: null, open: false });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => catalog });
});
afterEach(() => { jest.restoreAllMocks(); });

test("Home introduces the store and categories without showing the product catalog", async () => {
  renderStore("/");
  expect(screen.getByRole("heading", { name: /everything for your next project/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Explore ScanSpace" })).toHaveAttribute("href", "/scanspace");
  expect(await screen.findByRole("link", { name: "Hand Tools" })).toHaveAttribute("href", "/products?category=Hand%20Tools");
  expect(screen.queryByRole("heading", { name: "Steel Claw Hammer" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop products" })).toHaveAttribute("href", "/products");
});

test("Products has its own heading and catalog without the Home hero", async () => {
  renderStore();
  expect(screen.getByRole("heading", { level: 1, name: "Products" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /everything for your next project/i })).not.toBeInTheDocument();
  expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
  expect(within(screen.getByRole("navigation", { name: "Mobile navigation" })).getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
});

test("Shop products navigates from Home to the separate Products page", async () => {
  renderStore("/");
  fireEvent.click(screen.getByRole("link", { name: "Shop products" }));
  expect(await screen.findByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
  expect(screen.getByLabelText("Current location")).toHaveTextContent("/products");
  expect(screen.queryByRole("heading", { name: /everything for your next project/i })).not.toBeInTheDocument();
});

test("a Home category opens matching Products and clearing filters removes the URL filter", async () => {
  renderStore("/");
  fireEvent.click(await screen.findByRole("link", { name: "Paint" }));
  expect(await screen.findByRole("heading", { name: "Interior Paint" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Steel Claw Hammer" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Current location")).toHaveTextContent("/products?category=Paint");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(await screen.findByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
  expect(screen.getByLabelText("Current location")).toHaveTextContent(/^\/products$/);
  expect(screen.getByRole("button", { name: "All products" })).toHaveAttribute("aria-pressed", "true");
});

test("search on Home opens matching results on Products", async () => {
  renderStore("/");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), { target: { value: "hammer" } });
  fireEvent.click(screen.getByRole("button", { name: "Show search results" }));
  expect(await screen.findByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Interior Paint" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Current location")).toHaveTextContent("/products?search=hammer");
});

test("live search and clearing a directly linked search keep the URL and input in sync", async () => {
  renderStore("/products?search=paint");
  await screen.findByRole("heading", { name: "Interior Paint" });
  const search = screen.getByRole("searchbox", { name: "Search products" });
  expect(search).toHaveValue("paint");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(search).toHaveValue("");
  fireEvent.change(search, { target: { value: "hammer" } });
  expect(screen.getByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Interior Paint" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Current location")).toHaveTextContent("/products?search=hammer");
});

test("a database product can be saved to the reservation draft", async () => {
  renderStore();
  const card = (await screen.findByRole("heading", { name: "Steel Claw Hammer" })).closest("article");
  fireEvent.click(within(card).getByRole("button", { name: "Add to cart" }));
  expect(useReservationCart.getState().draft).toMatchObject({ total: 445, items: [{ productId: hammerId, quantity: 1, unitPrice: 445 }] });
});

test("branch stock comes from the API and out of stock products cannot be added", async () => {
  global.fetch.mockImplementation(async (url) => ({ ok: true, json: async () => url.includes("?branch=")
    ? { ...catalog, products: catalog.products.map((product) => ({ ...product, availableQuantity: product._id === hammerId ? 3 : 0 })) } : catalog }));
  renderStore();
  await screen.findByRole("heading", { name: "Steel Claw Hammer" });
  fireEvent.change(screen.getByLabelText("Check stock at"), { target: { value: branchId } });
  const hammerCard = (await screen.findByRole("heading", { name: "Steel Claw Hammer" })).closest("article");
  const paintCard = screen.getByRole("heading", { name: "Interior Paint" }).closest("article");
  expect(within(hammerCard).getByText("3 available at Main branch")).toBeInTheDocument();
  expect(within(paintCard).getByRole("button", { name: "Out of stock" })).toBeDisabled();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(`?branch=${branchId}`), expect.any(Object)));
});

test("an API failure shows a retry instead of sample products", async () => {
  global.fetch.mockRejectedValueOnce(new Error("offline"));
  renderStore();
  expect(await screen.findByRole("heading", { name: "Products are unavailable" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Steel Claw Hammer" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
});

test("an empty search can recover by showing all products", async () => {
  renderStore("/products?search=missing");
  expect(await screen.findByRole("heading", { name: "No products found" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View all products" }));
  expect(await screen.findByRole("heading", { name: "Steel Claw Hammer" })).toBeInTheDocument();
});
