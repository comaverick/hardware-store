import { acceptScanSpaceCart, useReservationCart } from "./reservationCart";

const product = { id: "b".repeat(24), name: "Claw hammer", price: 445, image: "https://example.com/hammer.jpg" };

beforeEach(() => {
  localStorage.clear();
  useReservationCart.setState({ draft: null, open: false, branchId: "" });
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

test("adding a group merges products once, preserving pickup details and the existing cart", () => {
  const cart = useReservationCart.getState();
  const flooring = { id: "c".repeat(24), name: "Oak flooring", price: 1600, image: "/oak.png" };
  cart.addItem(product);
  cart.setBranchId("branch-one");
  cart.setPickupSchedule("2026-10-12", "14:00");
  const listener = jest.fn();
  window.addEventListener("customer:reservation-cart-changed", listener);
  try {
    cart.addItems([{ product, quantity: 2 }, { product: flooring, quantity: 3 }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useReservationCart.getState()).toMatchObject({ open: true, branchId: "branch-one", draft: {
      pickupDate: "2026-10-12", pickupTime: "14:00", total: 6135,
      items: [expect.objectContaining({ productId: product.id, quantity: 3, total: 1335 }),
        expect.objectContaining({ productId: flooring.id, quantity: 3, total: 4800 })],
    } });
    expect(JSON.parse(localStorage.getItem("customer:reservation-cart")))
      .toEqual(useReservationCart.getState().draft);
    cart.addItems([]);
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("customer:reservation-cart-changed", listener);
  }
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
  expect(useReservationCart.getState().branchId).toBe("branch-1");
});

test("reservation completion removes only submitted quantities and retains later additions", () => {
  const cart = useReservationCart.getState();
  cart.addItem(product, 2);
  const submitted = useReservationCart.getState().draft.items.map((item) => ({ ...item }));
  cart.addItem(product, 1);
  cart.completeReservation(submitted);
  expect(useReservationCart.getState().draft.items[0].quantity).toBe(1);
});
