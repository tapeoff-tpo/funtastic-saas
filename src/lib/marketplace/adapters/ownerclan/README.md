# Ownerclan Integration Stable Note

Stable baseline: `9d8f6f8 fix(ownerclan): use ID for checkOrder mutation`

This integration is confirmed working for the current production workflow:

- Collect new Ownerclan vendor orders.
- Backfill and refresh recently changed Ownerclan vendor orders during collection.
- Save collected orders as SaaS orders.
- Auto-confirm collected `new` orders by calling Ownerclan `checkOrder`.
- Retry confirmation for Ownerclan orders that were already saved locally as `new`.

Do not change these Ownerclan files while adding another marketplace integration unless the user explicitly asks to fix Ownerclan:

- `src/lib/marketplace/adapters/ownerclan/adapter.ts`
- `src/lib/marketplace/adapters/ownerclan/client.ts`
- `src/lib/marketplace/adapters/ownerclan/status-map.ts`
- `src/lib/marketplace/adapters/ownerclan/types.ts`
- Ownerclan-specific branches in `src/lib/jobs/workers/order-collector.ts`

Important implementation details:

- `checkOrder` GraphQL variable type must be `ID!`, not `String!`.
- Ownerclan order date filters use millisecond timestamps.
- Ownerclan collection is intentionally windowed to avoid API timeout and Cloudflare 502 responses.
- The shared collector calls Ownerclan with 1-day `since`/`until` ranges serially, capped at 1 concurrent range to avoid `Too many requests`.
- Ownerclan GraphQL requests are throttled with a 5-second interval and retry `Too many requests` responses after a 30-second backoff.
- Ownerclan collection should not be restricted to only `paid`/`placed`; it queries the selected date range and upserts returned orders so missed or changed orders are reconciled.
- `ownerclan` is included in `shouldConfirmOnCollect`, and confirmed local orders use marketplace status `preparing`.
- Credentials currently use both seller and vendor values:
  - `username`
  - `password`
  - `vendor_id`
  - `vendor_password`

For future integrations:

- Create a separate adapter directory under `src/lib/marketplace/adapters/<marketplace-id>/`.
- Register the new marketplace in `src/lib/marketplace/adapters/configs.ts`.
- Avoid reusing Ownerclan-specific query, timestamp, or auto-confirm behavior unless the new API has the same contract.
