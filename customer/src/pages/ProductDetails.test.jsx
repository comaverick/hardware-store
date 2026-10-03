import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "../App";
import ProductDetails from "./ProductDetails";
import { useReservationCart } from "../cart/reservationCart";

const branchId = "a".repeat(24);
const hammerId = "b".repeat(24);
const paintId = "c".repeat(24);

const catalog = {
  branches: [
    { _id: branchId, name: "Main branch", code: "MAIN" },
  ],
  products: [
    {
      _id: hammerId,
      name: "Steel Claw Hammer",
      sku: "HAM-1",
      category: "Hand Tools",
      brand: "Acme",
      description: "Forged steel head with ergonomic fiberglass shock-absorbing grip.",
      sellingPrice: 445,
      unit: "piece",
      image: "",
      availableQuantity: null,
    },
    {
      _id: paintId,
      name: "Interior Paint",
      sku: "PNT-1",
      category: "Paint",
      brand: "ColorPro",
      description: "Premium low-odor washable interior latex paint.",
      sellingPrice: 1280,
      unit: "liter",
      image: "",
      availableQuantity: null,
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  useReservationCart.setState({ draft: null, open: false });
  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (url.includes(`/api/storefront/products/${hammerId}`)) {
      return {
        ok: true,
        json: async () => ({
          branches: catalog.branches,
          product: {
            ...catalog.products[0],
            availableQuantity: url.includes(`?branch=${branchId}`) ? 7 : null,
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => catalog,
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("product cards on catalog page are clickable and link to product details", async () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>
  );

  const hammerHeading = await screen.findByRole("heading", { name: "Steel Claw Hammer" });
  const productLink = hammerHeading.closest("a");
  expect(productLink).toBeInTheDocument();
  expect(productLink).toHaveAttribute("href", `/products/${hammerId}`);
});

test("clicking a product navigates to the product detail page with description and details", async () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>
  );

  const hammerHeading = await screen.findByRole("heading", { name: "Steel Claw Hammer" });
  const productLink = hammerHeading.closest("a");
  fireEvent.click(productLink);

  // Verifies navigation to PDP
  expect(await screen.findByRole("heading", { level: 1, name: "Steel Claw Hammer" })).toBeInTheDocument();
  expect(screen.getByText("SKU: HAM-1")).toBeInTheDocument();
  expect(screen.getByText(/Forged steel head with ergonomic fiberglass shock-absorbing grip/i)).toBeInTheDocument();
  expect(screen.getByText(/Taxes included\. Reserve online/i)).toBeInTheDocument();
  const mainAddBtn = screen.getAllByRole("button", { name: /add to cart/i })[0];
  expect(mainAddBtn).toBeInTheDocument();
  expect(mainAddBtn).toHaveClass("pdp-add-btn");
});

test("product detail page supports branch selection, quantity adjustment, and adding to cart", async () => {
  render(
    <MemoryRouter initialEntries={[`/products/${hammerId}`]}>
      <App />
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { level: 1, name: "Steel Claw Hammer" })).toBeInTheDocument();

  // Check branch selection and stock display
  const branchSelect = screen.getByLabelText(/branch stock & pickup/i);
  fireEvent.change(branchSelect, { target: { value: branchId } });

  expect(await screen.findByText(/7 available at Main branch/i)).toBeInTheDocument();

  // Test quantity adjustment: increment to 3
  const increaseBtn = screen.getByRole("button", { name: /increase quantity/i });
  fireEvent.click(increaseBtn);
  fireEvent.click(increaseBtn);

  const quantityInput = screen.getByLabelText(/quantity for steel claw hammer/i);
  expect(quantityInput).toHaveValue(3);

  // Add to cart with quantity 3
  const addToCartBtn = screen.getByRole("button", { name: /add 3 to cart/i });
  fireEvent.click(addToCartBtn);

  // Verify reservation cart state
  expect(useReservationCart.getState().draft).toMatchObject({
    total: 1335,
    items: [
      {
        productId: hammerId,
        quantity: 3,
        unitPrice: 445,
        total: 1335,
      },
    ],
  });
  expect(useReservationCart.getState().open).toBe(true);
});

test("product detail page disables add to cart when branch is out of stock", async () => {
  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (url.includes(`/api/storefront/products/${hammerId}`)) {
      return {
        ok: true,
        json: async () => ({
          branches: catalog.branches,
          product: {
            ...catalog.products[0],
            availableQuantity: 0,
          },
        }),
      };
    }
    return { ok: true, json: async () => catalog };
  });

  render(
    <MemoryRouter initialEntries={[`/products/${hammerId}`]}>
      <App />
    </MemoryRouter>
  );

  await screen.findByRole("heading", { level: 1, name: "Steel Claw Hammer" });

  const branchSelect = screen.getByLabelText(/branch stock & pickup/i);
  fireEvent.change(branchSelect, { target: { value: branchId } });

  expect(await screen.findByText(/Out of stock at Main branch/i)).toBeInTheDocument();
  const addBtn = screen.getByRole("button", { name: /out of stock at this branch/i });
  expect(addBtn).toBeDisabled();
});
