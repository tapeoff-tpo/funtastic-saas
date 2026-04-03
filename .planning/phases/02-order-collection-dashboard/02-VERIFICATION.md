---
phase: 02-order-collection-dashboard
verified: 2026-04-03T00:00:00Z
status: gaps_found
score: 4/5 success criteria verified
re_verification: false
gaps:
  - truth: "Orders from Coupang and Naver appear automatically in the system within 15 minutes of being placed on the marketplace"
    status: failed
    reason: "The BullMQ worker's createAdapter() function calls marketplaceRegistry.get(marketplaceId) which returns the Phase 1 STUB adapters from configs.ts — not the real CoupangAdapter or NaverAdapter. The stub getOrders() and getClaimsOrders() methods throw 'Not implemented yet (Phase 2)'. The real adapter classes (CoupangAdapter, NaverAdapter) were built in Plan 02 but are never instantiated in the worker. Credentials are read from Vault but discarded."
    artifacts:
      - path: "src/lib/jobs/workers/order-collector.ts"
        issue: "createAdapter() calls marketplaceRegistry.get() (returns Phase 1 stubs). Plan 03 spec explicitly required CoupangAdapter/NaverAdapter instances created with credentials — this was not implemented."
      - path: "src/lib/marketplace/adapters/configs.ts"
        issue: "Registry still contains Phase 1 stub adapters that reject all getOrders/getClaimsOrders calls with 'Not implemented yet (Phase 2)'"
    missing:
      - "createAdapter() in order-collector.ts must instantiate CoupangAdapter or NaverAdapter (from their respective adapter modules) using the credentials read from Vault, not return the registry stub"
      - "Import CoupangAdapter from '@/lib/marketplace/adapters/coupang/adapter' and NaverAdapter from '@/lib/marketplace/adapters/naver/adapter' in the worker"
      - "Switch statement or factory map: if marketplaceId === 'coupang' return new CoupangAdapter(credentials), if 'naver' return new NaverAdapter(credentials)"
human_verification:
  - test: "Full end-to-end order collection smoke test"
    expected: "After fixing the worker's createAdapter(), start Docker Redis and run npx tsx worker.ts with real Coupang/Naver credentials registered. Verify orders appear in the orders DB table within 5-15 minutes."
    why_human: "Requires live marketplace API credentials and a running Redis instance to validate the full collection pipeline"
  - test: "Order dashboard UI functional verification"
    expected: "Navigate to /orders — filters, pagination, status changes, hold/release, and claims tabs all respond correctly"
    why_human: "Visual and interaction correctness cannot be verified programmatically"
---

# Phase 2: Order Collection & Dashboard Verification Report

**Phase Goal:** Orders from Coupang and Naver are automatically collected on a schedule and displayed in a unified dashboard with filtering, status management, and claims handling
**Verified:** 2026-04-03
**Status:** gaps_found — 1 blocker gap
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Orders from Coupang and Naver appear automatically within 15 minutes | ✗ FAILED | Worker createAdapter() uses Phase 1 registry stubs that throw "Not implemented yet (Phase 2)" — real CoupangAdapter/NaverAdapter never invoked |
| 2 | Admin can view all orders in one table, filtering by marketplace, date, status, product name, order number, buyer name | ✓ VERIFIED | Full dashboard at /orders with TanStack Table, nuqs URL filters, server-side pagination via getOrders() |
| 3 | Admin can move orders through status workflow (신규->확인->출고대기->출고완료->배송중->배송완료) | ✓ VERIFIED | StatusDropdown uses VALID_TRANSITIONS, changeStatusAction calls updateOrderStatus with isValidTransition checks |
| 4 | Cancellation/return/exchange claims automatically collected and visible | ✓ VERIFIED | ClaimsFilter tabs (취소/반품/교환) query DB via claimType filter; collection pipeline calls getClaimsOrders — BUT claims will not actually populate until gap #1 is fixed |
| 5 | Admin can hold problematic order with reason and release back to normal flow | ✓ VERIFIED | HoldDialog with reason textarea calls holdOrderAction/releaseOrderAction; business logic correctly stores/restores previousStatus |

