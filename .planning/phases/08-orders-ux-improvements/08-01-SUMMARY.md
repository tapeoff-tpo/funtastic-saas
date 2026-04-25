---
phase: 08-orders-ux-improvements
plan: 01
subsystem: data-model + test-infra
tags: [migration, drizzle, types, vitest, tdd, red-stubs]
requires: []
provides:
  - orders.shipping_type + orders.shipping_fee columns
  - products.shipping_cost column
  - inquiries table (Phase 8 marketplace inquiries)
  - NormalizedOrder shippingType/shippingFee optional fields
  - NormalizedInquiry exported type
  - MarketplaceAdapter.getInquiries optional method
  - vitest setup with jest-dom matchers
  - 9 RED test stubs mapping SC-01..SC-07 + inquiry to Plan 02/03/04 GREEN targets
affects:
  - src/lib/db/schema.ts (orders + products + inquiries)
  - src/lib/marketplace/types.ts (NormalizedOrder + NormalizedInquiry + MarketplaceAdapter)
  - vitest.config.ts (setupFiles)
tech_stack:
  added: []
  patterns: ["drizzle pgTable", "supabase migration ALTER TABLE / CREATE TABLE", "vitest setupFiles", "RED stubs as Nyquist sampling"]
key_files:
  created:
    - supabase/migrations/011_add_order_shipping_info.sql
    - supabase/migrations/012_add_product_shipping_cost.sql
    - supabase/migrations/013_add_inquiries.sql
    - tests/setup.ts
    - tests/db/schema.test.ts
    - tests/orders/get-order-stats.test.ts
    - tests/orders/get-orders.test.ts
    - tests/orders/order-tabs.test.tsx
    - tests/orders/page-header.test.tsx
    - tests/orders/columns.test.tsx
    - tests/inventory/shipping-cost-edit.test.tsx
    - tests/marketplace/coupang/normalize.test.ts
    - tests/marketplace/coupang/inquiries.test.ts
    - .planning/phases/08-orders-ux-improvements/deferred-items.md
  modified:
    - src/lib/db/schema.ts
    - src/lib/marketplace/types.ts
    - vitest.config.ts
decisions:
  - "Inquiries table: unique on (user_id, marketplace_id, marketplace_inquiry_id) to allow per-tenant dedup; order_id ON DELETE SET NULL to keep inquiries after order delete"
  - "MarketplaceAdapter.getInquiries declared as optional method — non-supporting adapters (e.g., Naver in Phase 8) require zero changes"
  - "NormalizedOrder.shippingType typed as string|null at this stage — Plan 02 may normalize to enum (prepaid/cod/free/unknown)"
  - "Backfill of shipping fields deferred (NULL for existing rows) — matches RESEARCH § Pitfall 5 + § Backfill 결정"
  - "schema.test.ts uses typeof orders.shippingType (no `as any` cast) per W-2 — column removal triggers tsc failure before runtime"
metrics:
  duration: "4min"
  tasks: 3
  files: 14
  completed_date: "2026-04-25"
---

# Phase 08 Plan 01: Phase 8 데이터 모델 확장 + RED 테스트 인프라 Summary

Three SQL migrations (orders shipping fields, products shipping_cost, inquiries table) wired through Drizzle schema and marketplace types, plus vitest setup and 9 RED test stubs that grep-verifiably map every Phase 8 SC requirement to its target plan.

## What Was Done

### Task 1 — Migrations (commit `cebde1a`)

3개의 idempotent SQL 마이그레이션을 supabase/migrations/에 생성:

| File | Effect |
|------|--------|
| `supabase/migrations/011_add_order_shipping_info.sql` | `orders.shipping_type VARCHAR(50)` + `orders.shipping_fee NUMERIC(12,2)` (nullable, with `COMMENT ON COLUMN`) |
| `supabase/migrations/012_add_product_shipping_cost.sql` | `products.shipping_cost NUMERIC(12,2)` (nullable, with `COMMENT ON COLUMN`) |
| `supabase/migrations/013_add_inquiries.sql` | `inquiries` table + `inquiries_user_market_external_uniq` (UNIQUE) + `inquiries_order_id_idx` + `inquiries_user_marketplace_idx` |

