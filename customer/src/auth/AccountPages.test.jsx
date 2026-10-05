import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { CustomerAuthProvider } from "./CustomerAuthContext";
import { safeReturnPath } from "./AccountPages";

const makeUser = (overrides = {}) => ({
  uid: "firebase-customer", displayName: "Alex Customer", email: "alex@example.com",
  emailVerified: true, getIdToken: jest.fn().mockResolvedValue("firebase-id-token"), ...overrides,
});

function makeServices(initialUser = null) {
  let listener;
  const services = {
    watchUser: jest.fn((next) => { listener = next; next(initialUser); return () => {}; }),
    emit(user) { listener(user); },
    signInEmail: jest.fn(async () => { const user = makeUser(); services.emit(user); return { user }; }),
    registerEmail: jest.fn(async () => { const user = makeUser({ emailVerified: false }); services.emit(user); return { user, profileSaved: true, verificationSent: true }; }),
    signInGoogle: jest.fn(async () => { const user = makeUser(); services.emit(user); return { user }; }),
    signOut: jest.fn(async () => services.emit(null)),
    resetPassword: jest.fn().mockResolvedValue(undefined),
    sendVerification: jest.fn().mockResolvedValue(undefined),
    refreshUser: jest.fn(async (user) => user),
  };
  return services;
}

const profileFor = (user) => ({ id: "customer-1", name: user.displayName, email: user.email, emailVerified: user.emailVerified });

function renderAccount(path, services = makeServices(), loadProfile = jest.fn(async (user) => profileFor(user))) {
  render(<MemoryRouter initialEntries={[path]}>
    <CustomerAuthProvider services={services} loadProfile={loadProfile}><App /></CustomerAuthProvider>
  </MemoryRouter>);
  return { services, loadProfile };
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ products: [], branches: [] }) });
});

test("email sign-in uses the remember choice and opens the customer account", async () => {
  const { services } = renderAccount("/login");
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "alex@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-password" } });
  fireEvent.click(screen.getByLabelText("Remember me"));
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
  expect(services.signInEmail).toHaveBeenCalledWith("alex@example.com", "a-long-password", true);
  expect(await screen.findByRole("heading", { name: "Alex Customer" })).toBeInTheDocument();
});

test("Google sign-in works with a session-only default", async () => {
  const { services } = renderAccount("/login");
  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
  expect(services.signInGoogle).toHaveBeenCalledWith(false);
});

test("password visibility changes without submitting sign-in", async () => {
  const { services } = renderAccount("/login");
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  expect(services.signInEmail).not.toHaveBeenCalled();
  await act(async () => {});
});

test("registration checks password confirmation before creating an account", async () => {
  const { services } = renderAccount("/register");
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Alex Customer" } });
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "alex@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password-one" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password-two" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Your passwords do not match");
  expect(services.registerEmail).not.toHaveBeenCalled();
  await act(async () => {});
});

test("registration moves to email verification and preserves a delivery warning", async () => {
  const services = makeServices();
  services.registerEmail.mockImplementation(async () => {
    const user = makeUser({ emailVerified: false });
    services.emit(user);
    return { user, profileSaved: true, verificationSent: false };
  });
  renderAccount("/register", services);
  for (const [label, value] of [["Full name", "Alex Customer"], ["Email address", "alex@example.com"], ["Password", "password-one"], ["Confirm password", "password-one"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Your account was created, but the verification email could not be sent");
  expect(services.registerEmail).toHaveBeenCalledWith("Alex Customer", "alex@example.com", "password-one", false);
});

test("an unverified account must verify its email before opening account details", async () => {
  renderAccount("/account", makeServices(makeUser({ emailVerified: false })));
  expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Your account" })).not.toBeInTheDocument();
});

test("verification can resend an email and refresh the Firebase verification status", async () => {
  const services = makeServices(makeUser({ emailVerified: false }));
  services.refreshUser.mockImplementation(async (user) => { user.emailVerified = true; return user; });
  renderAccount("/verify-email", services);
  fireEvent.click(screen.getByRole("button", { name: "Send verification email" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Verification email sent");
  fireEvent.click(screen.getByRole("button", { name: "I’ve verified my email" }));
  expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
  expect(await screen.findByText("Email verified")).toBeInTheDocument();
});

test("reset confirmation does not expose whether an email is registered", async () => {
  const services = makeServices();
  services.resetPassword.mockRejectedValue({ code: "auth/user-not-found" });
  renderAccount("/forgot-password", services);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "unknown@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByRole("status")).toHaveTextContent("If an account uses that email");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a restored Firebase session loads its customer profile", async () => {
  const user = makeUser();
  const { loadProfile } = renderAccount("/account", makeServices(user));
  expect(await screen.findByRole("heading", { name: "Alex Customer" })).toBeInTheDocument();
  expect(loadProfile).toHaveBeenCalledWith(user, expect.any(AbortSignal));
});

test("a temporary profile failure preserves sign-in and can be retried", async () => {
  const services = makeServices(makeUser());
  const loadProfile = jest.fn().mockRejectedValueOnce(Object.assign(new Error("Account services unavailable"), { status: 503 }))
    .mockImplementation(async (user) => profileFor(user));
  renderAccount("/account", services, loadProfile);
  expect(await screen.findByRole("alert")).toHaveTextContent("Account services unavailable");
  expect(services.signOut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Alex Customer" })).toBeInTheDocument();
});

test("an invalid server session signs out and asks the customer to sign in again", async () => {
  const services = makeServices(makeUser());
  renderAccount("/account", services, jest.fn().mockRejectedValue(Object.assign(new Error("Expired"), { status: 401 })));
  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  expect(services.signOut).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert")).toHaveTextContent("Your session has expired");
});

test("a profile response arriving after sign-out cannot restore the old account", async () => {
  let resolveProfile;
  const loadProfile = jest.fn(() => new Promise((resolve) => { resolveProfile = resolve; }));
  const user = makeUser();
  const services = makeServices(user);
  renderAccount("/account", services, loadProfile);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  await act(async () => resolveProfile(profileFor(user)));
  expect(screen.queryByRole("heading", { name: "Your account" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("banner")).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
});

test("return paths preserve local pages and reject external URLs or auth loops", () => {
  expect(safeReturnPath("/products/hammer?branch=main")).toBe("/products/hammer?branch=main");
  for (const path of ["https://example.com", "//example.com", "/\\example.com", "/login", "/register?next=outside", "/verify-email", undefined]) {
    expect(safeReturnPath(path)).toBe("/account");
  }
});

test("guest account navigation opens sign-in without requiring a login to browse", async () => {
  renderAccount("/");
  expect(screen.getByRole("heading", { name: "Everything for your next project." })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("banner")).getByRole("link", { name: "Sign in" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument());
});
