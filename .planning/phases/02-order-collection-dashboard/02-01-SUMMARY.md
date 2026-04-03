---
phase: 02-order-collection-dashboard
plan: 01
subsystem: database
tags: [drizzle, postgres, orders, claims, status-workflow, pagination]

requires:
  - phase: 01-foundation-marketplace-infrastructure
    provides: "Drizzle schema with marketplace_connections, MarketplaceAdapter interface, registry"
provides:
  - "orders, order_items, claims, job_logs Drizzle tables with indexes"
  - "OrderStatus enum with Korean labels and VALID_TRANSITIONS workflow"
  - "isValidTransition pure function for status change validation"
  - "NormalizedOrder/NormalizedClaim fully typed interfaces for adapters"
  - "getOrders with server-side filtering and pagination"
  - "updateOrderStatus, holdOrder, releaseOrder, bulkUpdateStatus actions"
  - "getClaimsOrders method on MarketplaceAdapter interface"
affects: [02-02, 02-03, 02-04, 02-05]

tech-stack:
  added: [bullmq, ioredis, ky, p-limit, "@tanstack/react-table", date-fns, pino]
  patterns: [drizzle-pgTable-with-indexes, status-transition-validation, hold-release-pattern, transaction-with-row-lock]

key-files:
  created:
    - src/lib/orders/types.ts
    - src/lib/orders/queries.ts
    - src/lib/orders/actions.ts
    - tests/orders/status.test.ts
    - tests/orders/hold-release.test.ts
    - tests/orders/queries.test.ts
  modified:
    - src/lib/db/schema.ts
    - src/lib/marketplace/types.ts
    - src/lib/marketplace/adapters/configs.ts
    - src/__tests__/marketplace/registry.test.ts

key-decisions:
  - "Row-level locking (SELECT FOR UPDATE) in status transitions to prevent race conditions"
  - "buildOrderWhereClause exported as pure function for testability"
  - "bulkUpdateStatus validates per-order (not batch) to report individual errors"

patterns-established:
  - "Transaction + row lock pattern: db.transaction + .for('update') for concurrent-safe mutations"
  - "Filter builder pattern: buildOrderWhereClause returns SQL[] conditions for composable WHERE"
  - "Action result pattern: { success: boolean, error?: string } for all mutation actions"

requirements-completed: [ORD-04, ORD-06, ORD-07]

duration: 4min
completed: 2026-04-03
---

# Phase 2 Plan 1: Order Schema & Business Logic Summary

**Drizzle order schema with 4 tables, Korean status workflow (7 states), hold/release logic, and server-side filtered queries with 27 passing tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-03T04:03:03Z
- **Completed:** 2026-04-03T04:07:28Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Orders, order_items, claims, job_logs tables with unique indexes and foreign keys
- OrderStatus workflow with Korean labels and transition validation (7 statuses, terminal states enforced)
- Hold/release actions that store/restore previousStatus with row-level locking
- Server-side order queries with filtering by status, marketplace, date range, search, and pagination
- NormalizedOrder/NormalizedClaim interfaces fully typed for Phase 2 adapter implementations
- getClaimsOrders added to MarketplaceAdapter interface

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand Drizzle schema and NormalizedOrder types** - `09881f5` (test: RED) -> `224f225` (feat: GREEN)
2. **Task 2: Order queries and business logic actions** - `4915929` (test: RED) -> `44443ab` (feat: GREEN)

_TDD tasks had RED (test) then GREEN (implementation) commits_

## Files Created/Modified
- `src/lib/db/schema.ts` - Added orders, orderItems, claims, jobLogs tables with enums and indexes
- `src/lib/orders/types.ts` - OrderStatus, ClaimType, labels, transitions, isValidTransition, OrderFilters
- `src/lib/orders/queries.ts` - getOrders, getOrderById, getOrderCount with dynamic WHERE building
- `src/lib/orders/actions.ts` - updateOrderStatus, holdOrder, releaseOrder, bulkUpdateStatus
- `src/lib/marketplace/types.ts` - Expanded NormalizedOrder, added NormalizedOrderItem, NormalizedClaim
- `src/lib/marketplace/adapters/configs.ts` - Added getClaimsOrders stub to both adapters
- `src/__tests__/marketplace/registry.test.ts` - Added getClaimsOrders to mock adapter
- `tests/orders/status.test.ts` - 13 tests for status labels, transitions, validation
- `tests/orders/hold-release.test.ts` - 8 tests for hold/release/status actions with mocked DB
- `tests/orders/queries.test.ts` - 6 tests for filter building logic

## Decisions Made
- Used SELECT FOR UPDATE (row-level locking) in all mutation actions to prevent race conditions on concurrent status changes
- Exported buildOrderWhereClause as a pure function to enable unit testing without DB
- bulkUpdateStatus iterates per-order (not batch SQL) to provide per-order error reporting
- Search filter operates on buyerName, marketplaceOrderId, recipientName (not productName which is on orderItems)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed existing registry test missing getClaimsOrders**
- **Found during:** Task 1 (TypeScript compile)
- **Issue:** Adding getClaimsOrders to MarketplaceAdapter broke existing test mock
- **Fix:** Added getClaimsOrders stub to createMockAdapter in registry.test.ts
- **Files modified:** src/__tests__/marketplace/registry.test.ts
- **Verification:** npx tsc --noEmit passes
- **Committed in:** 224f225 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for type safety. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Order schema ready for Drizzle push (migration generation)
- NormalizedOrder/NormalizedClaim interfaces ready for Coupang/Naver adapter implementation (02-02)
- Query functions ready for dashboard consumption (02-04)
- Status/hold/release actions ready for UI wiring (02-05)
- BullMQ, ioredis, and other Phase 2 dependencies installed

---
*Phase: 02-order-collection-dashboard*
*Completed: 2026-04-03*