All three use `IF NOT EXISTS` for idempotency. `inquiries.order_id` references `orders(id) ON DELETE SET NULL` to preserve inquiries when an order is deleted. No backfill SQL — existing rows stay NULL (Pitfall 5 + Backfill 결정).

### Task 2 — Schema sync + marketplace types (commit `1e24260`)

**`src/lib/db/schema.ts`:**
- `orders` pgTable: added `shippingType` (line 115) and `shippingFee` (line 117), keeping the existing index/PK callbacks intact.
- `products` pgTable: added `shippingCost` (line 408) as a nullable `numeric(12,2)`.
- New `inquiries` pgTable (lines 633-660): mirrors migration 013 1:1 — uuid PK, FK to orders with `set null`, `$type<Record<string, unknown>>().notNull().default({})` for raw_data, and the same three indexes as the migration.

**`src/lib/marketplace/types.ts`:**
- `NormalizedOrder` extended with optional `shippingType?: string | null` and `shippingFee?: number | null` (lines 84-87).
- New exported `NormalizedInquiry` interface (lines 91-100) with `inquiryType: 'product' | 'callcenter' | 'online'` matching Coupang's three inquiry kinds.
- `MarketplaceAdapter` extended with optional `getInquiries?(since: Date): Promise<NormalizedInquiry[]>` (line 187) — non-supporting adapters require zero changes.

**TypeScript verification:** `npx tsc --noEmit | grep -iE "shippingType|shippingFee|shippingCost|NormalizedInquiry|getInquiries|inquiries"` returns 0 matches → my changes introduce 0 new errors. Pre-existing project-wide tsc errors documented in `deferred-items.md`.

### Task 3 — vitest setup + 9 RED stubs (commit `2d967a0`)

**Setup:**
- `vitest.config.ts` line 8: `setupFiles: []` → `setupFiles: ['./tests/setup.ts']`.
- `tests/setup.ts`: registers `@testing-library/jest-dom/vitest` matchers (one-line file).

**Stub matrix (RED → GREEN traceability for downstream plans):**

| Stub file | SC IDs | Status now | GREEN target plan | Acceptance grep target |
|-----------|--------|------------|-------------------|------------------------|
| `tests/db/schema.test.ts` | SC-06, SC-07 | **GREEN** (Plan 01 satisfied it) | — | `typeof orders.shippingType === 'object'`, `typeof inquiries.marketplaceInquiryId === 'object'` |
| `tests/orders/get-order-stats.test.ts` | SC-01, SC-05 | RED | Plan 03 | `OrderStats` exported from `@/lib/orders/types` with `claimCancel`, `claimExchange`, `claimReturn`, `cancelTabCount` keys |
| `tests/orders/get-orders.test.ts` | SC-04 | RED | Plan 03 | `OrderListItem.items[number].displayName` field present |
| `tests/orders/order-tabs.test.tsx` | SC-01, SC-02 | RED | Plan 03 | `<OrderTabs counts={…} />` exported from `@/app/(auth)/orders/order-tabs` rendering 9 Korean labels |
| `tests/orders/page-header.test.tsx` | SC-02 | RED | Plan 03 | "엑셀 업로드" text + `href="/orders/import"` removed from `src/app/(auth)/orders/page.tsx` |
| `tests/orders/columns.test.tsx` | SC-03, SC-04, SC-06 | RED | Plan 03 | CS header/accessor removed; 배송구분 / 수집 배송비 / SaaS 배송비 columns added |
| `tests/inventory/shipping-cost-edit.test.tsx` | SC-07 | RED | Plan 04 | `updateShippingCost` symbol present in `src/app/(auth)/inventory/actions.ts` |
| `tests/marketplace/coupang/normalize.test.ts` | SC-06 (Coupang) | RED placeholder | Plan 02 | (todo only) — Plan 02 will replace with real assertions on shippingFee/Type extraction |
| `tests/marketplace/coupang/inquiries.test.ts` | inquiry | RED placeholder | Plan 02 | (todo only) — Plan 02 will replace with MSW-mocked Coupang `/v5/.../onlineInquiries` |

**W-2 compliance:** `grep -c "as any" tests/db/schema.test.ts` returns 0. The schema test uses `typeof orders.shippingType` (compile-time assertion) so removing a column triggers tsc failure before runtime.