**Score:** 4/5 truths verified (Truth 1 blocked by worker wiring gap)

Note on Truth 4: The claims filter UI and DB logic are fully implemented, but claims data will remain empty in production until the worker gap is fixed. Marked VERIFIED for the collection/UI implementation but functionally dependent on Gap 1 resolution.

---

## Required Artifacts

### Plan 01 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/db/schema.ts` | ✓ VERIFIED | orders, order_items, claims, job_logs tables present with correct columns. Unique indexes on (marketplace_id, marketplace_order_id) and (marketplace_id, marketplace_claim_id). isHeld, holdReason, previousStatus columns present. |
| `src/lib/orders/types.ts` | ✓ VERIFIED | OrderStatus, ClaimType, ClaimStatus types; ORDER_STATUS_LABELS with all 7 Korean labels; VALID_TRANSITIONS map; isValidTransition() function; OrderFilters interface |
| `src/lib/orders/queries.ts` | ✓ VERIFIED | getOrders() with full filter support (status, marketplace, date, search, claimType, pagination, sort); getOrderById(); getOrderCount(); claimType join logic implemented |
| `src/lib/orders/actions.ts` | ✓ VERIFIED | updateOrderStatus() with transaction + FOR UPDATE lock; holdOrder() stores previousStatus; releaseOrder() restores previousStatus; bulkUpdateStatus(); all validate business rules |
| `src/lib/marketplace/types.ts` | ✓ VERIFIED | NormalizedOrder fully typed (no `[key: string]: unknown`); NormalizedOrderItem; NormalizedClaim; MarketplaceAdapter with getClaimsOrders() method |

### Plan 02 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/marketplace/adapters/coupang/adapter.ts` | ✓ VERIFIED | CoupangAdapter implements MarketplaceAdapter; getOrders() fetches from ordersheets endpoint; getClaimsOrders() fetches from returnRequests; normalizeOrder/normalizeClaim methods present |
| `src/lib/marketplace/adapters/coupang/client.ts` | ✓ VERIFIED | generateCoupangAuth() produces CEA algorithm=HmacSHA256 header; formatCoupangDatetime() uses 2-digit year; createCoupangClient() with beforeRequest HMAC hook; uses node:crypto createHmac |
| `src/lib/marketplace/adapters/naver/adapter.ts` | ✓ VERIFIED | NaverAdapter implements MarketplaceAdapter; two-step getOrders() (lastChangedStatuses + query); getClaimsOrders() with CLAIM_CHANGED_TYPES |
| `src/lib/marketplace/adapters/naver/client.ts` | ✓ VERIFIED | createNaverClient() with OAuth2 token caching; proactive 5-minute refresh buffer; Bearer auth header in beforeRequest hook |
| `tests/helpers/msw-handlers.ts` | ✓ VERIFIED | MSW handlers present for both Coupang and Naver endpoints |

### Plan 03 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/jobs/connection.ts` | ✓ VERIFIED | IORedis with maxRetriesPerRequest: null; REDIS_URL env var; error handler with clear message |
| `src/lib/jobs/queues.ts` | ✓ VERIFIED | orderCollectionQueue; scheduleOrderCollection() with 5-min repeat, jobId dedup; scheduleAllCollections() queries connected status; removeSchedule() |
| `src/lib/jobs/workers/order-collector.ts` | ✗ STUB/WIRED-WRONG | createAdapter() calls registry.get() returning Phase 1 stubs instead of real adapter instances. UPSERT logic, job logging, claims collection are all implemented correctly — the wiring to real adapters is the sole gap. |
| `worker.ts` | ✓ VERIFIED | BullMQ Worker created; processOrderCollection registered; scheduleAllCollections() on startup; SIGINT/SIGTERM graceful shutdown |
| `docker-compose.yml` | ✓ VERIFIED | Redis 7 Alpine with appendonly persistence |

