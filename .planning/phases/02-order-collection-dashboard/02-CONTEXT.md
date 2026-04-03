# Phase 2: Order Collection & Dashboard - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Automatic order collection from Coupang and Naver APIs on a schedule, unified order dashboard with full filtering, order status workflow management, claims collection, and order hold/release functionality. This is the core daily workflow that enables 사방넷 replacement.

</domain>

<decisions>
## Implementation Decisions

### Order Collection
- **D-01:** BullMQ + Redis for background job processing. Scheduled polling every 5-15 minutes per marketplace.
- **D-02:** Coupang and Naver adapters implement getOrders() and getClaimsOrders() methods from MarketplaceAdapter interface (Phase 1).
- **D-03:** Orders normalized to internal schema on collection. Raw marketplace data preserved for debugging.
- **D-04:** Deduplication via UPSERT on (marketplace_id, marketplace_order_id).

### Order Dashboard
- **D-05:** TanStack Table v8 for the order table — sorting, filtering, pagination, column visibility, row selection.
- **D-06:** nuqs for URL state management — table filters sync to URL query params (bookmark-friendly).
- **D-07:** Korean status labels: 신규, 확인, 출고대기, 출고완료, 배송중, 배송완료.
- **D-08:** Filters: marketplace, date range, status, product name, order number, buyer name.

### Claims
- **D-09:** Claims (cancel/return/exchange) collected alongside orders on same schedule.
- **D-10:** Claims shown in a separate tab or filter view on the order dashboard.

### Hold/Release
- **D-11:** Hold = flag + reason text. Release = remove flag, return to previous status.

### Claude's Discretion
- BullMQ worker deployment approach (separate process vs inline)
- Specific Coupang/Naver API endpoint selection
- Table column configuration and default visibility
- Pagination strategy (server-side vs client-side)
- Order detail view design

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Project vision, constraints
- `.planning/REQUIREMENTS.md` — v1 requirements (ORD-01~07, MKT-01~02 for this phase)
- `.planning/research/SUMMARY.md` — Research synthesis
- `.planning/research/STACK.md` — Technology recommendations (BullMQ, TanStack Table, etc.)
- `.planning/research/ARCHITECTURE.md` — System architecture patterns
- `.planning/research/PITFALLS.md` — Common mistakes (rate limits, auth expiry, etc.)

### Phase 1 Outputs (dependencies)
- `src/lib/marketplace/types.ts` — MarketplaceAdapter interface
- `src/lib/marketplace/registry.ts` — Adapter registry
- `src/lib/marketplace/errors.ts` — Typed error classes
- `src/lib/db/schema.ts` — Drizzle schema (marketplace_connections table)
- `src/lib/supabase/admin.ts` — Service-role client + Vault helpers
- `src/middleware.ts` — Auth middleware pattern

### Technology References
- `CLAUDE.md` — Full technology stack decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/marketplace/types.ts` — MarketplaceAdapter interface with getOrders(), authenticate(), etc.
- `src/lib/marketplace/registry.ts` — MarketplaceRegistry singleton for adapter lookup
- `src/lib/db/schema.ts` — Drizzle schema foundation
- `src/lib/db/index.ts` — Database connection
- `src/components/layout/sidebar.tsx` — Sidebar navigation (add 주문관리 active state)
- `src/components/ui/` — shadcn/ui components (badge, card, input, etc.)

### Established Patterns
- Drizzle ORM for DB queries
- Supabase SSR cookie auth
- Server actions for form submissions
- shadcn/ui + Tailwind CSS v4

### Integration Points
- `src/app/(auth)/` — Auth-gated route group
- Marketplace adapter registry — new Coupang/Naver adapters register here
- `src/lib/db/schema.ts` — Add orders, order_items, claims tables

</code_context>

<specifics>
## Specific Ideas

- 하루 500~2000건 주문 처리 가능한 성능
- 쿠팡 API rate limit: 10 req/sec, 네이버: 2 req/sec — BullMQ per-queue rate limiting 필수
- 쿠팡 HMAC-SHA256 인증, 네이버 OAuth2 + IP whitelist

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-order-collection-dashboard*
*Context gathered: 2026-04-03*
