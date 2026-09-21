import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

import { AuthProvider, useAuth } from "./AuthContext";
import ProtectedRoute from "../routes/ProtectedRoute";
import {
  expireSession,
  SESSION_EXPIRED_MESSAGE,
} from "../services/authSession";

const staff = { id: "staff-1", name: "Staff member", role: "CASHIER" };
const makeToken = (expiresAt) => {
  const payload = window.btoa(JSON.stringify({ exp: expiresAt / 1000 }));
  return `header.${payload.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}.signature`;
};
const storeSession = (expiresAt = Date.now() + 60000) => {
  const token = makeToken(expiresAt);
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(staff));
  return token;
};

const SessionView = ({ loginPage = false }) => {
  const { user, login, logout, sessionExpired } = useAuth();
  const navigate = useNavigate();
  return (
    <div>
      <h1>{loginPage ? "Sign in" : "Staff workspace"}</h1>
      {user && <p>{user.name}</p>}
      {sessionExpired && <p role="alert">{SESSION_EXPIRED_MESSAGE}</p>}
      <button onClick={logout}>Sign out</button>
      <button onClick={() => {
        login(makeToken(Date.now() + 120000), staff);
        navigate("/dashboard");
      }}>Sign in fixture</button>
    </div>
  );
};

const renderSession = () => render(
  <StrictMode>
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AuthProvider>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute><SessionView /></ProtectedRoute>} />
          <Route path="/login" element={<SessionView loginPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  </StrictMode>,
);

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-21T00:00:00Z"));
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("opens the login page without an expiry warning for a new visitor", () => {
  renderSession();
  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("clears an expired saved session before opening a protected page", () => {
  storeSession(Date.now() - 1000);
  renderSession();

  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByText("Staff workspace")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
  expect(localStorage.getItem("token")).toBeNull();
  expect(localStorage.getItem("user")).toBeNull();
});

test.each(["missing token", "malformed token", "missing expiry", "invalid user"])(
  "recovers from a saved session with %s without crashing",
  (scenario) => {
    storeSession();
    if (scenario === "missing token") localStorage.removeItem("token");
    if (scenario === "malformed token") localStorage.setItem("token", "bad-token");
    if (scenario === "missing expiry") localStorage.setItem("token", "header.e30.signature");
    if (scenario === "invalid user") localStorage.setItem("user", "invalid JSON");
    renderSession();

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  },
);

test("automatically redirects when an open session expires", () => {
  storeSession();
  renderSession();
  expect(screen.getByText("Staff workspace")).toBeInTheDocument();

  act(() => jest.advanceTimersByTime(60000));

  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
});

test.each(["focus", "visibilitychange"])(
  "checks expiry on %s after the computer or tab has been suspended",
  (eventName) => {
    storeSession();
    renderSession();
    jest.setSystemTime(new Date(Date.now() + 120000));

    if (eventName === "visibilitychange") {
      jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      fireEvent(document, new Event(eventName));
    } else {
      fireEvent(window, new Event(eventName));
    }

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(localStorage.getItem("token")).toBeNull();
  },
);

test("redirects when the API expires the current session", () => {
  const token = storeSession();
  renderSession();
  act(() => expireSession(token));

  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(SESSION_EXPIRED_MESSAGE);
});

test("signing in again resets the notice and ignores a late failure from the old session", () => {
  const oldToken = storeSession();
  renderSession();
  act(() => expireSession(oldToken));
  fireEvent.click(screen.getByRole("button", { name: "Sign in fixture" }));
  act(() => expireSession(oldToken));
  act(() => jest.advanceTimersByTime(60000));

  expect(screen.getByText("Staff workspace")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(localStorage.getItem("token")).not.toBe(oldToken);
});

test("follows logout in another tab", () => {
  storeSession();
  renderSession();
  localStorage.clear();
  fireEvent(window, new StorageEvent("storage", { key: null, storageArea: localStorage }));

  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
});

test("manual logout does not display a session-expired notice", () => {
  storeSession();
  renderSession();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