### Plan 04 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/app/(auth)/orders/page.tsx` | ✓ VERIFIED | Server component with createSearchParamsCache; getOrders() called with parsed params; maps DB rows to OrderRow; renders ClaimsFilter + OrderFilters + DataTable |
| `src/app/(auth)/orders/data-table.tsx` | ✓ VERIFIED | useReactTable with manualPagination, manualSorting, manualFiltering; BulkActionBar wired to rowSelection; nuqs page/pageSize URL sync; column visibility toggle |
| `src/app/(auth)/orders/columns.tsx` | ✓ VERIFIED | All required columns: select checkbox, 주문번호, 마켓, 상품명, 구매자, 상태 (with 보류/claim badges), 주문일, 금액, actions (StatusDropdown + HoldDialog) |
| `src/app/(auth)/orders/filters.tsx` | ✓ VERIFIED | useQueryStates with marketplace, status, dateFrom, dateTo, search, page, pageSize; 300ms debounced search; reset button |

### Plan 05 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/app/(auth)/orders/actions.ts` | ✓ VERIFIED | 'use server'; changeStatusAction, holdOrderAction (validates non-empty reason), releaseOrderAction, bulkChangeStatusAction; all call revalidatePath('/orders') |
| `src/app/(auth)/orders/status-actions.tsx` | ✓ VERIFIED | StatusDropdown uses VALID_TRANSITIONS; disabled when isHeld; toast on success/error; BulkActionBar with bulk status dropdown |
| `src/app/(auth)/orders/hold-dialog.tsx` | ✓ VERIFIED | HoldDialog shows hold button or release button based on isHeld; reason textarea; calls holdOrderAction/releaseOrderAction with toast feedback |
| `src/app/(auth)/orders/claims-filter.tsx` | ✓ VERIFIED | Tab-style filter: 전체 주문 / 취소 / 반품 / 교환; nuqs claimType URL param |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `order-collector.ts` | `CoupangAdapter`/`NaverAdapter` | createAdapter() factory | ✗ NOT_WIRED | createAdapter() calls marketplaceRegistry.get() returning Phase 1 stubs — CoupangAdapter/NaverAdapter imports do not exist in this file |
| `order-collector.ts` | `orders` table (UPSERT) | onConflictDoUpdate on (marketplaceId, marketplaceOrderId) | ✓ WIRED | Line 203: .onConflictDoUpdate({ target: [orders.marketplaceId, orders.marketplaceOrderId] }) |
| `worker.ts` | `order-collector.ts` | new Worker('order-collection', processOrderCollection) | ✓ WIRED | Line 15: new Worker('order-collection', processOrderCollection, ...) |
| `orders/page.tsx` | `src/lib/orders/queries.ts` | getOrders() call | ✓ WIRED | Line 40: const { orders, total } = await getOrders({...}) |
| `orders/filters.tsx` | nuqs | useQueryStates with parseAsString/parseAsInteger | ✓ WIRED | Line 29: useQueryStates({status, marketplace, search, dateFrom, dateTo, page, pageSize}) |
| `orders/data-table.tsx` | @tanstack/react-table | useReactTable with getCoreRowModel | ✓ WIRED | Line 34: useReactTable({data, columns, getCoreRowModel(), manualPagination: true}) |
| `orders/actions.ts` | `src/lib/orders/actions.ts` | updateOrderStatus/holdOrder/releaseOrder calls | ✓ WIRED | All four server actions call the corresponding business logic functions |
| `orders/status-actions.tsx` | `orders/actions.ts` | changeStatusAction/bulkChangeStatusAction | ✓ WIRED | Lines 9: import { changeStatusAction, bulkChangeStatusAction } from './actions' |
| `orders/hold-dialog.tsx` | `orders/actions.ts` | holdOrderAction/releaseOrderAction | ✓ WIRED | Lines 4: import { holdOrderAction, releaseOrderAction } from './actions' |
| `coupang/client.ts` | `node:crypto` | createHmac('sha256', ...) | ✓ WIRED | Line 9: import { createHmac } from 'node:crypto'; Line 43: createHmac('sha256', secretKey) |
| `naver/client.ts` | OAuth2 token endpoint | ky.post(NAVER_TOKEN_URL, ...) | ✓ WIRED | Line 48: ky.post(NAVER_TOKEN_URL, { searchParams: { grant_type: 'client_credentials' } }) |
| `sidebar.tsx` | /orders route | nav item with href='/orders' | ✓ WIRED | Line 19: { href: '/orders', label: '주문관리', icon: ShoppingCart } |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `orders/page.tsx` | `orders`, `total` | `getOrders()` -> Drizzle SELECT from orders table | Real DB query present (will return empty until worker gap fixed) | ✓ FLOWING (DB connected, depends on Gap 1 for population) |
| `orders/data-table.tsx` | `data`, `total` | Props from page.tsx server component | Flows from real DB query | ✓ FLOWING |
| `order-collector.ts` | `normalizedOrders` | `adapter.getOrders(since)` | Returns stub rejection — never reaches UPSERT | ✗ DISCONNECTED (adapter not wired to real implementation) |

