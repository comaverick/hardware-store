const { applicationDefault, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const APP_NAME = "hardware-store-customer";

function getCustomerFirebaseAuth() {
  let app = getApps().find((entry) => entry.name === APP_NAME);
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured.");
    app = initializeApp({ credential: applicationDefault(), projectId }, APP_NAME);
  }
  return getAuth(app);
}

module.exports = { getCustomerFirebaseAuth };
