import { acceptScanSpaceCart, useReservationCart } from "./reservationCart";

const product = { id: "b".repeat(24), name: "Claw hammer", price: 445, image: "https://example.com/hammer.jpg" };

beforeEach(() => {
  localStorage.clear();
  useReservationCart.setState({ draft: null, open: false });
});

test("storefront items update the saved cart total and quantity", () => {
  const cart = useReservationCart.getState();
  cart.addItem(product);
  cart.addItem(product);
  expect(useReservationCart.getState().draft).toMatchObject({
    total: 890,
    items: [{ productId: product.id, quantity: 2, total: 890, image: product.image }],
  });

  cart.changeQuantity(product.id, 0);
  expect(useReservationCart.getState().draft).toBeNull();
  expect(localStorage.getItem("customer:reservation-cart")).toBeNull();
});

test("storefront items support custom quantity when adding to cart", () => {
  const cart = useReservationCart.getState();
  cart.addItem(product, 3);
  expect(useReservationCart.getState().draft).toMatchObject({
    total: 1335,
    items: [{ productId: product.id, quantity: 3, total: 1335 }],
  });
  cart.addItem(product, 2);
  expect(useReservationCart.getState().draft).toMatchObject({
    total: 2225,
    items: [{ productId: product.id, quantity: 5, total: 2225 }],
  });
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
