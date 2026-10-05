const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { getCustomerFirebaseAuth } = require("../config/firebase");

// Read-only setup check. Print only provider/domain settings, never private credentials or tokens.
async function check() {
  const auth = getCustomerFirebaseAuth();
  const { access_token: token } = await auth.app.options.credential.getAccessToken();
  const response = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${auth.app.options.projectId}/config`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Firebase configuration check returned HTTP ${response.status}.`);
  const config = await response.json();
  const providerResponse = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${auth.app.options.projectId}/defaultSupportedIdpConfigs/google.com`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  const google = providerResponse.ok ? await providerResponse.json() : {};
  console.log(JSON.stringify({
    projectId: auth.app.options.projectId,
    adminCredentialReady: true,
    emailPasswordEnabled: config.signIn?.email?.enabled === true && config.signIn?.email?.passwordRequired === true,
    googleEnabled: google.enabled === true,
    authorizedDomains: config.authorizedDomains || [],
  }, null, 2));
}

check().catch((error) => {
  console.error("Firebase setup check failed:", error.code || error.name);
  process.exitCode = 1;
});
