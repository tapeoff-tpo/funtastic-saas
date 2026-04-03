---
phase: 04-inventory-management
plan: 01
subsystem: database
tags: [inventory, drizzle, postgres, audit-log, stock-management]

requires:
  - phase: 02-order-collection-dashboard
    provides: orders and orderItems schema, updateOrderStatus action
provides:
  - inventory and inventoryHistory DB tables with indexes
  - adjustStock, setStock, deductForOrder, restoreForOrder, restoreForClaim actions
  - getInventoryList, getInventoryBySku, getInventoryHistory queries
  - InventoryRecord, InventoryHistoryRecord, AdjustmentReason types
  - ADJUSTMENT_REASON_LABELS Korean label map
  - Order status hooks for automatic inventory changes
affects: [04-02-inventory-ui, product-management]

tech-stack:
  added: []
  patterns: [SELECT FOR UPDATE inventory locking, in-transaction inventory hooks, adjustment audit trail]

key-files:
  created:
    - src/lib/inventory/types.ts
    - src/lib/inventory/queries.ts
    - src/lib/inventory/actions.ts
  modified:
    - src/lib/db/schema.ts
    - src/lib/orders/actions.ts

key-decisions:
  - "DrizzleTransaction type derived from db.transaction callback parameter type"
  - "deductForOrder/restoreForOrder skip missing SKUs with console.warn instead of failing"
  - "restoreForClaim is standalone (own transaction) since claims are separate from order status flow"

patterns-established:
  - "Inventory locking: SELECT FOR UPDATE on inventory row within transaction"
  - "Audit trail: every stock change creates inventoryHistory entry with reason, delta, previousTotal, newTotal"
  - "In-transaction hooks: deductForOrder/restoreForOrder receive tx parameter to run inside existing transaction"

requirements-completed: [INV-01, INV-02, INV-03, INV-04]

duration: 3min
completed: 2026-04-03
---

# Phase 4 Plan 1: Inventory Data Layer Summary

**Inventory schema with total/reserved/available stock per SKU, atomic deduct-on-ship and restore-on-cancel hooks in order status transitions, full audit trail via inventoryHistory table**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-03T06:38:09Z
- **Completed:** 2026-04-03T06:41:10Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- inventory and inventoryHistory tables added to schema with unique index on (userId, sku) and FK relationships
- adjustStock with SELECT FOR UPDATE atomicity, setStock upsert, deductForOrder/restoreForOrder in-tx functions, restoreForClaim standalone function
- updateOrderStatus now auto-deducts inventory on 'shipped' and auto-restores on 'cancelled' from shipped/delivering states
- Every inventory change produces an audit history record with reason, delta, and optional orderId link

## Task Commits

Each task was committed atomically:

1. **Task 1: Inventory schema, types, and query layer** - `be607b0` (feat)
2. **Task 2: Stock adjustment actions and order status hooks** - `23aea01` (feat)

## Files Created/Modified
- `src/lib/db/schema.ts` - Added adjustmentReasonEnum, inventory table, inventoryHistory table with indexes
- `src/lib/inventory/types.ts` - AdjustmentReason type, InventoryRecord/HistoryRecord interfaces, Korean labels
- `src/lib/inventory/queries.ts` - getInventoryList (paginated+search), getInventoryBySku, getInventoryHistory
- `src/lib/inventory/actions.ts` - adjustStock, setStock, deductForOrder, restoreForOrder, restoreForClaim
- `src/lib/orders/actions.ts` - Added userId to select, inventory hooks in updateOrderStatus

## Decisions Made
- DrizzleTransaction type derived from `Parameters<Parameters<typeof db.transaction>[0]>[0]` to avoid importing internal Drizzle types
- deductForOrder/restoreForOrder silently skip SKUs not found in inventory (console.warn) rather than failing the order transition -- not all order items may be mapped to inventory yet
- restoreForClaim uses its own transaction since claims processing is a separate workflow from order status changes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Inventory data layer complete, ready for UI implementation in plan 04-02
- All query functions and actions available for dashboard components
- Order status hooks are live -- shipping an order will auto-deduct inventory

## Self-Check: PASSED

All 5 files verified present. Both task commits (be607b0, 23aea01) verified in git log.

---
*Phase: 04-inventory-management*
*Completed: 2026-04-03*
