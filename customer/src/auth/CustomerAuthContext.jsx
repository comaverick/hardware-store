import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { customerAuth, authErrorMessage } from "./firebaseAuth";
import { fetchCustomerProfile } from "./customerApi";

const CustomerAuthContext = createContext(null);
const INVALID_SESSIONS = new Set([
  "auth/user-disabled", "auth/user-token-expired", "auth/invalid-user-token", "auth/user-not-found",
]);

export function CustomerAuthProvider({ children, services = customerAuth, loadProfile = fetchCustomerProfile }) {
  const [session, setSession] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const userRef = useRef(null);
  const pending = useRef(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  const syncUser = useCallback(async (user) => {
    const revision = ++generation.current;
    pending.current?.abort();
    userRef.current = user;
    setSession(user ? {
      user,
      emailVerified: user.emailVerified === true,
      email: user.email || "",
      name: user.displayName || "",
    } : null);
    setCustomer(null);
    setSessionError("");
    setInitializing(false);
    setProfileLoading(Boolean(user));
    if (!user) return;

    const controller = new AbortController();
    pending.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 15000);
    const isCurrent = () => mounted.current && revision === generation.current;
    try {
      const profile = await loadProfile(user, controller.signal);
      if (isCurrent()) setCustomer(profile);
    } catch (error) {
      if (!isCurrent()) return;
      if (error.status === 401 || INVALID_SESSIONS.has(error.code)) {
        // A temporary API/database failure must not clear a valid Firebase session.
        try {
          await services.signOut();
        } catch {
          // Keep the account blocked even if the local SDK could not clear storage.
        }
        if (mounted.current && (isCurrent() || userRef.current === null)) {
          userRef.current = null;
          setSession(null);
          setSessionError("Your session has expired. Please sign in again.");
        }
      } else {
        setSessionError(error.name === "AbortError"
          ? "Your account took too long to load. Please try again."
          : error.message || "Your account could not load. Please try again.");
      }
    } finally {
      window.clearTimeout(timer);
      if (isCurrent()) setProfileLoading(false);
    }
  }, [loadProfile, services]);

  useEffect(() => {
    mounted.current = true;
    let unsubscribe;
    try {
      unsubscribe = services.watchUser((user) => {
        if (mounted.current) syncUser(user);
      }, (error) => {
        if (!mounted.current) return;
        setInitializing(false);
        setSessionError(authErrorMessage(error));
      });
    } catch (error) {
      setInitializing(false);
      setSessionError(authErrorMessage(error));
    }
    return () => {
      mounted.current = false;
      generation.current += 1;
      pending.current?.abort();
      unsubscribe?.();
    };
  }, [services, syncUser]);

  const refreshSession = useCallback(() => syncUser(userRef.current), [syncUser]);

  return (
    <CustomerAuthContext.Provider value={{
      session, customer, initializing, profileLoading, sessionError,
      refreshSession, auth: services,
    }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function CustomerAuthBoundary({ children }) {
  const existing = useContext(CustomerAuthContext);
  return existing ? children : <CustomerAuthProvider>{children}</CustomerAuthProvider>;
}

export function useCustomerAuth() {
  const context = useContext(CustomerAuthContext);
  if (!context) throw new Error("Customer account context is missing.");
  return context;
}
