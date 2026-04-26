---
phase: 08-orders-ux-improvements
verified: 2026-04-26T09:50:00Z
status: passed
score: 8/8 must-haves verified
re_verification: null
---

# Phase 8: 주문관리 UX 개선 — Verification Report

**Phase Goal:** 주문관리 화면이 사방넷 대체에 충분히 직관적 — 클레임 상태가 한눈에 보이고, 매핑된 상품명이 표시되며, 단계별 필터가 명확히 동작하고, 배송구분/배송비가 명확히 보인다

**Verified:** 2026-04-26
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| #  | Truth (SC) | Status     | Evidence (canonical paths) |
| -- | --------- | ---------- | -------------------------- |
| 1  | SC-01: 취소 탭 정확한 카운트 + 클릭 시 취소 클레임 주문 필터 | ✓ VERIFIED | `order-tabs.tsx:46` 취소 탭 (`kind: 'cancel'`, `accent: 'text-red-600'`); `queries.ts:659` `countDistinct(orders.id)` cancelTab DISTINCT OR query; `queries.ts:95` `if (filters.cancelTab)` server-side WHERE filter; `page.tsx:66` `cancelTab: params.cancel ?? undefined` forwarded |
| 2  | SC-02: 엑셀 업로드 진입점 제거 + 단계별 탭 대체 | ✓ VERIFIED | `page.tsx`: 엑셀 업로드 link/import 0개 (only the comment "Excel import entry-point removed in Phase 8" mentions it); `OrderTabs` 컴포넌트 9탭 (전체/신규/확인/출고대기/출고완료/배송중/배송완료/취소/교환/반품) — `order-tabs.tsx:38-49` |
| 3  | SC-03: 별도 CS 컬럼 없이 클레임/문의 인디케이터 첫 컬럼 통합 | ✓ VERIFIED | `columns.tsx`: `header: 'CS'` 0개, `id: 'cs'` 0개 (`grep -cE`); `columns.tsx:241` `order.hasInquiries && <MessageCircle.../>`; `columns.tsx:248` `order.holdReason` 미발송 보존 (Pitfall 3); `columns.tsx:5` `import { MessageCircle, Lock } from 'lucide-react'` |
| 4  | SC-04: 매핑 상품 displayName 우선 표시 | ✓ VERIFIED | `queries.ts:215-219` `leftJoin(productNameMappings ON userId+marketplaceId+marketplaceName)` (Pitfall 2 marketplaceId 매칭 포함); `columns.tsx:356` `primaryName = first.displayName ?? first.productName` fallback; `columns.tsx:357` `showOriginal` 보조 표시 |
| 5  | SC-05: 단계별 필터 카운트 정확 | ✓ VERIFIED | `getOrderStats` (queries.ts:645+) 5 parallel queries: status GROUP BY (single SQL), claim GROUP BY claimType, cancelTabCount distinct, total, held; `page.tsx:110-122` `orderTabsCounts` 매핑 — `cancelled: stats.cancelTabCount` |
| 6  | SC-06: 배송구분 + 수집 배송비 + SaaS 배송비 3개 컬럼 | ✓ VERIFIED | `schema.ts:115` `shippingType varchar(50)`, `schema.ts:117` `shippingFee numeric(12,2)`, `schema.ts:408` `shippingCost numeric(12,2)`; `columns.tsx:476` `header: '배송구분'`, `columns.tsx:491` `header: '수집 배송비'`, `columns.tsx:510` `header: 'SaaS 배송비(원가)'`; `coupang/adapter.ts:528` `shippingFee:` from `sheet.shippingPrice.units`, `:530` `shippingType: normalizeCoupangShippingType(...)` enum mapping |
| 7  | SC-07: 재고관리 shipping_cost 입력/수정 가능 | ✓ VERIFIED | `inventory/actions.ts:110` `export async function updateShippingCost(productId, value)` with userId scope; `inventory/inventory-table.tsx:72` `function ShippingCostCell` (useState draft + useTransition + onBlur server action); `:323` `header: 'SaaS 배송비(원가)'`; `:107` `await updateShippingCost(productId, num)` |
| 8  | inquiry 수집 (Coupang) | ✓ VERIFIED | `coupang/adapter.ts:183` `async getInquiries(since: Date)`; `:196` v5 `onlineInquiries` endpoint; `src/lib/orders/inquiry-queries.ts` exports `upsertInquiries` + `listInquiriesByOrderIds`; `src/workers/inquiry-worker.ts` `INQUIRY_QUEUE` + `startInquiryWorker`; `src/worker.ts:20,42` boot + shutdown integration |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/migrations/011_add_order_shipping_info.sql` | orders.shipping_type + shipping_fee | ✓ VERIFIED | Idempotent `IF NOT EXISTS`, COMMENT ON COLUMN both fields |
| `supabase/migrations/012_add_product_shipping_cost.sql` | products.shipping_cost | ✓ VERIFIED | Idempotent, COMMENT |
| `supabase/migrations/013_add_inquiries.sql` | inquiries table + indexes | ✓ VERIFIED | UUID PK, FK to orders ON DELETE SET NULL, composite UNIQUE on (user_id, marketplace_id, marketplace_inquiry_id), 2 secondary indexes |
| `src/lib/db/schema.ts` | shippingType/Fee on orders, shippingCost on products, inquiries pgTable | ✓ VERIFIED | Lines 115, 117, 408 confirmed |
| `src/lib/marketplace/types.ts` | NormalizedOrder.shippingType/Fee + NormalizedInquiry + getInquiries optional | ✓ VERIFIED | Per Plan 01 SUMMARY (lines 84-87, 91-100, 187) |
| `src/lib/marketplace/adapters/coupang/adapter.ts` | normalizeOrder shippingFee/Type + getInquiries | ✓ VERIFIED | Lines 52, 183, 196, 528, 530 |
| `src/lib/orders/inquiry-queries.ts` | upsertInquiries + listInquiriesByOrderIds | ✓ VERIFIED | Plan 02 verified |
| `src/workers/inquiry-worker.ts` | INQUIRY_QUEUE + startInquiryWorker | ✓ VERIFIED | Plan 02 verified |
| `src/worker.ts` | inquiry worker boot + shutdown | ✓ VERIFIED | Lines 20, 42 |
| `src/lib/orders/queries.ts` | getOrderStats expanded + getOrders displayName join + cancelTab + hasInquiries | ✓ VERIFIED | Lines 9, 10, 15, 95, 215-219, 242, 645+, 651, 659 |
| `src/lib/orders/types.ts` | OrderStats expanded + OrderListItem extended + OrderFilters.cancelTab | ✓ VERIFIED | Lines 84, 91, 101-103, 109, 163 |
| `src/app/(auth)/orders/page.tsx` | OrderTabs render + 엑셀업로드 제거 + cancel parser | ✓ VERIFIED | Lines 13, 37, 66, 134-137 |
| `src/app/(auth)/orders/order-tabs.tsx` | NEW 9탭 컴포넌트 | ✓ VERIFIED | 137 lines, nuqs mutual-exclusion, 9 labels |
| `src/app/(auth)/orders/columns.tsx` | CS 컬럼 제거 + 인디케이터 + displayName + 배송 3컬럼 | ✓ VERIFIED | 558 lines (was ~389 before phase 8) |
| `src/app/(auth)/inventory/actions.ts` | updateShippingCost server action | ✓ VERIFIED | Line 110 |
| `src/app/(auth)/inventory/inventory-table.tsx` | ShippingCostCell + column | ✓ VERIFIED | Lines 72, 107, 323, 325 |
| `src/lib/inventory/queries.ts` | productId + shippingCost in select | ✓ VERIFIED | Per Plan 04 SUMMARY |
| `vitest.config.ts` + `tests/setup.ts` | jsdom env + jest-dom matchers | ✓ VERIFIED | Plan 01 verified |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `OrdersPage` | `OrderTabs` | import + render `<OrderTabs counts={orderTabsCounts}/>` | WIRED | page.tsx:13 import, :136 render |
| `OrdersPage` | `getOrderStats` | direct call in `Promise.all` | WIRED | page.tsx:68 |
| `OrdersPage` | `getOrders` | `cancelTab: params.cancel` propagated | WIRED | page.tsx:66 |
| `getOrders` | `productNameMappings` | leftJoin in items query | WIRED | queries.ts:215-219 |
| `getOrders` | `listInquiriesByOrderIds` | post-fetch enrichment | WIRED | queries.ts:242, hasInquiries:387 |
| `columns.tsx` | `OrderRow.shippingType/Fee/hasInquiries/items[].displayName/shippingCost` | render cells | WIRED | columns.tsx 241, 356, 478, 493, 513 |
| `inventory-table.tsx` | `updateShippingCost` server action | onBlur via useTransition | WIRED | inventory-table.tsx:107 |
| `coupang/adapter.ts` (`normalizeOrder`) | `shippingPrice.units` / `deliveryChargeTypeName` | extraction → NormalizedOrder.shippingFee/Type | WIRED | adapter.ts:528, 530 |
| `worker.ts` | `startInquiryWorker` | import + boot + close | WIRED | worker.ts:20, 42 |
| `processInquiryCollection` | `upsertInquiries` | direct call | WIRED | per Plan 02 SUMMARY adapter.ts:99 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `OrderTabs` | `counts` prop | `getOrderStats(user.id)` → 5 parallel SQL queries (status/claim/cancelTab/total/held GROUP BY) → mapped to `orderTabsCounts` in page.tsx:110-122 | YES — DB-driven counts | ✓ FLOWING |
| `DataTable` | `data` prop (OrderRow[]) | `getOrders(...)` → main select + items multi-join + listInquiriesByOrderIds → mapped at page.tsx:71-107 | YES — full DB select with joins | ✓ FLOWING |
| `ShippingCostCell` | `value` prop | `getInventoryList()` selects `products.shippingCost` → page.tsx forwards as `shippingCost` → InventoryTable cell | YES — DB column | ✓ FLOWING |
| `columns shippingType/Fee` | `row.original.shippingType/Fee` | `orders.shippingType`/`shippingFee` populated via Coupang `normalizeOrder` extracting `sheet.shippingPrice.units` + `deliveryChargeTypeName` | YES — adapter normalize → DB | ✓ FLOWING (NEW orders only — existing rows NULL per Plan 01 backfill 결정) |
| `columns hasInquiries indicator` | `row.original.hasInquiries` | `listInquiriesByOrderIds(orderIds)` → `inquirySet.has(o.id)` → row.hasInquiries | YES — DB-driven (will be empty until inquiry worker runs in production) | ✓ FLOWING (data path complete; production data collected by `inquiry-collection` BullMQ queue) |

**Note on shipping/inquiry data flow:** Schema, adapter, queries, worker, and UI are all wired. New orders collected post-deployment will populate the columns. Existing rows show NULL — this matches the explicit Plan 01 decision (deferred-items.md backfill 결정).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase 8 canonical test suite GREEN | `npx vitest run tests/orders/{get-order-stats,get-orders,order-tabs,page-header,columns}.test.* tests/inventory/shipping-cost-edit.test.tsx tests/marketplace/coupang/{normalize,inquiries}.test.ts tests/db/schema.test.ts --reporter=dot` | 9 files passed, 41 tests passed, 1 todo | ✓ PASS |
| Next.js build | `npm run build` | Compiled successfully; all routes including `/orders`, `/inventory`, `/orders/import` (page kept, header link removed) | ✓ PASS |
| CS column absent | `grep -cE "header: 'CS'\|id: 'cs'" columns.tsx` | 0 | ✓ PASS |
| 엑셀 업로드 link absent in page header | `grep -cE "엑셀 업로드\|/orders/import" page.tsx` | 1 hit only inside the descriptive comment "Excel import entry-point removed" — no actual import/link | ✓ PASS |
| 9 Korean tab labels rendered | `grep -E "신규\|확인\|출고대기\|출고완료\|배송중\|배송완료\|취소\|교환\|반품" order-tabs.tsx` | All 9 labels at TABS const (lines 39-48) | ✓ PASS |
| Schema columns present at runtime | `grep -nE "shippingType\|shippingFee\|shippingCost" schema.ts` | Lines 115, 117, 408 | ✓ PASS |
| Inquiry worker registered | `grep -nE "INQUIRY_QUEUE\|startInquiryWorker" worker.ts` | Lines 20, 42 | ✓ PASS |

### Requirements Coverage

| Req ID | Source | Description | Status | Evidence |
| ------ | ------ | ----------- | ------ | -------- |
| SC-01 | ROADMAP | 취소 탭 카운트 + 필터 | SATISFIED | OrderTabs cancel tab + cancelTabCount + cancelTab WHERE clause |
| SC-02 | ROADMAP | 엑셀 업로드 제거 + 단계별 탭 | SATISFIED | page.tsx no link/import; OrderTabs 9 labels |
| SC-03 | ROADMAP | CS 컬럼 제거 + 인디케이터 통합 | SATISFIED | columns.tsx CS 컬럼 0건; MessageCircle 문의/Lock 미발송/holdReason 보조 모두 통합 |
| SC-04 | ROADMAP | displayName 우선 표시 | SATISFIED | queries.ts leftJoin productNameMappings on (userId+marketplaceId+marketplaceName); columns.tsx fallback `displayName ?? productName` + 원본명 grey 보조 |
| SC-05 | ROADMAP | 단계별 필터 카운트 정확 | SATISFIED | getOrderStats single GROUP BY for status, distinct OR for cancelTab |
| SC-06 | ROADMAP | 배송 3컬럼 + 스키마 | SATISFIED | orders.shipping_type/fee + products.shipping_cost columns + 3 column renderers + Coupang normalize |
| SC-07 | ROADMAP | 재고관리 shipping_cost 입력 | SATISFIED | products.shipping_cost + updateShippingCost server action + ShippingCostCell inline edit |
| inquiry | CONTEXT D-03 | Coupang inquiry 수집 (Naver 별도 deferred) | SATISFIED | getInquiries v5 onlineInquiries + upsertInquiries + BullMQ inquiry-collection worker registered |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `src/app/(auth)/orders/stage-tabs.tsx` | 1 | `export {}` deprecation stub | INFO | Intentional deprecation per Plan 03 decisions; no external importers; can be deleted in follow-up |
| `src/app/(auth)/orders/claims-filter.tsx` | 1 | `export {}` deprecation stub | INFO | Same — intentional |
| Pre-existing tsc errors (cafe24, coupang adapter v7, reverse-collect, etc.) | various | Various | INFO | Documented in `deferred-items.md` baseline; not introduced by Phase 8 |
| Pre-existing test failures (claims-collector, order-collector, marketplace/coupang.test.ts legacy file, naver, elevenst, ohouse, invoice-worker) | tests/* | Stale fixtures / type drift | INFO | Pre-existing baseline (per deferred-items.md); none touched by Phase 8 plans; Phase 8 canonical 9 test files all GREEN |

No blocker anti-patterns. No stub/placeholder data flowing to UI for Phase 8 surface area.

### Human Verification Required

While automated checks all pass, the following items per VALIDATION.md "Manual-Only Verifications" benefit from sign-off in production environment:

1. **9탭 click-through 카운트 일관성** (SC-01, SC-05) — open `/orders`, click each of 9 tabs; verify URL changes (`?status=…`, `?cancel=true`, `?claimType=exchange|return`) and table results match counts.
2. **displayName 우선순위 시각 확인** (SC-04) — open an order with mapped product (displayName populated) and one without; verify mapped row shows displayName as primary + 원본명 in grey, unmapped row shows original name only.
3. **재고관리 shipping_cost 새로고침 후 유지** (SC-07) — `/inventory` 행 shipping_cost 입력 → 새로고침 → 값 유지 확인.
4. **Coupang inquiry 실제 수집** — `inquiry-collection` queue에 실제 vendor credentials로 job dispatch 후 inquiries 테이블에 row 생성 확인.

These are observability/UX confirmations, not gating defects.

### Gaps Summary

None. Every Success Criterion (SC-01 through SC-07) is satisfied by code that exists, is wired, and is exercised by passing canonical tests. The inquiry collection scope is implemented for Coupang only per the explicit CONTEXT.md D-03 decision; Naver inquiry is documented as a follow-up quick task and not part of Phase 8 scope.

The only "incomplete" element — existing orders/products having NULL shipping fields — is intentional per Plan 01 backfill 결정 (deferred-items.md). New orders collected post-deployment will populate the columns via the wired Coupang `normalizeOrder` path.

---

## Verdict: PASS — Phase 8 Goal Achieved

All 8 must-haves verified. All 7 Success Criteria satisfied. Inquiry scope (Coupang) satisfied. Build green; Phase 8 test suite green.

**Phase 8 may be marked complete in ROADMAP.md.**

Pre-existing baseline issues (tsc + test failures in unrelated files) remain documented in `deferred-items.md` and are out of Phase 8 scope.

---

_Verified: 2026-04-26 09:50 UTC_
_Verifier: Claude (gsd-verifier)_
