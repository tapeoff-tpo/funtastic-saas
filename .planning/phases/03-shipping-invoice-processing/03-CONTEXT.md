# Phase 3: Shipping & Invoice Processing - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete the shipping workflow: invoice upload to marketplaces (API + Excel fallback), combined shipping detection and merge/split, carrier-specific Excel export with customizable templates, and shipping label printing. This is the 사방넷 switching trigger — once this works, the subscription can be cancelled.

</domain>

<decisions>
## Implementation Decisions

### Invoice Upload (API)
- **D-01:** Use existing Coupang/Naver adapter uploadInvoice() methods. Bulk upload via BullMQ job queue.
- **D-02:** Track upload status per order (pending/uploaded/failed/confirmed). Retry failed uploads automatically.

### Invoice Upload (Excel)
- **D-03:** ExcelJS for reading uploaded Excel files. Column mapping configurable per carrier format.
- **D-04:** Upload flow: user uploads Excel → system parses → matches to orders → bulk updates invoice numbers.

### Combined Shipping (합포장)
- **D-05:** Auto-detect: same buyer name + same address + within same day = merge candidate.
- **D-06:** 출고편집코드 기반 자동분리: 냉동/상온, 대형/소형 등 상품 속성별 분리.
- **D-07:** 최대합포장수량 설정: 박스 크기 제한으로 N개 이상은 자동 분할.
- **D-08:** UI shows merge suggestions with confirm/reject per group.

### Order Splitting
- **D-09:** Manual split: admin selects items from an order to ship separately.

### Carrier Excel Export
- **D-10:** ExcelJS for formatted Excel output. Korean carrier templates (CJ대한통운, 한진, 롯데, 우체국, 로젠).
- **D-11:** Custom template builder: admin maps columns per carrier.

### Shipping Label Print
- **D-12:** Browser-based print using CSS @media print. Batch selection from order table.

### Claude's Discretion
- Specific carrier template column layouts
- Combined shipping detection algorithm optimization
- Excel parsing error handling UX
- Print layout design

</decisions>

<canonical_refs>
## Canonical References

### Project Context
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md` (SHIP-01~08, DATA-01)
- `.planning/research/SUMMARY.md`
- `.planning/research/STACK.md` (ExcelJS recommendation)

### Phase 1-2 Outputs (dependencies)
- `src/lib/marketplace/types.ts` — MarketplaceAdapter interface (uploadInvoice method)
- `src/lib/marketplace/adapters/coupang/adapter.ts` — Coupang adapter
- `src/lib/marketplace/adapters/naver/adapter.ts` — Naver adapter
- `src/lib/db/schema.ts` — orders, order_items tables
- `src/lib/orders/queries.ts` — getOrders, getOrderById
- `src/lib/orders/actions.ts` — updateOrderStatus
- `src/lib/jobs/queues.ts` — BullMQ queue definitions
- `src/app/(auth)/orders/` — Order dashboard UI

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- BullMQ infrastructure (queues, workers, connection)
- Order dashboard with TanStack Table (add bulk action buttons)
- Marketplace adapters with uploadInvoice() method stubs
- shadcn/ui components library

### Established Patterns
- Server actions for form submissions
- BullMQ workers for background jobs
- Drizzle ORM for DB queries
- ExcelJS recommended in CLAUDE.md

### Integration Points
- `src/app/(auth)/orders/` — Add shipping actions to existing order table
- `src/lib/jobs/` — Add invoice upload queue/worker
- `src/lib/marketplace/adapters/` — Implement uploadInvoice() for Coupang/Naver

</code_context>

<specifics>
## Specific Ideas

- 사방넷 끊기의 핵심 트리거: 송장 업로드가 안정적으로 동작해야 함
- 합포장 고도화: 출고편집코드 + 최대합포장수량은 사방넷 사용자의 핵심 요구

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>

---

*Phase: 03-shipping-invoice-processing*
*Context gathered: 2026-04-03*
