import { MapPin } from "@phosphor-icons/react";
import { formatPrice } from "../storefrontCatalog";
import "./reservations.css";

export const isHeld = (reservation) => ["ACTIVE", "READY_FOR_PICKUP"].includes(reservation.status) && new Date(reservation.expiresAt) > new Date();
export const pickupDeadline = (date) => new Date(date).toLocaleString("en-PH", {
  timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});

export default function ReservationReceipt({ reservation, children }) {
  const status = ["ACTIVE", "READY_FOR_PICKUP"].includes(reservation.status) && !isHeld(reservation) ? "EXPIRED" : reservation.status;
  const labels = { ACTIVE: "Stock reserved", READY_FOR_PICKUP: "Ready for pickup", COMPLETED: "Picked up", CANCELLED: "Cancelled", EXPIRED: "Expired" };
  return <article className="reservation-receipt" aria-label={`Reservation ${reservation.reservationNumber}`}>
    <div className="reservation-receipt__top"><span className={`reservation-receipt__status${isHeld(reservation) ? " reservation-receipt__status--held" : ""}`}>{labels[status] || status}</span><span>Pay at pickup</span></div>
    <h3>{reservation.reservationNumber}</h3>
    <div className="reservation-receipt__branch"><MapPin size={21} aria-hidden="true" /><div><strong>{reservation.branch.name}</strong>{reservation.branch.address && <p>{reservation.branch.address}</p>}{reservation.branch.phone && <p>{reservation.branch.phone}</p>}</div></div>
    <dl className="reservation-receipt__details"><div><dt>Pickup name</dt><dd>{reservation.customerName}</dd></div>
      <div><dt>Pickup deadline</dt><dd>{pickupDeadline(reservation.expiresAt)} <small>Philippine time</small></dd></div></dl>
    <ul className="reservation-receipt__items">{reservation.items.map((item) => <li key={item.productId}><span>{item.name}<small>{item.quantity} × {formatPrice(item.unitPrice)} / {item.unit || "unit"}</small></span><strong>{formatPrice(item.total)}</strong></li>)}</ul>
    <div className="reservation-receipt__total"><span>Estimated total</span><strong>{formatPrice(reservation.total)}</strong></div>
    {children}
  </article>;
}
