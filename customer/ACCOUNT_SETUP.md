# Customer account sign-in

Customer accounts use Firebase Authentication (email/password and Google). The Express API verifies Firebase ID tokens, including revocation, and stores customer profiles in MongoDB by Firebase UID. Staff accounts continue to use their existing authentication system.

The storefront, cart draft, and ScanSpace browsing remain public. This first phase adds sign-in, registration, password recovery, email verification, and an account page. Reservations and saved ScanSpace projects are not linked to accounts yet.

## Local development

The public Firebase web configuration is in `src/auth/firebaseAuth.js`. Optional overrides are listed in `.env.example`; no Admin credential belongs in a `REACT_APP_*` variable.

Set these variables in `server/.env` (the local file has already been configured):

```dotenv
FIREBASE_PROJECT_ID=hardware-store-2c14a
GOOGLE_APPLICATION_CREDENTIALS=C:/absolute/path/to/the-downloaded-firebase-adminsdk.json
```

Keep the private JSON outside the repository. The API also needs its existing `MONGO_URI`.

Start the API with `npm start` from `server`, and the website with `npm start` from `customer`. Open `http://localhost:3000/login`.

The `Remember me` choice uses Firebase local persistence. Without it, the session lasts for the browser session. Passwords and ID tokens are managed by Firebase's SDK, rather than application-written browser storage.

Email registrations receive a Firebase verification link. After opening the link, return to the website and choose **I've verified my email**. Password reset emails use Firebase's hosted reset page.

## Production setup

Deploy the updated API and customer website together. The API must have the Admin credential configured before signed-in customers can load their account profiles.

For Render:

1. Add the downloaded Admin SDK JSON as a **secret file** named `firebase-admin.json` in the API service. Do not commit or paste it into frontend configuration.
2. Set `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-admin.json` and `FIREBASE_PROJECT_ID=hardware-store-2c14a` on the API service.
3. Deploy the API changes, then the customer website changes to Vercel.

Firebase already authorizes `localhost` and `hardware-store-customer-mav.vercel.app`. Add any future custom customer domain under **Authentication → Settings → Authorized domains**. Google uses a popup so the default Firebase auth domain can be retained.

Firebase email templates and branding can be customized in **Authentication → Templates**.

## Checks

From `server`, run `npm run test:auth`. Run `node scripts/check-customer-auth.cjs` for a read-only credential/provider/domain check; it never prints private keys or access tokens.

From `customer`, run:

```sh
npm test -- --watchAll=false --runInBand --runTestsByPath src/auth/AccountPages.test.jsx src/auth/customerApi.test.js src/auth/firebaseAuth.test.js src/App.test.js src/pages/ProductDetails.test.jsx src/cart/reservationCart.test.js
npm run build
```

Automated tests use test doubles and do not create users or send email in the live Firebase project. A final live Google sign-in and inbox verification should be completed with your own account in the browser.
