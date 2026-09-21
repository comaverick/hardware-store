import api from "./api";
import { SESSION_EXPIRED_EVENT } from "./authSession";

jest.mock("axios", () => {
  const client = jest.fn();
  client.interceptors = {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  };
  return { create: () => client };
});

const onRequest = api.interceptors.request.use.mock.calls[0][0];
const onError = api.interceptors.response.use.mock.calls[0][1];
let expired;

const requestError = (status, overrides = {}) => ({
  config: {
    url: "/sales",
    method: "post",
    headers: { Authorization: "Bearer current-token" },
    ...overrides,
  },
  ...(status ? { response: { status, data: { message: "Request failed" } } } : {}),
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("token", "current-token");
  localStorage.setItem("user", JSON.stringify({ id: "staff-1" }));
  expired = jest.fn();
  window.addEventListener(SESSION_EXPIRED_EVENT, expired);
});

afterEach(() => {
  window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  jest.useRealTimers();
});

test("an authenticated 401 clears the saved session and notifies the app once", async () => {
  const errors = [requestError(401), requestError(401)];
  await Promise.all(errors.map((error) => expect(onError(error)).rejects.toBe(error)));

  expect(localStorage.getItem("token")).toBeNull();
  expect(localStorage.getItem("user")).toBeNull();
  expect(expired).toHaveBeenCalledTimes(1);
});

test("a late 401 cannot invalidate a newer login", async () => {
  localStorage.setItem("token", "new-token");
  const error = requestError(401);
  await expect(onError(error)).rejects.toBe(error);

  expect(localStorage.getItem("token")).toBe("new-token");
  expect(expired).not.toHaveBeenCalled();
});

test("incorrect login credentials do not trigger session expiry", async () => {
  const error = requestError(401, { url: "/auth/login" });
  await expect(onError(error)).rejects.toBe(error);

  expect(localStorage.getItem("token")).toBe("current-token");
  expect(expired).not.toHaveBeenCalled();
  expect(error.userMessage).toBe("Request failed");
});

test.each([403, 500, 503, null])(
  "keeps the session when a request fails with %s (null means no network response)",
  async (status) => {
    const error = requestError(status);
    await expect(onError(error)).rejects.toBe(error);

    expect(localStorage.getItem("token")).toBe("current-token");
    expect(localStorage.getItem("user")).not.toBeNull();
    expect(expired).not.toHaveBeenCalled();
  },
);

test("still retries a failed read without signing the user out", async () => {
  jest.useFakeTimers();
  const response = { data: [] };
  api.mockResolvedValue(response);
  const pending = onError(requestError(503, { method: "get" }));
  jest.advanceTimersByTime(500);

  await expect(pending).resolves.toBe(response);
  expect(api).toHaveBeenCalledTimes(1);
  expect(expired).not.toHaveBeenCalled();
  expect(localStorage.getItem("token")).toBe("current-token");
});

test("attaches the token to API requests but not public login requests", () => {
  const protectedRequest = onRequest({ url: "/inventory", headers: {} });
  const loginRequest = onRequest({ url: "/auth/login", headers: {} });

  expect(protectedRequest.headers.Authorization).toBe("Bearer current-token");
  expect(loginRequest.headers.Authorization).toBeUndefined();
});
