import { API_ORIGIN } from "../storefrontCatalog";

async function request(user, path, options = {}) {
  const token = await user.getIdToken();
  const response = await fetch(`${API_ORIGIN}/api/customer-reservations${path}`, {
    ...options, cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Reservations are unavailable. Please try again.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export async function reserveCart(user, cart, key, signal) {
  const data = await request(user, "", { method: "POST", body: JSON.stringify(cart), headers: { "Idempotency-Key": key }, signal });
  if (!data.reservation?.id || !data.reservation?.items?.length) throw new Error("Reservation confirmation could not load. Try again to recover it.");
  return data.reservation;
}
export async function fetchReservations(user, signal) {
  const data = await request(user, "", { signal });
  if (!Array.isArray(data.reservations)) throw new Error("Your reservations could not load.");
  return data.reservations;
}
export async function cancelReservation(user, id, signal) {
  const data = await request(user, `/${encodeURIComponent(id)}/cancel`, { method: "POST", signal });
  if (!data.reservation?.id) throw new Error("Cancellation could not be confirmed. Refresh your reservations.");
  return data.reservation;
}
