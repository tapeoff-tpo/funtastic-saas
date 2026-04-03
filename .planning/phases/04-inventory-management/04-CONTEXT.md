# Phase 4: Inventory Management - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Central inventory tracking per product with automatic stock adjustments on order/return events and manual adjustment with reason tracking. Prevents overselling at 500-2000 orders/day scale.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Central inventory table with product_id, total_stock, reserved_stock, available_stock.
- **D-02:** Atomic decrement on order ship using Postgres transaction (SELECT FOR UPDATE or atomic UPDATE).
- **D-03:** Auto-restore on cancel/return via order status change hook.
- **D-04:** Manual adjustment with reason enum: incoming, defective, physical_count, return, other.
- **D-05:** Inventory history/audit log for all changes (who, when, why, delta).

### Claude's Discretion
- Specific locking strategy (optimistic vs pessimistic)
- Inventory UI table design
- Alert thresholds for low stock

</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` (INV-01~04)
- `src/lib/db/schema.ts` — Existing schema (orders, order_items)
- `src/lib/orders/actions.ts` — Order status change hooks
- `src/lib/orders/types.ts` — OrderStatus enum

</canonical_refs>

<code_context>
## Existing Code Insights

### Integration Points
- `src/lib/orders/actions.ts` — Hook inventory deduction into updateOrderStatus
- `src/lib/db/schema.ts` — Add inventory tables
- `src/app/(auth)/` — Add inventory management page to sidebar

</code_context>

<specifics>
## Specific Ideas

None — standard inventory management patterns.

</specifics>

<deferred>
## Deferred Ideas

- 마켓플레이스별 재고 자동 동기화 (v2 INV-V2-01)
- 자동품절/재판매 (v2 INV-V2-02)

</deferred>

---
*Phase: 04-inventory-management*
*Context gathered: 2026-04-03*
