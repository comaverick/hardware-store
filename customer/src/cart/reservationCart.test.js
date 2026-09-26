import { acceptScanSpaceCart, useReservationCart } from "./reservationCart";
import { products } from "../storefrontCatalog";

beforeEach(() => {
  localStorage.clear();
  useReservationCart.setState({ draft: null, open: false });
});

test("storefront items update the saved cart total and quantity", () => {
  const cart = useReservationCart.getState();
  cart.addItem(products[0]);
  cart.addItem(products[0]);
  expect(useReservationCart.getState().draft).toMatchObject({
    total: 6980,
    items: [{ productId: "drill-18v", quantity: 2, total: 6980 }],
  });

  cart.changeQuantity("drill-18v", 0);
  expect(useReservationCart.getState().draft).toBeNull();
  expect(localStorage.getItem("customer:reservation-cart")).toBeNull();
});

test("a validated ScanSpace draft still opens the shared cart", async () => {
  const draft = {
    canAdd: true,
    branch: { id: "branch-1" },
    items: [{ productId: "scanspace-item", name: "Wall paint", quantity: 1, unitPrice: 500, total: 500 }],
    total: 500,
  };
  await expect(acceptScanSpaceCart(draft)).resolves.toBe("Cart prepared. Items are not reserved yet.");
  expect(useReservationCart.getState()).toMatchObject({ draft, open: true });
});
