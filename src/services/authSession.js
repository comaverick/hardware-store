export const SESSION_EXPIRED_EVENT = "auth:session-expired";
export const SESSION_EXPIRED_MESSAGE =
  "Your session has ended. Please sign in again.";

// This is only a client-side expiry check. The API still verifies the signature.
export const getTokenExpiresAt = (token) => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) return 0;

    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const { exp } = JSON.parse(window.atob(padded));
    const expiresAt = exp * 1000;

    return typeof exp === "number" && Number.isFinite(expiresAt)
      ? expiresAt
      : 0;
  } catch {
    return 0;
  }
};

export const clearStoredSession = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
};

export const expireSession = (token) => {
  // A delayed response from an old session must not sign out a new login.
  if (!token || localStorage.getItem("token") !== token) return;

  clearStoredSession();
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
};
