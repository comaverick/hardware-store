import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ShoppingCart, Trash, X } from "@phosphor-icons/react";
import { useReservationCart } from "./reservationCart";
import { formatPrice, products } from "../storefrontCatalog";
import "./cart.css";

export default function CartDrawer() {
  const { open, draft, close, clear, changeQuantity } = useReservationCart();
  const dialog = useRef(null);
  const { pathname } = useLocation();
  const storefront = !pathname.startsWith("/scanspace");
  const items = Array.isArray(draft?.items) ? draft.items : [];

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal?.();
    if (!open && dialog.current?.open) dialog.current?.close?.();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={`customer-cart${storefront ? " customer-cart--storefront" : ""}`}
      onCancel={close}
      onClose={close}
      aria-label="Reservation cart"
    >
      {storefront ? (
        <div className="customer-cart__shell">
          <header className="customer-cart__header">
            <div>
              <span>Your items</span>
              <h2>Reservation cart</h2>
            </div>
            <button type="button" onClick={close} aria-label="Close cart">
              <X size={21} />
            </button>
          </header>

          {items.length ? (
            <>
              <div className="customer-cart__body">
                <div className="customer-cart__notice">
                  <strong>Draft only. Items are not reserved yet.</strong>
                  <span>Confirm stock and prices with your branch before pickup.</span>
                </div>
                <ul className="customer-cart__items">
                  {items.map((item) => {
                    const product = products.find((entry) => entry.id === item.productId);
                    return (
                      <li key={item.productId}>
                        <div className="customer-cart__thumbnail">
                          {product ? (
                            <img src={product.image} alt="" />
                          ) : (
                            <ShoppingCart size={25} aria-hidden="true" />
                          )}
                        </div>
                        <div className="customer-cart__item-copy">
                          <strong>{item.name}</strong>
                          <b>{formatPrice(item.total)}</b>
                          <div className="customer-cart__quantity">
                            <button
                              type="button"
                              onClick={() => changeQuantity(item.productId, item.quantity - 1)}
                              aria-label={`Decrease quantity of ${item.name}`}
                            >
                              −
                            </button>
                            <span aria-label={`Quantity ${item.quantity}`}>{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => changeQuantity(item.productId, item.quantity + 1)}
                              aria-label={`Increase quantity of ${item.name}`}
                            >
                              +
                            </button>
                          </div>
                        </div>
                        <button
                          className="customer-cart__remove"
                          type="button"
                          onClick={() => changeQuantity(item.productId, 0)}
                          aria-label={`Remove ${item.name}`}
                        >
                          <Trash size={18} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button className="customer-cart__clear" type="button" onClick={clear}>
                  Clear cart
                </button>
              </div>
              <footer className="customer-cart__footer">
                <div>
                  <span>Estimated total</span>
                  <strong>{formatPrice(draft.total)}</strong>
                </div>
                <button type="button" onClick={close}>
                  Continue shopping
                </button>
              </footer>
            </>
          ) : (
            <div className="customer-cart__empty">
              <ShoppingCart size={38} aria-hidden="true" />
              <h3>Your cart is empty</h3>
              <p>Browse products and add the supplies you need.</p>
              <button type="button" onClick={close}>Continue shopping</button>
            </div>
          )}
        </div>
      ) : (
        <>
          <header>
            <h2>Reservation cart</h2>
            <button onClick={close} aria-label="Close cart">×</button>
          </header>
          {!draft ? (
            <p>Your cart is empty.</p>
          ) : (
            <>
              <p>
                This is a saved cart draft. No stock is reserved until your
                reservation is confirmed.
              </p>
              <ul>
                {items.map((item) => (
                  <li key={item.productId}>
                    <span>
                      {item.name}
                      <small>{item.quantity} × {formatPrice(item.unitPrice)}</small>
                    </span>
                    <strong>{formatPrice(item.total)}</strong>
                  </li>
                ))}
              </ul>
              <footer>
                <strong>Estimated total</strong>
                <strong>{formatPrice(draft.total)}</strong>
              </footer>
              <p className="cart-note">
                Customer checkout is not connected in this build. Recheck branch
                prices and stock when reserving.
              </p>
              <button onClick={clear}>Clear draft</button>
            </>
          )}
        </>
      )}
    </dialog>
  );
}
