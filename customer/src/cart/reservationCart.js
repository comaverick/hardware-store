import { create } from "zustand";

const retiredSampleIds = new Set([
  "drill-18v",
  "steel-claw-hammer",
  "interior-paint-set",
  "screw-anchor-kit",
]);

function read() {
  try {
    const draft = JSON.parse(
      localStorage.getItem("customer:reservation-cart") || "null",
    );
    if (!Array.isArray(draft?.items)) return draft;
    const items = draft.items.filter((item) => !retiredSampleIds.has(item.productId));
    if (items.length === draft.items.length) return draft;
    const updated = items.length ? { ...draft, ...recalculate(items) } : null;
    if (updated) localStorage.setItem("customer:reservation-cart", JSON.stringify(updated));
    else localStorage.removeItem("customer:reservation-cart");
    return updated;
  } catch {
    return null;
  }
}

function saveDraft(draft, source) {
  try {
    if (draft) {
      localStorage.setItem("customer:reservation-cart", JSON.stringify(draft));
    } else {
      localStorage.removeItem("customer:reservation-cart");
    }
  } catch {
    // The in-memory cart still works when browser storage is unavailable.
  }
  useReservationCart.setState({ draft, open: true });
  window.dispatchEvent(
    new CustomEvent("customer:reservation-cart-changed", {
      detail: { source },
    }),
  );
}

function recalculate(items) {
  const updated = items.map((item) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = Number(item.unitPrice) || 0;
    return { ...item, quantity, unitPrice, total: quantity * unitPrice };
  });
  return {
    items: updated,
    total: updated.reduce((sum, item) => sum + item.total, 0),
  };
}

export const useReservationCart = create((set, get) => ({
  draft: read(),
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
  clear: () => saveDraft(null, "storefront"),
  addItem: (product, quantityToAdd = 1) => {
    const qty = Math.max(1, Number(quantityToAdd) || 1);
    const current = get().draft;
    const items = Array.isArray(current?.items) ? [...current.items] : [];
    const index = items.findIndex((item) => item.productId === product.id);
    if (index >= 0) {
      items[index] = {
        ...items[index],
        name: product.name,
        unitPrice: product.price,
        image: product.image || "",
        quantity: Number(items[index].quantity || 0) + qty,
      };
    } else {
      items.push({
        productId: product.id,
        name: product.name,
        quantity: qty,
        unitPrice: product.price,
        image: product.image || "",
        total: product.price * qty,
      });
    }
    saveDraft(
      {
        ...(current || {}),
        ...recalculate(items),
        canAdd: false,
      },
      "storefront",
    );
  },
  changeQuantity: (productId, quantity) => {
    const current = get().draft;
    if (!Array.isArray(current?.items)) return;
    const items = current.items
      .filter((item) => item.productId !== productId || quantity > 0)
      .map((item) =>
        item.productId === productId ? { ...item, quantity } : item,
      );
    saveDraft(
      items.length
        ? { ...current, ...recalculate(items), canAdd: false }
        : null,
      "storefront",
    );
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
  saveDraft(validatedDraft, "scanspace");
  return "Cart prepared. Items are not reserved yet.";
}
