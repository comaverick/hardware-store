# ScanSpace

ScanSpace is the Android-first room-scanning and room-editing experience in the customer application. It uses real WebXR **CPU depth** frames when the device and browser expose them. It never represents ordinary camera permission as a depth scan.

## What is included

- WebXR depth capture with quality, point, and pose diagnostics.
- Privacy-preserving reconstruction: raw camera frames and raw depth frames are never uploaded. Optional sampled wall colour captures remain in the browser's IndexedDB store.
- An assisted AR-corner route when real depth is unavailable, plus a manual dimension route. Both remain visibly labelled as non-depth capture.
- A review step for room corners, wall dimensions, ceiling height, doors, and windows before the editor opens.
- A mobile 3D room editor with first-person movement, top/orbit modes, material changes, PBR lighting/shadows, GLB furniture, collision-aware movement and placement, undo/redo, and local save/load.
- Deterministic paint, floor-covering, and furniture estimates. The server recomputes all totals and verifies product price, availability, dimensions, and placement before returning cart lines.
- A project API with a local 256-bit owner key and 90-day automatic expiry. Users can only read or mutate projects created in that browser profile.

## Run locally

From the repository root, start the API in one terminal and the customer app in another:

```powershell
cd server
npm start

cd ..\customer
npm start
```

The customer app is available at `/scanspace`. Its development proxy sends `/api` requests to `http://localhost:5000`. Set `REACT_APP_API_URL` to the API origin when the two apps are hosted separately.

## Android depth test

Use a real Android device with a recent Chrome and a secure HTTPS deployment. The browser must have camera permission, and the server/static host must allow the `camera` and `xr-spatial-tracking` permissions. The development proxy sets:

```text
Permissions-Policy: camera=(self), xr-spatial-tracking=(self)
```

On the device, open **ScanSpace → Scan my room**, accept the camera prompt, and move slowly around the floor, walls, and ceiling. The Scan panel must show a non-zero depth-frame count, a depth format, and accumulating sampled points before the scan can be described as depth-backed. A healthy scan should cover each wall from multiple angles; sparse coverage intentionally stops at review instead of inventing missing geometry.

If the browser/device does not provide WebXR depth, use **Assisted AR corners** or **Enter dimensions manually**. Those routes still produce a usable editor, but are accurately labelled rather than advertised as depth scans. iOS is not part of this first release; evaluate AR Quick Look/RoomPlan/native capture as a separate platform track later.

## Catalog onboarding

Only products with `scanSpace.enabled: true` appear in the ScanSpace catalog. Configure their ScanSpace metadata through the product API/admin workflow; existing products remain compatible. A minimal paint product looks like:

```json
{
  "scanSpace": {
    "enabled": true,
    "materialType": "paint",
    "color": "#d9d2c3",
    "coveragePerLitre": 10,
    "defaultCoats": 2,
    "wasteFactor": 0.1
  }
}
```

Floor products use `materialType` of `tile`, `wood`, or `vinyl` and set `coveragePerPack` (plus `tileSize` where applicable). Furniture uses `materialType: "object"`, `dimensions` in metres, a placement type, and an HTTPS or local absolute `modelUrl` pointing to a GLB. The customer bundle ships three original placeholder GLBs in `customer/public/scanspace/models/` for the sample room only; they are not store inventory.

## Reservations/cart connection

`POST /api/scanspace/cart-lines` validates the final material selections on the server but intentionally returns an unreserved draft: this repository's customer checkout has no public stock-reservation endpoint yet. The customer app persists that validated draft locally and exposes `registerReservationCartAdapter()` in `customer/src/cart/reservationCart.js`. Connect that adapter to the real customer reservation/cart endpoint when it is introduced; only that endpoint should reserve stock or create a reservation.

## Deployment checklist

- Deploy the `customer` application as its own HTTPS static app with `npm run build`. The current root `render.yaml` does not deploy this customer application.
- Set `REACT_APP_API_URL` and allow the deployed customer origin in the API's CORS configuration.
- Configure the permissions-policy header shown above at the static host.
- Test a supported Android device end-to-end before advertising depth capture.
- Do not seed the sample products into production; onboard actual catalog data with real coverage, pack size, price, inventory, texture, and model metadata.

## Verification

```powershell
cd server
npm run test:scanspace

cd ..\customer
CI=true npm test -- --watchAll=false --runInBand
npm run build
```
