---
phase: quick
plan: 260514-specialoffer-api
subsystem: marketplace
tags: [specialoffer, api-key, product-reverse-collect, b2b]
dependency_graph:
  requires: [marketplace-adapter-pattern, vault-credentials, product-reverse-collect]
  provides: [specialoffer-open-api-v2-integration]
  affects: [marketplace-settings, order-collection-worker, product-import]
tech_stack:
  added: []
  patterns: [ky-bearer-client, marketplace-adapter, gsd-quick-plan]
key_files:
  created:
    - src/lib/marketplace/adapters/specialoffer/client.ts
    - src/lib/marketplace/adapters/specialoffer/types.ts
    - src/lib/marketplace/adapters/specialoffer/adapter.ts
    - tests/marketplace/specialoffer.test.ts
  modified:
    - src/lib/marketplace/adapters/configs.ts
    - src/lib/marketplace/types.ts
    - src/lib/marketplace/collect-options.ts
    - src/lib/jobs/workers/order-collector.ts
    - src/app/(auth)/settings/marketplaces/actions.ts
    - src/lib/products/reverse-collect.ts
    - src/app/(auth)/orders/columns.tsx
    - src/app/(auth)/products/mapping/mapping-manager.tsx
decisions:
  - Use api_key only; do not persist the provided key in code or planning docs.
  - Add a browser-like User-Agent header because Specialoffer WAF blocks bare curl/default clients.
  - Keep getOrders() empty because /api/v2/orders is buyer-side purchase history, not inbound sales-channel orders.
  - Support supplier product POST/수정 through NormalizedProduct.metadata.specialoffer pass-through for required Specialoffer-specific fields.
metrics:
  completed: 2026-05-14
---

# Quick Task 260514-specialoffer-api: Specialoffer Open API v2 Summary

스페셜오퍼 Open API v2 integration added using the existing marketplace adapter pattern.

## What Was Done

### Adapter
- Added `SpecialofferAdapter` with:
  - `testConnection()` via `GET /api/points`
  - `getProducts()` via `GET /api/goods`, capped to 5 pages x 100 rows to avoid accidental 400k+ product imports
  - `getProduct(goodsNo)` helper via `GET /api/goods/{goodsNo}`
  - supplier product `registerProduct()` / `updateProduct()` using `metadata.specialoffer` pass-through
  - buyer order helpers: `createBuyerOrder`, `getBuyerOrders`, `cancelBuyerOrder`
- Added typed Specialoffer response and payload interfaces.
- Added `User-Agent` header; actual smoke test showed WAF blocks bare clients but accepts browser-like requests.

### Wiring
- Added `specialoffer` to `MarketplaceId`.
- Registered Specialoffer in marketplace config registry.
- Added Specialoffer to credential testing in settings actions.
- Added Specialoffer to order-collector adapter factory.
- Added Specialoffer to product reverse collection.
- Added display labels in collect options, orders table, and mapping manager.

### Safety
- `getOrders()` intentionally returns `[]` because Specialoffer `/api/v2/orders` is buyer-side order history. This prevents purchase orders from being imported as sales orders.
- `uploadInvoice()` returns unsupported because the available shipment update endpoint is supplier-order scoped.

## Verification

- `git diff --check` passed.
- Actual API smoke:
  - `GET /api/points?per_page=1` returned JSON with `point: 0`.
  - `GET /api/goods?per_page=1&state=1,2,3,4` returned one product and `meta.total: 447071`.
- Added focused Vitest coverage in `tests/marketplace/specialoffer.test.ts`.

## Not Run

- Vitest/TypeScript/build were not run because this checkout currently has no `node_modules`, no system `npm`, and no package-manager binary available. `node --run lint` fails with `eslint: command not found`.

## Follow-Up

- If Specialoffer supplier product upload will be used from the product sync UI, `src/lib/products/sync.ts` still needs a credential-aware adapter path; this is a pre-existing limitation also affecting other non-core adapters registered as stubs.
