import { useEffect, useRef } from "react";
import { useReservationCart } from "./reservationCart";
import "./cart.css";
export default function CartDrawer() {
  const { open, draft, close, clear } = useReservationCart(),
    dialog = useRef();
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="customer-cart"
      onCancel={close}
      onClose={close}
    >
      <header>
        <h2>Reservation cart</h2>
        <button onClick={close} aria-label="Close cart">
          ×
        </button>
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
            {draft.items.map((i) => (
              <li key={i.productId}>
                <span>
                  {i.name}
                  <small>
                    {i.quantity} × ₱{i.unitPrice.toLocaleString()}
                  </small>
                </span>
                <strong>₱{i.total.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
          <footer>
            <strong>Estimated total</strong>
            <strong>₱{draft.total.toLocaleString()}</strong>
          </footer>
          <p className="cart-note">
            Customer checkout is not connected in this build. Recheck branch
            prices and stock when reserving.
          </p>
          <button onClick={clear}>Clear draft</button>
        </>
      )}
    </dialog>
  );
}