**Vitest verification:**
```
npx vitest run tests/db/schema.test.ts tests/orders/page-header.test.tsx tests/orders/columns.test.tsx
→ Test Files  2 failed | 1 passed (3)
→ Tests       3 failed | 4 passed | 2 todo (9)
```
Exact intended state: schema.test.ts GREEN (Plan 01 made columns exist), page-header + columns RED (Plan 03 will make them GREEN).

## Acceptance Pattern Cheatsheet (for Plan 02/03/04 executors)

To turn each RED stub into GREEN, downstream plans need to satisfy:

```bash
# Plan 02 (Coupang normalize + inquiries)
grep -E "shippingFee|shippingType" src/lib/marketplace/adapters/coupang/adapter.ts
grep -E "getInquiries\(" src/lib/marketplace/adapters/coupang/adapter.ts

# Plan 03 (orders UI)
grep -E "엑셀 업로드|/orders/import" src/app/\(auth\)/orders/page.tsx   # → must return 0
grep -E "배송구분|수집 배송비|SaaS 배송비" src/app/\(auth\)/orders/columns.tsx
grep -E "OrderStats|claimCancel|claimExchange|cancelTabCount" src/lib/orders/types.ts
grep -E "displayName" src/lib/orders/types.ts                        # in OrderListItem.items
grep -E "OrderTabs" src/app/\(auth\)/orders/order-tabs.tsx           # new file

# Plan 04 (inventory shipping_cost)
grep -E "updateShippingCost" src/app/\(auth\)/inventory/actions.ts
```

## Deviations from Plan

None — plan executed exactly as written. Pre-existing tsc errors in unrelated files (cafe24/coupang adapter v7, reverse-collect, elevenst.test.ts, invoice-upload.test.ts, worker.ts) were discovered during the Task 2 `tsc --noEmit` verification but are out of scope per the executor's scope-boundary rule. They were logged to `deferred-items.md` for a separate quick task.

## Known Stubs

The 8 RED test stubs listed in the matrix above are intentional and tracked. They are not "stub data flowing to UI" — they are TDD scaffolding for downstream plans (a Nyquist sampling pattern explicitly requested by the plan). They will be turned GREEN in waves 2-3 by Plans 02/03/04.

## Verification

| Check | Result |
|-------|--------|
| 3 migrations exist + use `IF NOT EXISTS` | PASS |
| schema.ts has shippingType/Fee/Cost + inquiries pgTable | PASS |
| types.ts has NormalizedInquiry export + getInquiries optional method | PASS |
| vitest.config.ts setupFiles points to tests/setup.ts | PASS |
| All 9 stub files exist | PASS |
| schema.test.ts GREEN (4/4) | PASS |
| page-header.test.tsx + columns.test.tsx RED (intended) | PASS |
| `grep -c "as any" tests/db/schema.test.ts` returns 0 (W-2) | PASS |
| `tsc` introduces 0 new errors related to my changes | PASS |

## Self-Check: PASSED

All claimed files exist on disk:
- `supabase/migrations/011_add_order_shipping_info.sql` FOUND
- `supabase/migrations/012_add_product_shipping_cost.sql` FOUND
- `supabase/migrations/013_add_inquiries.sql` FOUND
- `tests/setup.ts` FOUND
- `tests/db/schema.test.ts` FOUND
- `tests/orders/get-order-stats.test.ts` FOUND
- `tests/orders/get-orders.test.ts` FOUND
- `tests/orders/order-tabs.test.tsx` FOUND
- `tests/orders/page-header.test.tsx` FOUND
- `tests/orders/columns.test.tsx` FOUND
- `tests/inventory/shipping-cost-edit.test.tsx` FOUND
- `tests/marketplace/coupang/normalize.test.ts` FOUND
- `tests/marketplace/coupang/inquiries.test.ts` FOUND

All claimed commits exist:
- `cebde1a` feat(08-01): add migrations for shipping info, product shipping cost, and inquiries table
- `1e24260` feat(08-01): sync drizzle schema + extend marketplace types for phase 8
- `2d967a0` test(08-01): vitest setup + 9 RED test stubs for SC-01..SC-07 + inquiry
