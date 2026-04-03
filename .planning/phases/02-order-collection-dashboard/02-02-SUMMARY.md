---
phase: 02-order-collection-dashboard
plan: 02
subsystem: api
tags: [coupang, naver, hmac-sha256, oauth2, marketplace-adapter, ky, msw]

# Dependency graph
requires:
  - phase: 02-order-collection-dashboard/01
    provides: "NormalizedOrder/NormalizedClaim interfaces, MarketplaceAdapter interface, marketplace registry, placeholder adapters"
provides:
  - "CoupangAdapter with HMAC-SHA256 signing and order/claims normalization"
  - "NaverAdapter with OAuth2 token management and two-step order collection"
  - "MSW test handlers for Coupang and Naver API mocking"
  - "Status mapping functions for both marketplaces with safe fallbacks"
affects: [02-order-collection-dashboard/03, 02-order-collection-dashboard/04, 03-invoice-shipping]

# Tech tracking
tech-stack:
  added: [msw]
  patterns: [hmac-sha256-request-signing, oauth2-token-caching-with-proactive-refresh, two-step-order-collection, msw-api-mocking]

key-files:
  created:
    - src/lib/marketplace/adapters/coupang/adapter.ts
    - src/lib/marketplace/adapters/coupang/client.ts
    - src/lib/marketplace/adapters/coupang/types.ts
    - src/lib/marketplace/adapters/coupang/status-map.ts
    - src/lib/marketplace/adapters/naver/adapter.ts
    - src/lib/marketplace/adapters/naver/client.ts
    - src/lib/marketplace/adapters/naver/types.ts
    - src/lib/marketplace/adapters/naver/status-map.ts
    - tests/marketplace/coupang.test.ts
    - tests/marketplace/naver.test.ts
    - tests/helpers/msw-handlers.ts
  modified: []

key-decisions:
  - "Coupang HMAC datetime uses manual UTC formatting (not date-fns) for zero-dependency signing"
  - "Naver token refresh at 5-minute buffer before expiry for proactive renewal"
  - "Naver two-step pattern: lastChangedStatuses -> batch product-orders/query"
  - "MSW handlers split by marketplace for independent test setup"

patterns-established:
  - "Per-marketplace adapter directory structure: types.ts, status-map.ts, client.ts, adapter.ts"
  - "Status mapping with safe fallback to 'new' and console.warn for unknown values"
  - "MSW-based API mocking with separate handler arrays per marketplace"

requirements-completed: [MKT-01, MKT-02]

# Metrics
duration: 5min
completed: 2026-04-03
---

# Phase 02 Plan 02: Marketplace Adapters Summary

**Coupang HMAC-SHA256 adapter and Naver OAuth2 adapter with order/claims normalization, status mapping, and MSW test infrastructure**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-03T04:11:14Z
- **Completed:** 2026-04-03T04:16:00Z
- **Tasks:** 2
- **Files created:** 11

## Accomplishments
- Coupang adapter with per-request HMAC-SHA256 signing using Node.js crypto (2-digit year datetime format)
- Naver adapter with OAuth2 token management, proactive 5-minute refresh, and two-step order collection
- Both adapters normalize marketplace-specific responses to NormalizedOrder[] and NormalizedClaim[]
- 38 tests passing with MSW mock infrastructure ready for reuse in integration tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Coupang adapter** - `459c919` (feat)
2. **Task 2: Naver adapter** - `ed982a4` (feat)

## Files Created/Modified
- `src/lib/marketplace/adapters/coupang/client.ts` - HMAC-SHA256 signing and ky HTTP client
- `src/lib/marketplace/adapters/coupang/adapter.ts` - CoupangAdapter implementing MarketplaceAdapter
- `src/lib/marketplace/adapters/coupang/types.ts` - Coupang API response types
- `src/lib/marketplace/adapters/coupang/status-map.ts` - Coupang status to OrderStatus mapping
- `src/lib/marketplace/adapters/naver/client.ts` - OAuth2 token management and ky HTTP client
- `src/lib/marketplace/adapters/naver/adapter.ts` - NaverAdapter implementing MarketplaceAdapter
- `src/lib/marketplace/adapters/naver/types.ts` - Naver API response types
- `src/lib/marketplace/adapters/naver/status-map.ts` - Naver status to OrderStatus mapping
- `tests/marketplace/coupang.test.ts` - 19 tests for Coupang adapter
- `tests/marketplace/naver.test.ts` - 19 tests for Naver adapter
- `tests/helpers/msw-handlers.ts` - MSW handlers for both marketplace APIs

## Decisions Made
- Used manual UTC formatting for Coupang datetime (yyMMddTHHmmssZ) instead of date-fns to keep the crypto signing module dependency-free
- Naver token proactively refreshes 5 minutes before expiry (research Pitfall 3 guidance)
- Naver order collection uses two-step pattern: fetch changed IDs then batch fetch details (research Pattern 6)
- MSW handlers are exported as both combined array and separate per-marketplace arrays for flexible test setup
- Did not update configs.ts to wire real adapters (placeholder adapters remain in registry; real adapters are instantiated with credentials by workers)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed MSW as dev dependency**
- **Found during:** Task 1 (test setup)
- **Issue:** MSW was listed in research recommended stack but not installed in package.json
- **Fix:** `npm install -D msw`
- **Files modified:** package.json, package-lock.json
- **Verification:** Tests import MSW successfully, all 38 tests pass
- **Committed in:** 459c919 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** MSW installation was necessary for test infrastructure. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both adapters are ready for integration with BullMQ workers (Plan 03)
- MSW handlers ready for order collection worker integration tests
- Placeholder adapters in configs.ts remain for registry config lookup; workers create real adapter instances with credentials
- uploadInvoice() and getProducts() are stubbed for Phase 3 and Phase 5 respectively

---
*Phase: 02-order-collection-dashboard*
*Completed: 2026-04-03*
