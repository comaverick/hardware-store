import { create } from "zustand";
function read() {
  try {
    return JSON.parse(
      localStorage.getItem("customer:reservation-cart") || "null",
    );
  } catch {
    return null;
  }
}
export const useReservationCart = create((set) => ({
  draft: read(),
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
  clear: () => {
    localStorage.removeItem("customer:reservation-cart");
    set({ draft: null });
  },
}));
let adapter = null;
// The deployed storefront can register its real cart implementation at startup.
export function registerReservationCartAdapter(handler) {
  adapter = handler;
  return () => {
    adapter = null;
  };
}
export async function acceptScanSpaceCart(validatedDraft) {
  if (!validatedDraft.canAdd || !validatedDraft.items?.length)
    throw new Error("No validated items to add.");
  if (adapter) {
    await adapter({
      branch: validatedDraft.branch,
      items: validatedDraft.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
      source: "scanspace",
    });
    return "Added to your reservation cart.";
  }
  // This checkout has no customer reservation endpoint. Retain one shared, replaceable draft.
  localStorage.setItem(
    "customer:reservation-cart",
    JSON.stringify(validatedDraft),
  );
  useReservationCart.setState({ draft: validatedDraft, open: true });
  window.dispatchEvent(
    new CustomEvent("customer:reservation-cart-changed", {
      detail: { source: "scanspace" },
    }),
  );
  return "Cart prepared. Items are not reserved yet.";
}
