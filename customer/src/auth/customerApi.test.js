import { fetchCustomerProfile } from "./customerApi";

test("the API receives a fresh Firebase ID token as a bearer credential", async () => {
  const customer = { id: "customer-1", email: "alex@example.com" };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ customer }) });
  const user = { uid: "firebase-uid", getIdToken: jest.fn().mockResolvedValue("fresh-id-token") };
  const signal = new AbortController().signal;
  expect(await fetchCustomerProfile(user, signal)).toEqual(customer);
  expect(user.getIdToken).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/customer-auth\/me$/), {
    headers: { Authorization: "Bearer fresh-id-token" }, cache: "no-store", signal,
  });
});

test("server status codes remain available to distinguish expiry from an outage", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: "Try again later" }) });
  await expect(fetchCustomerProfile({ getIdToken: async () => "token" })).rejects.toMatchObject({
    status: 503, message: "Try again later",
  });
});
