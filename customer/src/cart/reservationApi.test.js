import { cancelReservation, fetchReservations, reserveCart } from "./reservationApi";
const user = { getIdToken: jest.fn() };
beforeEach(() => { user.getIdToken.mockResolvedValue("firebase-token"); global.fetch = jest.fn(); });

test("reservation submission sends the Firebase token and stable retry key", async () => {
  const reservation = { id: "r1", items: [{ productId: "p1" }] };
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ reservation }) });
  const cart = { branch: "branch-1", items: [{ product: "p1", quantity: 2, unitPrice: 25 }] };
  const signal = new AbortController().signal;
  expect(await reserveCart(user, cart, "same-request-key", signal)).toEqual(reservation);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/customer-reservations"), expect.objectContaining({
    method: "POST", body: JSON.stringify(cart), signal, cache: "no-store",
    headers: expect.objectContaining({ Authorization: "Bearer firebase-token", "Idempotency-Key": "same-request-key" }),
  }));
});
test("API failures preserve status and verification code for the cart", async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "Verify your email", code: "EMAIL_NOT_VERIFIED" }) });
  await expect(reserveCart(user, {}, "request-key")).rejects.toMatchObject({ status: 403, code: "EMAIL_NOT_VERIFIED", message: "Verify your email" });
});
test("history and cancellation use the same customer authentication", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ reservations: [] }) });
  expect(await fetchReservations(user)).toEqual([]);
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ reservation: { id: "r1", status: "CANCELLED" } }) });
  expect(await cancelReservation(user, "r1")).toMatchObject({ status: "CANCELLED" });
  expect(global.fetch.mock.calls[1][0]).toContain("/r1/cancel");
  expect(global.fetch.mock.calls[1][1].method).toBe("POST");
});
