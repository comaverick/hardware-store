import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle, MapPin, ShoppingCart, Trash, X } from "@phosphor-icons/react";
import { useReservationCart } from "./reservationCart";
import { fetchStorefrontCatalog, formatPrice, productImageUrl } from "../storefrontCatalog";
import { useStoreAppearance } from "../storefront/AppearancePicker";
import { CustomerAuthBoundary, useCustomerAuth } from "../auth/CustomerAuthContext";
import { reserveCart } from "./reservationApi";
import ReservationReceipt, { isHeld } from "./ReservationReceipt";
import "../storefront/theme.css";
import "./cart.css";

function CartContent() {
  const { open, draft, branchId, setBranchId, show, close, clear, changeQuantity, saveRequest, completeReservation } = useReservationCart();
  const { session, customer, initializing, profileLoading, sessionError, refreshSession } = useCustomerAuth();
  const dialog = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const appearance = useStoreAppearance((state) => state.appearance);
  const [catalog, setCatalog] = useState({ branches: [], products: [], branchId: null });
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [retry, setRetry] = useState(0);
  const [pickupName, setPickupName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const pending = useRef(null);
  const accountUid = useRef(null);
  const items = Array.isArray(draft?.items) ? draft.items : [];
  const selectedBranch = catalog.branches.find((branch) => branch._id === branchId);
  const checked = !loading && !catalogError && catalog.branchId === branchId;
  const products = new Map(catalog.products.map((product) => [product._id, product]));
  const lines = items.map((item) => {
    const product = checked ? products.get(item.productId) : null;
    const unitPrice = Number(product?.sellingPrice ?? item.unitPrice);
    const available = branchId && checked ? product?.availableQuantity ?? 0 : null;
    const issue = checked && branchId && (!product || item.quantity > available);
    return { ...item, product, unitPrice, available, issue, total: Number((unitPrice * item.quantity).toFixed(2)) };
  });
  const total = lines.reduce((sum, item) => sum + item.total, 0);
  const requestToRecover = draft?.reservationRequest?.uid === session?.user.uid && draft?.reservationRequest?.body ? draft.reservationRequest : null;
  const editingDisabled = busy || Boolean(requestToRecover);
  const canReserve = checked && selectedBranch && lines.length > 0 && lines.length <= 50 && lines.every((item) => !item.issue && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 9999);

  function closeCart() { setConfirmation(null); close(); }
  function continueShopping() { closeCart(); navigate("/products"); }
  function viewReservations() { closeCart(); navigate("/account/reservations"); }
  function signIn() { closeCart(); navigate(session ? "/verify-email" : "/login", { state: { from: "/products?cart=reservation" } }); }

  useEffect(() => {
    if (new URLSearchParams(location.search).get("cart") === "reservation") show();
  }, [location.pathname, location.search, show]);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal?.();
    if (!open && dialog.current?.open) dialog.current?.close?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => {
    if (accountUid.current !== (session?.user.uid || null)) {
      accountUid.current = session?.user.uid || null;
      setConfirmation(null);
      setPickupName(session?.name || "");
      setPhone("");
      setError("");
    }
    if (customer?.name) setPickupName((current) => current || customer.name);
  }, [session?.user.uid, session?.name, customer?.name]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setCatalogError("");
    fetchStorefrontCatalog(branchId, controller.signal)
      .then((data) => { if (active) setCatalog({ ...data, branchId }); })
      .catch(() => { if (active) setCatalogError("Branch stock could not load. Refresh to try again."); })
      .finally(() => { window.clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [open, branchId, retry]);

  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event) {
    event.preventDefault();
    if (pending.current || (!canReserve && !requestToRecover) || !session?.emailVerified || !customer) return;
    setError("");
    setBusy(true);
    const controller = new AbortController();
    pending.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 20000);
    const body = requestToRecover?.body || { branch: branchId, customerName: pickupName.trim(), customerPhone: phone.trim(),
      items: lines.map((item) => ({ product: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })) };
    const fingerprint = JSON.stringify({ uid: session.user.uid, ...body });
    const saved = draft.reservationRequest;
    const key = saved?.fingerprint === fingerprint ? saved.key : window.crypto?.randomUUID?.() || `reserve_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const submittedItems = requestToRecover?.items || items;
    saveRequest({ key, fingerprint, body, items: submittedItems, uid: session.user.uid });
    const uid = session.user.uid;
    try {
      const reservation = await reserveCart(session.user, body, key, controller.signal);
      completeReservation(submittedItems);
      if (accountUid.current === uid) setConfirmation(reservation);
    } catch (failure) {
      if (accountUid.current === uid) {
        setError(failure.name === "AbortError"
          ? "Confirmation is taking longer than expected. Retry this same cart to recover your reservation safely, or check Your reservations."
          : failure.message || "Your reservation could not be confirmed. Please try again.");
        if ([400, 404, 409].includes(failure.status)) {
          saveRequest(null);
          setRetry((value) => value + 1);
        }
        if (failure.code === "EMAIL_NOT_VERIFIED") signIn();
      }
    } finally {
      window.clearTimeout(timer);
      pending.current = null;
      setBusy(false);
    }
  }

  const authenticationRequired = !session || !session.emailVerified;
  return <dialog ref={dialog} className="customer-cart customer-cart--storefront" data-theme={appearance}
    onCancel={closeCart} onClose={closeCart} aria-label="Reservation cart">
    <div className="customer-cart__shell">
      <header className="customer-cart__header"><div><span>Branch pickup</span><h2>Reservation cart</h2></div>
        <button type="button" onClick={closeCart} aria-label="Close cart"><X size={21} /></button></header>
      {confirmation ? <>
        <div className="customer-cart__body customer-cart__confirmation" role="status">
          <CheckCircle size={42} weight="fill" aria-hidden="true" /><h2>{isHeld(confirmation) ? "Your items are reserved" : "Reservation recovered"}</h2>
          <p>{isHeld(confirmation) ? "Show this reference at your branch before the deadline. Follow preparation updates in Your reservations." : "Your saved reservation and its current status are shown below."}</p>
          <ReservationReceipt reservation={confirmation} />
          <p>Stock is held for two hours. Pay at pickup; final prices are checked at the cashier.</p>
        </div>
        <footer className="customer-cart__footer"><button type="button" onClick={viewReservations}>Your reservations</button>
          <button className="customer-cart__secondary" type="button" onClick={() => { setConfirmation(null); continueShopping(); }}>Continue shopping</button></footer>
      </> : items.length ? <form className="customer-cart__form" onSubmit={submit}>
        <div className="customer-cart__body">
          <section className="customer-cart__pickup" aria-labelledby="cart-pickup-title"><h3 id="cart-pickup-title"><MapPin size={19} aria-hidden="true" /> Pickup branch</h3>
            <label className="sr-only" htmlFor="cart-branch">Choose pickup branch</label>
            <select id="cart-branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setError(""); }} disabled={editingDisabled} required>
              <option value="">Choose a branch</option>{catalog.branches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name} ({branch.code})</option>)}
            </select>
            {selectedBranch?.address && <p>{selectedBranch.address}</p>}{selectedBranch?.phone && <p>{selectedBranch.phone}</p>}
            <small>Available stock will be held at this branch for two hours after you reserve.</small>
          </section>
          <div className="customer-cart__stock-heading"><h3>Your items <span>({items.length})</span></h3><button type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading || busy}>Refresh stock</button></div>
          {loading && <p className="customer-cart__message" role="status">Checking current prices and branch stock…</p>}
          {catalogError && <p className="customer-cart__error" role="alert">{catalogError}</p>}
          {requestToRecover && !busy && <p className="customer-cart__message" role="status">A previous reservation needs confirmation. Retry it safely before changing these items, or check Your reservations.</p>}
          {items.length > 50 && <p className="customer-cart__error" role="alert">Reserve up to 50 different products at a time.</p>}
          <ul className="customer-cart__items">{lines.map((item) => <li key={item.productId}>
            <div className="customer-cart__thumbnail">{item.product?.image || item.image ? <img src={productImageUrl(item.product?.image || item.image)} alt="" /> : <ShoppingCart size={25} aria-hidden="true" />}</div>
            <div className="customer-cart__item-copy"><strong>{item.product?.name || item.name}</strong>
              <small>{formatPrice(item.unitPrice)} / {item.product?.unit || "unit"}</small><b>{formatPrice(item.total)}</b>
              {item.available !== null && <small className={item.issue ? "customer-cart__stock customer-cart__stock--issue" : "customer-cart__stock"}>
                {!item.product ? "No longer available" : item.available === 0 ? "Out of stock at this branch" : item.issue ? `Only ${item.available} available. Reduce quantity.` : `${item.available} available at this branch`}</small>}
              <div className="customer-cart__quantity"><button type="button" onClick={() => changeQuantity(item.productId, item.quantity - 1)} aria-label={`Decrease quantity of ${item.name}`} disabled={editingDisabled}>−</button>
                <input type="number" min="1" max="9999" step="1" value={item.quantity} aria-label={`Quantity of ${item.name}`} disabled={editingDisabled}
                  onChange={(event) => { const quantity = Number(event.target.value); if (Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 9999) changeQuantity(item.productId, quantity); }} />
                <button type="button" onClick={() => changeQuantity(item.productId, item.quantity + 1)} aria-label={`Increase quantity of ${item.name}`} disabled={editingDisabled || item.quantity >= 9999 || (item.available !== null && item.quantity >= item.available)}>+</button>
              </div>
            </div><button className="customer-cart__remove" type="button" onClick={() => changeQuantity(item.productId, 0)} aria-label={`Remove ${item.name}`} disabled={editingDisabled}><Trash size={18} /></button>
          </li>)}</ul>
          <button className="customer-cart__clear" type="button" onClick={clear} disabled={editingDisabled}>Clear cart</button>
          {authenticationRequired ? <div className="customer-cart__notice"><strong>{session ? "Verify your email to reserve" : "Sign in to reserve your items"}</strong><span>Your cart and selected branch will be waiting when you return.</span></div> : <section className="customer-cart__contact" aria-labelledby="cart-contact-title">
            <h3 id="cart-contact-title">Pickup details</h3><label htmlFor="cart-name">Pickup name</label><input id="cart-name" value={pickupName} onChange={(event) => setPickupName(event.target.value)} required maxLength={100} autoComplete="name" disabled={editingDisabled} />
            <label htmlFor="cart-phone">Contact number <span>(optional)</span></label><input id="cart-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} autoComplete="tel" disabled={editingDisabled} />
            <small>Reservation saved to {session.email}.</small>
          </section>}
          {sessionError && <p className="customer-cart__error" role="alert">{sessionError} <button type="button" onClick={refreshSession}>Reload account</button></p>}
          {session?.emailVerified && <button className="customer-cart__clear" type="button" onClick={viewReservations} disabled={busy}>Your reservations</button>}
        </div>
        <footer className="customer-cart__footer"><div><span>Estimated total</span><strong>{formatPrice(total)}</strong></div>
          <small>Pay at pickup. Final prices are checked at the cashier.</small>
          {error && <p className="customer-cart__error" role="alert">{error}</p>}
          {authenticationRequired ? <button type="button" onClick={signIn} disabled={initializing}>{initializing ? "Checking account…" : session ? "Verify email to reserve" : "Sign in to reserve"}</button>
            : <button type="submit" disabled={busy || initializing || profileLoading || !customer || (!requestToRecover && (!canReserve || !pickupName.trim()))}>{busy ? "Reserving your items…" : profileLoading ? "Loading account…" : requestToRecover ? "Retry reservation safely" : loading ? "Checking stock…" : !branchId ? "Choose a pickup branch" : !canReserve ? "Check branch stock" : "Reserve at this branch"}</button>}
          <button className="customer-cart__secondary" type="button" onClick={continueShopping} disabled={busy}>Continue shopping</button>
        </footer>
      </form> : <div className="customer-cart__empty"><ShoppingCart size={38} aria-hidden="true" /><h3>Your cart is empty</h3><p>Browse products and add the supplies you need.</p><button type="button" onClick={continueShopping}>Continue shopping</button>{session?.emailVerified && <button className="customer-cart__secondary" type="button" onClick={viewReservations}>Your reservations</button>}</div>}
    </div>
  </dialog>;
}

export default function CartDrawer() {
  return <CustomerAuthBoundary><CartContent /></CustomerAuthBoundary>;
}
