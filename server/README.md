# Stock operation API

The following authenticated write endpoints require a unique `Idempotency-Key` header (8 to 128 letters, digits, hyphens, or underscores):

- `POST /api/sales/:id/refund`
- `POST /api/purchase-orders/:id/receive`
- `POST /api/inventory-transactions/receive`
- `POST /api/inventory-transactions/adjust`
- `POST /api/inventory-transactions/transfer`
- `POST /api/reservations/:id/checkout`

Generate a new key for each intended operation. Reuse the same key and identical request body when retrying after a timeout. The server returns the original result without applying stock changes again. Reusing a key with a different body returns `409`.

Refund items should include the sale line `itemId`, plus `quantity` and optionally `product`. Purchase receipts use each purchase order line's `itemId`. A line may appear only once in a request.

Stock changes and their history are committed in MongoDB transactions. The MongoDB deployment must support transactions (a replica set or sharded cluster). The unique index on `StockOperation.actor` and `StockOperation.key` must be built before stock writes; the server waits for the model index to initialize.

Run `npm run test:stock` for the focused stock operation tests.

## Reservation pickup

In POS, enter the reservation number with **Find reservation**, or use **Checkout in POS** from the reservation queue. The held product and quantity are added to the sale. Other products may be added at their available stock quantity. Checkout records the sale, consumes the held quantity, releases its hold, and marks the reservation complete in one MongoDB transaction. A repeated checkout with the same idempotency key and body returns the first receipt. A second checkout with a different key is rejected.

`POST /api/reservations/:id/checkout` accepts the same sale body as POS (`branch`, `items`, `discount`, `paymentMethod`, `amountPaid`). The reserved product must appear exactly once at the full held quantity. `PATCH /api/reservations/:id/status` can set `READY_FOR_PICKUP` or `CANCELLED`; checkout is the only way to complete a reservation.

The server checks a reservation's expiry when looking it up, changing its status, or checking it out. A worker also scans for expired active and ready reservations at startup, after reconnecting to MongoDB, and every 60 seconds. It releases the held quantity and marks each reservation expired in one transaction. `/api/health` includes the latest expiry pass result.
