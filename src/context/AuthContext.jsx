import { createContext, useContext, useEffect, useState } from "react";

import {
  clearStoredSession,
  expireSession,
  getTokenExpiresAt,
  SESSION_EXPIRED_EVENT,
} from "../services/authSession";

const AuthContext = createContext();
const MAX_TIMEOUT_MS = 2147483647;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const syncSession = () => {
      const token = localStorage.getItem("token");
      const storedUser = localStorage.getItem("user");

      if (!token && !storedUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const savedUser = JSON.parse(storedUser);
        if (!savedUser?.id || getTokenExpiresAt(token) <= Date.now()) {
          throw new Error("Invalid or expired saved session");
        }

        setUser(savedUser);
        setSessionExpired(false);
      } catch {
        clearStoredSession();
        setUser(null);
        setSessionExpired(true);
      }

      setLoading(false);
    };

    const handleSessionExpired = () => {
      setUser(null);
      setSessionExpired(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") syncSession();
    };
    const handleStorageChange = (event) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === null || ["token", "user"].includes(event.key)) {
        syncSession();
      }
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.addEventListener("focus", syncSession);
    window.addEventListener("storage", handleStorageChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    syncSession();

    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
      window.removeEventListener("focus", syncSession);
      window.removeEventListener("storage", handleStorageChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    const token = localStorage.getItem("token");
    const expiresAt = getTokenExpiresAt(token);
    let timeout;
    const checkExpiry = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        expireSession(token);
        return;
      }
      timeout = window.setTimeout(checkExpiry, Math.min(remaining, MAX_TIMEOUT_MS));
    };

    checkExpiry();
    return () => window.clearTimeout(timeout);
  }, [user]);

  const login = (token, userData) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userData));

    setUser(userData);
    setSessionExpired(false);
  };

  const logout = () => {
    clearStoredSession();
    setUser(null);
    setSessionExpired(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        loading,
        sessionExpired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
