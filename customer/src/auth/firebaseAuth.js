import { getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  initializeAuth,
  inMemoryPersistence,
  onIdTokenChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  validatePassword,
} from "firebase/auth";

// Firebase's web configuration is public. Admin credentials belong only on the server.
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyB8fD1kfBPFwWv5QOMZ3flP02Ap4Shiv_A",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "hardware-store-2c14a.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "hardware-store-2c14a",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "hardware-store-2c14a.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "483314345522",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:483314345522:web:696c608eada23192947e2b",
};

let auth;
function getCustomerAuth() {
  if (!auth) {
    const name = "hardware-store-customer";
    const app = getApps().find((entry) => entry.name === name) || initializeApp(firebaseConfig, name);
    auth = initializeAuth(app, {
      persistence: [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  }
  return auth;
}

const emailSettings = () => ({ url: `${window.location.origin}/verify-email` });

async function passwordPolicyError(password) {
  const status = await validatePassword(getCustomerAuth(), password);
  if (status.isValid) return;
  const requirements = [];
  if (status.meetsMinPasswordLength === false) {
    requirements.push(`at least ${status.passwordPolicy.customStrengthOptions.minPasswordLength} characters`);
  }
  if (status.containsLowercaseLetter === false) requirements.push("a lowercase letter");
  if (status.containsUppercaseLetter === false) requirements.push("an uppercase letter");
  if (status.containsNumericCharacter === false) requirements.push("a number");
  if (status.containsNonAlphanumericCharacter === false) requirements.push("a symbol");
  if (status.meetsMaxPasswordLength === false) {
    throw new Error("This password is too long. Choose a shorter password.");
  }
  throw new Error(requirements.length ? `Use a password with ${requirements.join(", ")}.` : "Choose a stronger password.");
}

export const customerAuth = {
  watchUser(next, error) {
    return onIdTokenChanged(getCustomerAuth(), next, error);
  },
  async signInEmail(email, password, remember) {
    await setPersistence(getCustomerAuth(), remember ? browserLocalPersistence : browserSessionPersistence);
    return signInWithEmailAndPassword(getCustomerAuth(), email.trim(), password);
  },
  async registerEmail(name, email, password, remember) {
    await passwordPolicyError(password);
    await setPersistence(getCustomerAuth(), remember ? browserLocalPersistence : browserSessionPersistence);
    const { user } = await createUserWithEmailAndPassword(getCustomerAuth(), email.trim(), password);
    // Once Firebase creates the account, failures below must not suggest registration failed.
    let profileSaved = true;
    try {
      await updateProfile(user, { displayName: name.trim().slice(0, 100) });
      await user.getIdToken(true);
    } catch {
      profileSaved = false;
    }
    let verificationSent = true;
    try {
      await sendEmailVerification(user, emailSettings());
    } catch {
      verificationSent = false;
    }
    return { user, profileSaved, verificationSent };
  },
  async signInGoogle(remember) {
    await setPersistence(getCustomerAuth(), remember ? browserLocalPersistence : browserSessionPersistence);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return signInWithPopup(getCustomerAuth(), provider);
  },
  resetPassword(email) {
    return sendPasswordResetEmail(getCustomerAuth(), email.trim());
  },
  sendVerification(user) {
    return sendEmailVerification(user, emailSettings());
  },
  async refreshUser(user) {
    await reload(user);
    await user.getIdToken(true);
    return user;
  },
  signOut() {
    return signOut(getCustomerAuth());
  },
};

export function authErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "That email or password is incorrect. Please try again.",
    "auth/invalid-login-credentials": "That email or password is incorrect. Please try again.",
    "auth/wrong-password": "That email or password is incorrect. Please try again.",
    "auth/user-not-found": "That email or password is incorrect. Please try again.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/email-already-in-use": "That email is already registered. Sign in or reset your password.",
    "auth/weak-password": "Choose a stronger password with at least 6 characters.",
    "auth/password-does-not-meet-requirements": "Your password does not meet the account requirements. Choose a stronger password.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "Check your internet connection and try again.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled. You can try again.",
    "auth/cancelled-popup-request": "Google sign-in was cancelled. You can try again.",
    "auth/popup-blocked": "Allow pop-ups for this website, then try Google again.",
    "auth/account-exists-with-different-credential": "This email already has an account. Sign in using your original method.",
    "auth/unauthorized-domain": "Sign-in is not enabled for this website address yet. Please contact the store.",
    "auth/operation-not-allowed": "This sign-in method is currently unavailable. Please try another method.",
    "auth/user-disabled": "This account is disabled. Please contact the store.",
  };
  return messages[error?.code] || (!error?.code && error?.message) || "We could not complete that request. Please try again.";
}