---

## Behavioral Spot-Checks

Step 7b: SKIPPED for server-dependent behavior (requires running Next.js + Redis + DB). TypeScript compilation check only.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly | `npx tsc --noEmit` | Not run (would require deps install) | ? SKIP — verify manually |
| Orders schema tables exist in schema.ts | `grep -c "pgTable('orders'" src/lib/db/schema.ts` | 1 match confirmed via Read | ✓ PASS |
| VALID_TRANSITIONS defined in types.ts | `grep "VALID_TRANSITIONS" src/lib/orders/types.ts` | Found at line 36 | ✓ PASS |
| Worker uses registry stubs (gap confirmed) | `grep "marketplaceRegistry.get" src/lib/jobs/workers/order-collector.ts` | Found at lines 34, 70 — confirms gap | ✗ FAIL |
| Real adapter imports missing from worker | `grep "CoupangAdapter\|NaverAdapter" src/lib/jobs/workers/order-collector.ts` | Zero matches | ✗ FAIL (confirms gap) |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ORD-01 | 02-03 | 연동된 마켓플레이스에서 주문을 자동으로 수집할 수 있다 (스케줄 기반) | ✗ BLOCKED | BullMQ scheduling infra exists and works; but worker calls stub adapters that throw "Not implemented yet". Automatic collection will fail at runtime. |
| ORD-02 | 02-04 | 모든 마켓플레이스의 주문을 하나의 통합 대시보드에서 조회할 수 있다 | ✓ SATISFIED | /orders page with DataTable displaying all marketplace orders |
| ORD-03 | 02-04 | 주문을 마켓플레이스, 날짜, 상태, 상품명, 주문번호, 구매자명으로 필터링/검색 | ✓ SATISFIED | OrderFilters component with all required filter types; getOrders() applies all filters server-side |
| ORD-04 | 02-01, 02-05 | 주문 상태를 관리할 수 있다 (신규→확인→출고대기→출고완료→배송중→배송완료) | ✓ SATISFIED | VALID_TRANSITIONS enforced in updateOrderStatus(); StatusDropdown shows only valid next states |
| ORD-05 | 02-03, 02-05 | 마켓플레이스에서 취소/반품/교환 클레임을 자동 수집할 수 있다 | ✗ BLOCKED | Claims collection calls adapter.getClaimsOrders() — same worker stub gap blocks runtime execution. UI filtering infrastructure exists. |
| ORD-06 | 02-01, 02-05 | 문제 주문을 보류 처리하고 사유를 기록할 수 있다 | ✓ SATISFIED | holdOrder() sets isHeld=true, stores holdReason and previousStatus; HoldDialog provides UI |
| ORD-07 | 02-01, 02-05 | 보류된 주문을 해제하고 정상 처리 흐름으로 복귀시킬 수 있다 | ✓ SATISFIED | releaseOrder() restores previousStatus, clears hold fields; HoldDialog shows release button |
| MKT-01 | 02-02 | 쿠팡 API 연동 (주문수집, 송장업로드, 상품등록) | ✓ SATISFIED (order collection scope) | CoupangAdapter with HMAC-SHA256 signing, getOrders(), getClaimsOrders() — invoice/product upload deferred to Phase 3/5 per plan |
| MKT-02 | 02-02 | 네이버 스마트스토어 API 연동 (주문수집, 송장업로드, 상품등록) | ✓ SATISFIED (order collection scope) | NaverAdapter with OAuth2 token management, two-step getOrders() pattern, getClaimsOrders() — invoice/product deferred |

