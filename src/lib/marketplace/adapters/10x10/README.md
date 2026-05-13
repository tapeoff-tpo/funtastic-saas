# 10x10 Integration Stable Note

Stable baseline: current `main` after `33efcbe docs(ownerclan): mark stable integration baseline`

This integration is confirmed working for the current production workflow:

- Collect 10x10 new orders.
- Save collected orders as SaaS orders.
- Use 10x10 order lookup behavior that confirms new orders during collection.
- Upload invoices with 10x10 `detailIdx` from stored order raw data.
- Collect cancel, exchange, and return claim data.

Do not change these 10x10 files while adding another marketplace integration unless the user explicitly asks to fix 10x10:

- `src/lib/marketplace/adapters/10x10/adapter.ts`
- `src/lib/marketplace/adapters/10x10/client.ts`
- `src/lib/marketplace/adapters/10x10/status-map.ts`
- `src/lib/marketplace/adapters/10x10/types.ts`
- 10x10-specific branches in `src/lib/jobs/workers/order-collector.ts`
- 10x10-specific branches in `src/lib/jobs/workers/invoice-uploader.ts`
- `tests/marketplace/tenbyten.test.ts`

Important implementation details:

- 10x10 expects KST wall-clock date strings as `YYYY-MM-DD HH:mm:ss`.
- 10x10 rejects order lookup outside the allowed recent window, so collection uses the existing capped lookback logic in `order-collector.ts`.
- Do not call a separate confirm flow after collection. The 10x10 new-order lookup confirms orders as part of the API behavior.
- `confirmOrder` intentionally returns success for 10x10 because the confirmation is handled by `getOrders`.
- Invoice upload requires `detailIdx` per line, resolved from stored raw order data.
- Credentials currently use:
  - `api_key`
  - `shop_id`

For future integrations:

- Create a separate adapter directory under `src/lib/marketplace/adapters/<marketplace-id>/`.
- Register the new marketplace in `src/lib/marketplace/adapters/configs.ts`.
- Avoid copying 10x10 auto-confirm behavior unless the new API explicitly confirms orders during lookup.
