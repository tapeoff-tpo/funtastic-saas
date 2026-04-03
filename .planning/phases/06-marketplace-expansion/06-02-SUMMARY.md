---
phase: 06-marketplace-expansion
plan: 02
subsystem: api
tags: [esm, gmarket, auction, marketplace-adapter, ky, msw]

# Dependency graph
requires:
  - phase: 01-foundation-marketplace-infrastructure
    provides: MarketplaceAdapter interface, registry, error classes
  - phase: 02-order-collection-dashboard
    provides: NormalizedOrder/NormalizedClaim types, carrier-codes
provides:
  - EsmAdapter class serving both Gmarket and Auction via unified ESM Trading API
  - ESM status mapping (order and claim statuses)
  - ESM HTTP client with Bearer token auth
  - MSW handlers for ESM API testing
affects: [06-marketplace-expansion, order-collector-worker, invoice-uploader]

# Tech tracking
tech-stack:
  added: []
  patterns: [single-adapter-dual-marketplace via site_type parameter]

key-files:
  created:
    - src/lib/marketplace/adapters/esm/adapter.ts
    - src/lib/marketplace/adapters/esm/client.ts
    - src/lib/marketplace/adapters/esm/types.ts
    - src/lib/marketplace/adapters/esm/status-map.ts
    - tests/marketplace/esm.test.ts
  modified:
    - tests/helpers/msw-handlers.ts

key-decisions:
  - "Single EsmAdapter class serves both Gmarket (G) and Auction (A) via site_type constructor param"
  - "ESM API uses Bearer token auth with API key (simpler than Coupang HMAC or Naver OAuth2)"

patterns-established:
  - "Dual-marketplace adapter: one class with site_type discriminator for shared API platforms"

requirements-completed: [MKT-04]

# Metrics
duration: 4min
completed: 2026-04-03
---

# Phase 06 Plan 02: ESM Trading API Adapter Summary

**EsmAdapter class for Gmarket/Auction via unified ESM Trading API with site_type-based config switching and 29 passing tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-03T07:26:57Z
- **Completed:** 2026-04-03T07:31:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- EsmAdapter class implements full MarketplaceAdapter interface for both Gmarket and Auction
- Single adapter differentiates marketplaces via site_type parameter ('G' or 'A')
- 29 tests passing covering status mapping, order/claims normalization, invoice upload for both marketplaces
- MSW handlers for ESM Trading API with siteType-based filtering

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ESM adapter core files** - `afa32b1` (feat)
2. **Task 2: Create ESM adapter tests with MSW mocks** - `0662c4e` (test)

## Files Created/Modified
- `src/lib/marketplace/adapters/esm/adapter.ts` - EsmAdapter class implementing MarketplaceAdapter for Gmarket/Auction
- `src/lib/marketplace/adapters/esm/client.ts` - ky HTTP client with Bearer token auth for etapi.ebaykorea.com
- `src/lib/marketplace/adapters/esm/types.ts` - ESM Trading API response types (orders, claims, products, invoices)
- `src/lib/marketplace/adapters/esm/status-map.ts` - ESM status to internal OrderStatus/ClaimStatus mapping
- `tests/marketplace/esm.test.ts` - 29 tests for both Gmarket and Auction adapter instances
- `tests/helpers/msw-handlers.ts` - Added ESM mock data and handlers (Gmarket + Auction orders, claims, delivery)

## Decisions Made
- Single EsmAdapter class serves both Gmarket and Auction via site_type constructor parameter, following the unified ESM Trading API pattern
- Bearer token auth used for ESM API (simpler than HMAC or OAuth2)
- ESM API response wrapper uses resultCode/resultMessage pattern (different from Coupang's code/message)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all adapter methods are fully implemented with proper normalization logic.

## Next Phase Readiness
- ESM adapter ready for registration in marketplace registry
- Can be integrated into order-collector worker for Gmarket/Auction order polling
- Invoice upload ready for both marketplaces

## Self-Check: PASSED

All 5 created files verified. Both commit hashes (afa32b1, 0662c4e) confirmed in git log.

---
*Phase: 06-marketplace-expansion*
*Completed: 2026-04-03*
