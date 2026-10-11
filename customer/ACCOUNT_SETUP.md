# Customer account sign-in

Customer accounts use Firebase Authentication (email/password and Google). The Express API verifies Firebase ID tokens, including revocation, and stores customer profiles in MongoDB by Firebase UID. Staff accounts continue to use their existing authentication system.

The storefront, cart draft, and ScanSpace browsing remain public. Verified customer accounts can now reserve a whole cart at a selected branch, review reservation history, and cancel active holds. Saved ScanSpace projects are not linked to accounts yet.

## Customer reservations

Choose a branch in Products or the cart; the selection is shared and saved on this device. The cart shows current prices, the branch address and contact number, and available stock. Sign in and verify your email, enter a pickup name, and select **Reserve at this branch**. Optional phone numbers help the branch contact the customer.

The API creates one `Reservation` with all cart items in a MongoDB transaction. Conditional inventory updates prevent overselling; any unavailable line rolls back the entire cart. Prices come from the product database, and a changed price requires the customer to refresh and review the cart. The authenticated Firebase identity owns the reservation; client-supplied customer IDs, emails, statuses, and expiry dates are ignored. Each submission has a persisted request key so retries recover the same reservation without holding stock twice.

Customers choose a pickup date and time, up to seven days ahead, in Philippine time (UTC+8). Stock is held immediately and expires two hours after the scheduled pickup; the API validates the schedule and sets the expiry itself. The chosen schedule stays with the cart through sign-in and page reloads, and safe retries recover the original reservation even after its pickup time has passed. No online payment is collected. The confirmation includes a pickup reference, branch, items, scheduled pickup, and hold expiry. Final prices are checked by the cashier. Customers can find their holds at `/account/reservations`; cancelling or expiry releases every line. Branch staff see the schedule in their existing reservation queue and POS, and can mark the cart ready, cancel it, or open all held items together in POS for one receipt. Existing reservations without a schedule keep their original expiry. Single-product staff reservations remain supported.

The authenticated endpoints are `GET /api/customer-reservations`, `POST /api/customer-reservations` with an `Idempotency-Key` header, and `POST /api/customer-reservations/:id/cancel`. MongoDB must support transactions (a replica set or Atlas). Deploy the API, staff website, and customer website together so grouped reservations can be fulfilled and expired correctly.

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

From `server`, run `npm run test:auth` and `npm run test:reservations`. Run `node scripts/check-customer-auth.cjs` for a read-only credential/provider/domain check; it never prints private keys or access tokens.

From `customer`, run:

```sh
npm test -- --watchAll=false --runInBand --runTestsByPath src/auth/AccountPages.test.jsx src/auth/customerApi.test.js src/auth/firebaseAuth.test.js src/App.test.js src/pages/ProductDetails.test.jsx src/cart/reservationCart.test.js src/cart/CartDrawer.test.jsx src/cart/reservationApi.test.js
npm run build
```

Automated tests use test doubles and do not create users or send email in the live Firebase project. A final live Google sign-in and inbox verification should be completed with your own account in the browser.
