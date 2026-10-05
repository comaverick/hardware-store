jest.unmock("./firebaseAuth");
jest.mock("firebase/app", () => ({
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: "hardware-store-customer" })),
}));
jest.mock("firebase/auth", () => ({
  browserLocalPersistence: { type: "LOCAL" },
  browserSessionPersistence: { type: "SESSION" },
  inMemoryPersistence: { type: "NONE" },
  browserPopupRedirectResolver: {},
  initializeAuth: jest.fn(() => ({ name: "customer-auth" })),
  onIdTokenChanged: jest.fn(() => () => {}),
  setPersistence: jest.fn().mockResolvedValue(undefined),
  signInWithEmailAndPassword: jest.fn().mockResolvedValue({}),
  createUserWithEmailAndPassword: jest.fn(),
  updateProfile: jest.fn(),
  sendEmailVerification: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  validatePassword: jest.fn(),
  GoogleAuthProvider: jest.fn(() => ({ setCustomParameters: jest.fn() })),
  signInWithPopup: jest.fn().mockResolvedValue({}),
  reload: jest.fn(),
  signOut: jest.fn(),
}));

import {
  browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword,
  GoogleAuthProvider, initializeAuth, onIdTokenChanged, reload, sendEmailVerification, setPersistence,
  signInWithEmailAndPassword, signInWithPopup, updateProfile, validatePassword,
} from "firebase/auth";
import { getApps, initializeApp } from "firebase/app";
import { customerAuth, authErrorMessage } from "./firebaseAuth";

let user;
beforeEach(() => {
  jest.clearAllMocks();
  getApps.mockReturnValue([]);
  initializeApp.mockReturnValue({ name: "hardware-store-customer" });
  initializeAuth.mockReturnValue({ name: "customer-auth" });
  setPersistence.mockResolvedValue(undefined);
  signInWithEmailAndPassword.mockResolvedValue({});
  signInWithPopup.mockResolvedValue({});
  GoogleAuthProvider.mockImplementation(() => ({ setCustomParameters: jest.fn() }));
  onIdTokenChanged.mockReturnValue(() => {});
  user = { getIdToken: jest.fn().mockResolvedValue("id-token"), emailVerified: true };
  createUserWithEmailAndPassword.mockResolvedValue({ user });
  updateProfile.mockResolvedValue(undefined);
  sendEmailVerification.mockResolvedValue(undefined);
  validatePassword.mockResolvedValue({ isValid: true });
});

test("email sign-in selects Firebase persistence without manually storing credentials", async () => {
  await customerAuth.signInEmail(" alex@example.com ", "password", false);
  expect(setPersistence).toHaveBeenLastCalledWith(expect.any(Object), browserSessionPersistence);
  expect(signInWithEmailAndPassword).toHaveBeenCalledWith(expect.any(Object), "alex@example.com", "password");
  await customerAuth.signInEmail("alex@example.com", "password", true);
  expect(setPersistence).toHaveBeenLastCalledWith(expect.any(Object), browserLocalPersistence);
});

test("Google uses the popup flow and an explicit account selection", async () => {
  await customerAuth.signInGoogle(true);
  const provider = GoogleAuthProvider.mock.results[0].value;
  expect(provider.setCustomParameters).toHaveBeenCalledWith({ prompt: "select_account" });
  expect(signInWithPopup).toHaveBeenCalledWith(expect.any(Object), provider);
  expect(setPersistence).toHaveBeenCalledWith(expect.any(Object), browserLocalPersistence);
});

test("registration saves the name and refreshes claims before sending verification", async () => {
  expect(await customerAuth.registerEmail(" Alex Customer ", " alex@example.com ", "password", false)).toEqual({
    user, profileSaved: true, verificationSent: true,
  });
  expect(updateProfile).toHaveBeenCalledWith(user, { displayName: "Alex Customer" });
  expect(user.getIdToken).toHaveBeenCalledWith(true);
  expect(sendEmailVerification).toHaveBeenCalledWith(user, { url: `${window.location.origin}/verify-email` });
});

test("a verification delivery failure still reports the successfully created account", async () => {
  sendEmailVerification.mockRejectedValueOnce({ code: "auth/too-many-requests" });
  await expect(customerAuth.registerEmail("Alex", "alex@example.com", "password", false)).resolves.toMatchObject({
    user, verificationSent: false, profileSaved: true,
  });
  expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
});

test("a profile update failure does not cause a second registration attempt", async () => {
  updateProfile.mockRejectedValueOnce(new Error("Offline"));
  await expect(customerAuth.registerEmail("Alex", "alex@example.com", "password", false)).resolves.toMatchObject({
    user, verificationSent: true, profileSaved: false,
  });
  expect(sendEmailVerification).toHaveBeenCalledTimes(1);
});

test("Firebase's configured password requirements are checked before account creation", async () => {
  validatePassword.mockResolvedValueOnce({
    isValid: false, meetsMinPasswordLength: false, containsNumericCharacter: false,
    passwordPolicy: { customStrengthOptions: { minPasswordLength: 10 } },
  });
  await expect(customerAuth.registerEmail("Alex", "alex@example.com", "short", false)).rejects.toThrow("at least 10 characters, a number");
  expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
});

test("verification refresh reloads the user and forces a new ID token", async () => {
  await customerAuth.refreshUser(user);
  expect(reload).toHaveBeenCalledWith(user);
  expect(user.getIdToken).toHaveBeenCalledWith(true);
});

test("session changes subscribe to refreshed ID tokens", () => {
  const next = jest.fn();
  const error = jest.fn();
  expect(customerAuth.watchUser(next, error)).toEqual(expect.any(Function));
  expect(onIdTokenChanged).toHaveBeenCalledWith(expect.any(Object), next, error);
});

test("sign-in errors give customers useful messages without exposing SDK internals", () => {
  expect(authErrorMessage({ code: "auth/popup-blocked" })).toMatch(/allow pop-ups/i);
  expect(authErrorMessage({ code: "auth/invalid-credential" })).toMatch(/email or password is incorrect/i);
  expect(authErrorMessage({ code: "auth/account-exists-with-different-credential" })).toMatch(/original method/i);
  expect(authErrorMessage({ code: "auth/unknown", message: "SDK internal detail" })).not.toContain("SDK internal detail");
});
