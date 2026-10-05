const { getCustomerFirebaseAuth } = require("../config/firebase");

const INVALID_SESSION_CODES = new Set([
  "auth/argument-error",
  "auth/invalid-argument",
  "auth/invalid-id-token",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/user-disabled",
  "auth/user-not-found",
]);

function createCustomerAuthMiddleware({ getAuth = getCustomerFirebaseAuth } = {}) {
  return async function protectCustomer(req, res, next) {
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || "");
    if (!match) {
      return res.status(401).json({ message: "Sign in to your customer account to continue." });
    }

    try {
      // Revocation checks also reject deleted or disabled Firebase accounts.
      const claims = await getAuth().verifyIdToken(match[1], true);
      if (
        typeof claims.uid !== "string" || !claims.uid ||
        typeof claims.email !== "string" || !claims.email ||
        !["password", "google.com"].includes(claims.firebase?.sign_in_provider)
      ) {
        return res.status(401).json({ message: "Please sign in with email or Google." });
      }

      req.customerClaims = claims;
      return next();
    } catch (error) {
      if (INVALID_SESSION_CODES.has(error.code)) {
        return res.status(401).json({ message: "Your session has expired. Please sign in again." });
      }
      console.error("Customer session verification failed:", error.code || error.name);
      return res.status(503).json({ message: "Account services are unavailable. Please try again shortly." });
    }
  };
}

module.exports = { createCustomerAuthMiddleware };
