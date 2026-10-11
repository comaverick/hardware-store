import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, ShoppingBag } from "@phosphor-icons/react";
import { useCustomerAuth } from "../auth/CustomerAuthContext";
import { cancelReservation, fetchReservations } from "../cart/reservationApi";
import ReservationReceipt, { isHeld } from "../cart/ReservationReceipt";

export default function ReservationsPage() {
  const { session, customer, initializing, profileLoading, sessionError, refreshSession } = useCustomerAuth();
  const [records, setRecords] = useState([]);
  const [recordsOwner, setRecordsOwner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const pendingCancel = useRef(null);
  const accountUid = useRef(null);
  const visibleRecords = recordsOwner === session?.user.uid ? records : [];

  useEffect(() => {
    if (!session?.emailVerified || !customer) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError("");
    fetchReservations(session.user, controller.signal).then((data) => { if (active) { setRecords(data); setRecordsOwner(session.user.uid); } })
      .catch((failure) => { if (active) setError(failure.name === "AbortError" ? "Reservations took too long to load. Try again." : failure.message); })
      .finally(() => { window.clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [session?.user, session?.emailVerified, customer, retry]);

  useEffect(() => {
    accountUid.current = session?.user.uid || null;
    pendingCancel.current?.abort();
    pendingCancel.current = null;
    setRecords([]); setRecordsOwner(null); setConfirmCancel(null); setMessage(""); setBusy(null);
  }, [session?.user.uid]);

  useEffect(() => () => { accountUid.current = null; pendingCancel.current?.abort(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setRevision((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  if (!initializing && !session) return <Navigate to="/login" replace state={{ from: "/account/reservations" }} />;
  if (session && !session.emailVerified) return <Navigate to="/verify-email" replace state={{ from: "/account/reservations" }} />;

  async function cancel(record) {
    if (pendingCancel.current) return;
    setBusy(record.id); setError(""); setMessage("");
    const controller = new AbortController();
    pendingCancel.current = controller;
    const uid = session.user.uid;
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const updated = await cancelReservation(session.user, record.id, controller.signal);
      if (accountUid.current !== uid) return;
      setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(updated.status === "CANCELLED" ? "Reservation cancelled. The stock has been released." : "This reservation is no longer active.");
      setConfirmCancel(null);
    } catch (failure) { if (accountUid.current === uid) setError(failure.name === "AbortError" ? "Cancellation could not be confirmed. Refresh your reservations." : failure.message); }
    finally { window.clearTimeout(timer); if (pendingCancel.current === controller) { pendingCancel.current = null; setBusy(null); } }
  }

  return <main className="customer-reservations shop-container" data-revision={revision}>
    <Link className="shop-text-button" to="/account"><ArrowLeft size={16} aria-hidden="true" /> Your account</Link>
    <div className="customer-reservations__heading"><div><h1>Your reservations</h1><p>Show your reference at the branch. Collect and pay before your hold expires.</p></div>
      <button className="shop-button shop-button--outline" onClick={() => setRetry((value) => value + 1)} disabled={loading || busy || !customer}>Refresh</button></div>
    {(error || sessionError) && <p className="customer-auth__feedback customer-auth__feedback--error" role="alert">{error || sessionError}</p>}
    {sessionError && <button className="shop-button shop-button--outline" onClick={refreshSession}>Reload account</button>}
    {message && <p className="customer-auth__feedback" role="status">{message}</p>}
    {initializing || profileLoading || (customer && loading) ? <p role="status">Loading your reservations…</p> : visibleRecords.length ? <div className="customer-reservations__list">{visibleRecords.map((record) => <ReservationReceipt key={record.id} reservation={record}>
      {isHeld(record) && <div className="reservation-receipt__actions">{confirmCancel === record.id ? <><p>Cancel this reservation and release all its items?</p><div><button className="shop-button shop-button--outline" disabled={Boolean(busy)} onClick={() => setConfirmCancel(null)}>Keep reservation</button><button className="shop-button shop-button--outline reservation-cancel" disabled={Boolean(busy)} onClick={() => cancel(record)}>{busy === record.id ? "Cancelling…" : "Confirm cancellation"}</button></div></> : <button className="shop-text-button reservation-cancel" disabled={Boolean(busy)} onClick={() => setConfirmCancel(record.id)}>Cancel reservation</button>}</div>}
    </ReservationReceipt>)}</div> : customer && !error && <div className="customer-reservations__empty"><ShoppingBag size={40} aria-hidden="true" /><h2>No reservations yet</h2><p>Choose your supplies and reserve available stock from your cart.</p><Link className="shop-button shop-button--primary" to="/products">Browse products</Link></div>}
    <p className="customer-reservations__note">Scheduled holds expire two hours after your chosen pickup time. Final prices are checked at pickup. Refresh to see preparation updates from your branch.</p>
  </main>;
}