**Coverage:** 9 requirements claimed. 7 satisfied, 2 blocked (ORD-01, ORD-05) by same root cause (worker adapter wiring gap).

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/jobs/workers/order-collector.ts` | 29-36 | createAdapter() ignores credentials parameter, returns stub adapter from registry | 🛑 Blocker | Prevents any order/claims collection — getOrders()/getClaimsOrders() will throw "Not implemented yet (Phase 2)" at runtime |
| `src/lib/marketplace/adapters/configs.ts` | 33-36, 63-66 | getOrders/getClaimsOrders return `notImplemented('getOrders')` | 🛑 Blocker | These are the stubs that the worker incorrectly calls |
| `src/lib/jobs/workers/order-collector.ts` | 125 | jobLog update on success uses INSERT + onConflictDoUpdate instead of UPDATE | ⚠️ Warning | Slightly unusual pattern — works correctly but reads oddly. Low impact. |

---

## Human Verification Required

### 1. Worker Adapter Fix Smoke Test

**Test:** After fixing `createAdapter()` to instantiate real adapters with credentials, start Docker Redis (`docker compose up -d`) and run `npx tsx worker.ts`. With at least one Coupang or Naver connection registered as 'connected', verify orders appear in the orders table after the 5-minute polling cycle.
**Expected:** Job log entry with status='completed', ordersCollected > 0 (if orders exist in the marketplace account)
**Why human:** Requires live marketplace API credentials, running Redis, and Supabase connection

### 2. Order Dashboard UI Verification

**Test:** Run `npm run dev`. Navigate to /orders.
**Expected:**
  - Orders table loads with header and empty state if no data
  - Sidebar shows "주문관리" link with active highlight on /orders
  - Marketplace and status dropdowns have correct Korean options
  - Date range inputs accept date values
  - Search input debounces (no request fired until 300ms after typing stops)
  - URL query params update when filters change (check browser address bar)
  - Pagination shows "이전" / "다음" and page count display
  - Claims filter tabs (전체 주문 / 취소 / 반품 / 교환) are clickable
**Why human:** Visual correctness and interaction behavior cannot be verified without rendering

### 3. Status/Hold Workflow with Test Data

**Test:** Insert test orders directly via Supabase dashboard, then use the /orders UI to:
  1. Change an order from 신규 to 확인
  2. Attempt an invalid transition (신규 -> 배송완료) — verify error toast appears
  3. Hold an order with a reason — verify 보류 badge appears
  4. Release the held order — verify it returns to previous status
  5. Select multiple orders and use bulk status change
**Expected:** All transitions work correctly; invalid transitions show error messages; hold/release preserves and restores previousStatus
**Why human:** Requires test data and interactive UI verification

---

## Gaps Summary

One blocker gap prevents the primary phase goal from being achieved:

**Gap: Worker uses Phase 1 stub adapters instead of real Coupang/Naver adapters**

The root cause is in `/src/lib/jobs/workers/order-collector.ts` lines 29-36. The `createAdapter()` function was specified in Plan 03 to create real `CoupangAdapter`/`NaverAdapter` instances with credentials, but the implementation instead calls `marketplaceRegistry.get(marketplaceId)` which returns the Phase 1 placeholder adapters from `configs.ts`. These placeholders explicitly throw `"Not implemented yet (Phase 2)"` for all `getOrders` and `getClaimsOrders` calls.

The fix is narrow and well-defined:
1. Import `CoupangAdapter` and `NaverAdapter` in `order-collector.ts`
2. Rewrite `createAdapter()` to instantiate the correct class based on `marketplaceId` using the credentials parameter (which is already being read from Vault correctly)

All other Phase 2 work is complete and high quality: the database schema, order business logic, both marketplace adapter implementations, the BullMQ scheduling infrastructure, and the full dashboard UI are all substantive and correctly wired. This single wiring disconnect is the only thing preventing the phase goal from being met.

---

_Verified: 2026-04-03_
_Verifier: Claude (gsd-verifier)_
