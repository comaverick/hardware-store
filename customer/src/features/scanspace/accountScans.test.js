import { deleteAccountScan, listAccountScans, openAccountScan, saveAccountScan, updateAccountScan } from "./accountScans";

jest.mock("../../storefrontCatalog", () => ({ API_ORIGIN: "http://localhost:5000" }));
const user = { getIdToken: jest.fn(async () => "firebase-test-token") };
const response = data => ({ status: 200, ok: true, json: async () => data });
beforeEach(() => { jest.clearAllMocks(); user.getIdToken.mockResolvedValue("firebase-test-token"); global.fetch = jest.fn(); });
afterEach(() => { delete global.fetch; });

test("uploads the original as multipart with Firebase authorization and a stable retry key", async () => {
  fetch.mockResolvedValue(response({ scan: { id: "saved" } }));
  const file = new Blob(['{"format":"scanspace-scan"}'], { type: "application/json" });
  const metadata = { kind: "scan", name: "Living room", customization: { floor: { finish: "oak" } } };
  const controller = new AbortController();
  await expect(saveAccountScan(user, file, metadata, "same-original-key", controller.signal)).resolves.toEqual({ id: "saved" });
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("http://localhost:5000/api/customer-scans");
  expect(options.method).toBe("POST");
  expect(options.headers).toEqual({ Authorization: "Bearer firebase-test-token", "Idempotency-Key": "same-original-key" });
  expect(options.signal).toBe(controller.signal);
  expect(options.cache).toBe("no-store");
  expect(options.headers["Content-Type"]).toBeUndefined();
  expect(options.body.get("file").size).toBe(file.size);
  expect(options.body.get("file").type).toBe(file.type);
  expect(JSON.parse(options.body.get("metadata"))).toEqual(metadata);
});

test("opens account metadata and the exact original blob through protected endpoints", async () => {
  const file = new Blob(["original bytes"]);
  fetch.mockImplementation(async url => url.endsWith("/file") ? { status: 200, ok: true, blob: async () => file } : response({ scan: { id: "room/id", revision: 3 } }));
  await expect(openAccountScan(user, "room/id")).resolves.toEqual({ scan: { id: "room/id", revision: 3 }, file });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["http://localhost:5000/api/customer-scans/room%2Fid", "http://localhost:5000/api/customer-scans/room%2Fid/file"]);
  fetch.mock.calls.forEach(([, options]) => expect(options.headers).toEqual({ Authorization: "Bearer firebase-test-token" }));
});

test("updates only design metadata with its revision and supports an empty delete response", async () => {
  fetch.mockResolvedValueOnce(response({ scan: { revision: 5 } })).mockResolvedValueOnce({ status: 204, ok: true });
  await expect(updateAccountScan(user, { id: "saved", revision: 4 }, { name: "Bedroom" })).resolves.toEqual({ revision: 5 });
  const options = fetch.mock.calls[0][1];
  expect(options.method).toBe("PATCH");
  expect(options.headers["Content-Type"]).toBe("application/json");
  expect(JSON.parse(options.body)).toEqual({ name: "Bedroom", revision: 4 });
  await expect(deleteAccountScan(user, "saved")).resolves.toBeNull();
  expect(fetch.mock.calls[1][1].method).toBe("DELETE");
});

test("keeps authorization errors useful and rejects a malformed account list", async () => {
  fetch.mockResolvedValueOnce({ status: 403, ok: false, json: async () => ({ message: "Verify your email", code: "EMAIL_UNVERIFIED" }) }).mockResolvedValueOnce(response({ scans: {} }));
  await expect(listAccountScans(user)).rejects.toMatchObject({ status: 403, code: "EMAIL_UNVERIFIED", message: "Verify your email" });
  await expect(listAccountScans(user)).rejects.toThrow("could not load");
});

test("signed-out and cancelled requests never reach the network", async () => {
  await expect(listAccountScans(null)).rejects.toThrow("Sign in");
  const controller = new AbortController(); controller.abort();
  await expect(listAccountScans(user, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});
