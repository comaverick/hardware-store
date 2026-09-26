# Stock operation API

The following authenticated write endpoints require a unique `Idempotency-Key` header (8 to 128 letters, digits, hyphens, or underscores):

- `POST /api/sales/:id/refund`
- `POST /api/purchase-orders/:id/receive`
- `POST /api/inventory-transactions/receive`
- `POST /api/inventory-transactions/adjust`
- `POST /api/inventory-transactions/transfer`

Generate a new key for each intended operation. Reuse the same key and identical request body when retrying after a timeout. The server returns the original result without applying stock changes again. Reusing a key with a different body returns `409`.

Refund items should include the sale line `itemId`, plus `quantity` and optionally `product`. Purchase receipts use each purchase order line's `itemId`. A line may appear only once in a request.

Stock changes and their history are committed in MongoDB transactions. The MongoDB deployment must support transactions (a replica set or sharded cluster). The unique index on `StockOperation.actor` and `StockOperation.key` must be built before stock writes; the server waits for the model index to initialize.

Run `npm run test:stock` for the focused stock operation tests.
