---
phase: 03-shipping-invoice-processing
plan: "07"
subsystem: shipping
tags: [held-shipments, server-actions, drizzle, next-js]
dependency_graph:
  requires: []
  provides: [held-shipments-page, held-shipment-query, held-shipment-actions]
  affects: [shipping-layout]
tech_stack:
  added: []
  patterns: [drizzle-join-query, server-actions-with-auth, client-server-boundary]
key_files:
  created:
    - src/app/(auth)/shipping/held/page.tsx
    - src/app/(auth)/shipping/held/client.tsx
  modified:
    - src/lib/shipping/queries.ts
    - src/lib/shipping/actions.ts
    - src/app/(auth)/shipping/layout.tsx
decisions:
  - Added getHeldShipments to existing queries.ts rather than creating a new file (file already existed with createShipment, getPendingUploads etc.)
  - Added reprocessHeldOrder/updateHeldMemo to existing actions.ts rather than a new file (consistent with module structure)
  - Added 'use server' directive to top of actions.ts (was missing; all exported functions are server actions or called server-side)
  - Deduplicated query results in getHeldShipments using a Set — leftJoin with orderItems produces multiple rows per shipment; we take the first item row as the representative
  - HeldOrderActions renders as two <td> cells (memo + action) to keep the row structure inside the server-component <tr>
metrics:
  duration: ~15 minutes
  completed: "2026-04-08T15:16:50Z"
  tasks_completed: 2
  files_changed: 5
---

# Phase 03 Plan 07: Held Shipments Page Summary

**One-liner:** `/shipping/held` page showing orders with tracking numbers but no shippedAt, with inline memo editing and reprocess-to-preparing action.

## What Was Built

### Task 1: Query + Server Actions

**`src/lib/shipping/queries.ts`** — added `getHeldShipments(userId)`:
- Joins `shipments` → `orders` → `orderItems` (left join)
- WHERE: `shippedAt IS NULL AND trackingNumber IS NOT NULL AND userId = userId`
- Deduplicates by shipmentId (leftJoin produces multiple rows per shipment when order has multiple items)
- Returns `HeldShipmentRow[]` with order info, shipment info, and first item name/quantity
- Limit 200, ORDER BY shipments.createdAt DESC

**`src/lib/shipping/actions.ts`** — added two server actions:
- `reprocessHeldOrder(orderId)`: deletes shipment record + resets order to `preparing` + clears isHeld/holdReason in a transaction
- `updateHeldMemo(orderId, memo)`: writes memo to holdReason, sets isHeld=true
- Both auth-gated via `createClient().auth.getUser()`, scoped to userId, call `revalidatePath('/shipping/held')`

### Task 2: UI Page + Navigation Tab

**`src/app/(auth)/shipping/held/page.tsx`** — server component:
- Auth check via Supabase, redirects to `/login` if unauthenticated
- Calls `getHeldShipments(user.id)`
- Shows count badge `{N}건` in header (red pill)
- Table columns: 마켓, 주문번호, 수령인, 상품명, 운송장번호, 택배사, 상태, 메모, 액션
- Empty state: "미발송 주문이 없습니다"

**`src/app/(auth)/shipping/held/client.tsx`** — `HeldOrderActions` client component:
- Renders as two `<td>` cells (memo input + reprocess button) inside the server-rendered `<tr>`
- Memo: controlled input, saves on blur or Enter key via `updateHeldMemo`
- Reprocess: confirm dialog → `reprocessHeldOrder` → page refreshes via revalidatePath
- Uses `useTransition` for pending states

**`src/app/(auth)/shipping/layout.tsx`** — added tab:
- `{ href: '/shipping/held', label: '미발송 관리' }` inserted after `합포장 관리`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added `'use server'` to actions.ts top level**
- **Found during:** Task 1
- **Issue:** actions.ts lacked the `'use server'` directive — the file exports server actions but the directive was missing, meaning Next.js would not treat them as server actions
- **Fix:** Added `'use server'` at the top of the file
- **Files modified:** src/lib/shipping/actions.ts
- **Commit:** f1e60a4

**2. [Rule 1 - Bug] Deduplicated leftJoin results in getHeldShipments**
- **Found during:** Task 1 (design review)
- **Issue:** leftJoin with orderItems produces one row per order item — an order with 3 items produces 3 rows, inflating the count and duplicating UI rows
- **Fix:** Added Set-based deduplication keeping the first row per shipmentId
- **Files modified:** src/lib/shipping/queries.ts
- **Commit:** f1e60a4

## Known Stubs

None. The page wires real data from `getHeldShipments` and actions call the real DB.

## Self-Check: PASSED
