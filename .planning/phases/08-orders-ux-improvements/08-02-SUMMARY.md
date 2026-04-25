---
phase: 08-orders-ux-improvements
plan: 02
subsystem: marketplace-adapter + bullmq-worker
tags: [coupang, adapter, normalize, inquiries, bullmq, worker, tdd, green]
requires:
  - 08-01 (NormalizedOrder.shippingType/Fee + NormalizedInquiry types + inquiries pgTable + RED stubs)
provides:
  - Coupang normalizeOrder.shippingFee (number | null) from sheet.shippingPrice.units
  - Coupang normalizeOrder.shippingType enum (prepaid/cod/free/unknown) via normalizeCoupangShippingType
  - normalizeCoupangShippingType helper (exported, unit-tested with 9 parametric cases)
  - CoupangAdapter.getInquiries(since) -> NormalizedInquiry[] (online inquiries, v5)
  - CoupangOnlineInquiry + CoupangInquiriesResponse raw types
  - upsertInquiries(userId, marketplaceId, items) with ON CONFLICT + best-effort order_id resolution
  - listInquiriesByOrderIds(orderIds) for orders UI integration (Plan 03)
  - INQUIRY_QUEUE / InquiryJobData / processInquiryCollection / startInquiryWorker
  - inquiry-collection BullMQ worker registered in src/worker.ts boot + graceful shutdown
affects:
  - src/lib/marketplace/adapters/coupang/adapter.ts (helper export + normalizeOrder extension + getInquiries)
  - src/lib/marketplace/adapters/coupang/types.ts (deliveryChargeTypeName + CoupangOnlineInquiry/Response)
  - src/worker.ts (import + boot + shutdown of inquiry worker)
tech_stack:
  added: []
  patterns:
    - "Drizzle insert + onConflictDoUpdate on composite unique target (matches order-collector style)"
    - "BullMQ Queue + Worker with lazy connection (matches order-collection / invoice-upload workers)"
    - "Adapter resolution via direct class instantiation with Vault-resolved credentials (matches createAdapter switch in order-collector)"
    - "vi.mock with mutable response holder for parametric ky-client mocking"
key_files:
  created:
    - src/lib/orders/inquiry-queries.ts
    - src/workers/inquiry-worker.ts
  modified:
    - src/lib/marketplace/adapters/coupang/adapter.ts
    - src/lib/marketplace/adapters/coupang/types.ts
    - src/worker.ts
    - tests/marketplace/coupang/normalize.test.ts
    - tests/marketplace/coupang/inquiries.test.ts
decisions:
  - "shippingType enum mapping uses substring containment (s.includes('선불')) — covers '선불' and '선결제' from a single check + '무료배송' under '무료'. Per CONTEXT.md D-04, output is a fixed 4-value enum: prepaid|cod|free|unknown."
  - "shippingType source priority chain: deliveryChargeTypeName > parcelPrintMessage > shipmentType. deliveryChargeTypeName is the most semantic Korean label; the others are fallbacks Coupang sometimes populates instead."
  - "shippingFee falls back to NULL (not 0) when sheet.shippingPrice.units is missing — preserves '미수집' vs '0원 배송비' semantics per CONTEXT.md D-04."
  - "getInquiries KST formatter uses naive 'YYYY-MM-DDTHH:mm:ss' (no timezone suffix) — matches Coupang onlineInquiries doc convention; differs from getOrders (which uses 'YYYY-MM-DD+09:00') because the inquiry endpoint accepts datetimes, not date-only filters."
  - "Inquiry worker has NO repeatable schedule — Phase 8 scope per plan ends at '수집 가능'. The exported getInquiryQueue() lets admin/API/test code call .add() manually; repeatable scheduling is deferred to a follow-up."
  - "createInquiryAdapter switches on marketplaceId and instantiates CoupangAdapter directly (not via the order-collector createAdapter) because that factory's return type is Pick<MarketplaceAdapter, ...> excluding getInquiries. Plan explicitly permitted direct instantiation as a fallback when no inquiry-aware factory exists. Matches the same switch pattern used by order-collector."
  - "createInquiryAdapter returns null (not throw) for marketplaces without inquiry support — worker logs and skips with { skipped: true, reason }. Naver/etc. land here in Phase 8 without breaking the queue."
  - "inquiry-queries inserted/updated detection uses createdAt.getTime() === updatedAt.getTime() heuristic on the RETURNING row — exact within microseconds for fresh inserts, drifts apart on updates because onConflictDoUpdate sets updatedAt = NOW(). Acceptable for monitoring; not for accounting."
  - "All 3 task commits used --no-verify per orchestrator instruction (Wave 2 parallel executor active; pre-commit hooks risk lock contention; project tsc baseline already documented in deferred-items.md)."
metrics:
  duration: "~5 min"
  tasks: 3
  files: 7
  completed_date: "2026-04-26"
requirements_completed:
  - SC-06
  - inquiry
---

# Phase 08 Plan 02: Coupang Inquiry Adapter + BullMQ Worker Summary

Coupang adapter gains shippingFee/Type normalization (SC-06 data source) and a `getInquiries(since)` method hitting v5 onlineInquiries; a new BullMQ `inquiry-collection` worker drives `upsertInquiries` (ON CONFLICT dedup with best-effort order_id resolution) and is wired into the worker process boot + graceful shutdown.

## What Was Done

### Task 1 — Coupang normalizeOrder shipping fields (commit `68d5160`)

**Helper (exported):**
```ts
export function normalizeCoupangShippingType(
  raw: string | undefined | null,
): 'prepaid' | 'cod' | 'free' | 'unknown'
```
Substring matches: `'선불'|'선결제'` → `'prepaid'`, `'착불'` → `'cod'`, `'무료'` (covers `'무료배송'`) → `'free'`, default → `'unknown'`.

**Type extension:** `CoupangOrderSheet.deliveryChargeTypeName?: string` added (the order-item-level field is already present; Coupang sometimes surfaces it on the sheet).

**normalizeOrder return diff:**
```ts
shippingFee: typeof sheet.shippingPrice?.units === 'number' ? sheet.shippingPrice.units : null,
shippingType: normalizeCoupangShippingType(
  sheet.deliveryChargeTypeName ?? sheet.parcelPrintMessage ?? sheet.shipmentType,
),
```

**Test:** `tests/marketplace/coupang/normalize.test.ts` placeholder replaced with 9 `it.each` parametric cases — all pass; integration `it.todo` retained for downstream extension.

### Task 2 — getInquiries + inquiry-queries (commit `bcc13ee`)

**Adapter method:** `CoupangAdapter.getInquiries(since: Date): Promise<NormalizedInquiry[]>`
- Path: `v2/providers/openapi/apis/api/v5/vendors/{vendorId}/onlineInquiries?inquiryStartAt=...&inquiryEndAt=...&pageSize=50`
- KST datetime format `YYYY-MM-DDTHH:mm:ss` (URL-encoded)
- Maps `inquiryId → marketplaceInquiryId`, `content ?? title → question`, `inquiryRegisteredAt → requestedAt`, `orderId → marketplaceOrderId` (optional), full raw → `rawData`
- Empty `data` and missing `data` field both return `[]`
- Errors funnel through existing `MarketplaceApiError` pattern with response-body extraction

**Types appended to `coupang/types.ts`:** `CoupangOnlineInquiry` (with index signature for raw fields) + `CoupangInquiriesResponse`.

**`src/lib/orders/inquiry-queries.ts` (new):**

| Export | Signature | Behavior |
|--------|-----------|----------|
| `upsertInquiries` | `(userId, marketplaceId, items: NormalizedInquiry[]) → { inserted, updated }` | Per item: SELECT orders for `(user, marketplace, marketplace_order_id)` to resolve `order_id` (NULL on miss). INSERT INTO inquiries with `onConflictDoUpdate(target=[user_id, marketplace_id, marketplace_inquiry_id], set={answeredAt, rawData, updatedAt=NOW()})`. RETURNING + createdAt==updatedAt → counts. |
| `listInquiriesByOrderIds` | `(orderIds: string[]) → inquiries[]` | Bulk fetch via `inArray(inquiries.orderId, orderIds)`. Empty input → `[]` short-circuit. |

**Test:** `tests/marketplace/coupang/inquiries.test.ts` placeholder replaced with 4 GREEN scenarios (populated response, empty array, missing data field, content/title fallback). MSW not used — `vi.mock` of `client` with a mutable `coupangResponse` holder is sufficient and faster.

### Task 3 — inquiry-collection worker (commit `f8e36b7`)

**`src/workers/inquiry-worker.ts` (new):**

```ts
export const INQUIRY_QUEUE = 'inquiry-collection'
export interface InquiryJobData { userId: string; marketplaceId: string; since: string }
export type InquiryJobResult =
  | { skipped: true; reason: string }
  | { fetched: number; inserted: number; updated: number }

export function getInquiryQueue(): Queue<InquiryJobData>
export async function processInquiryCollection(job: Job<InquiryJobData>): Promise<InquiryJobResult>
export function startInquiryWorker(): Worker<InquiryJobData, InquiryJobResult>
```

`createInquiryAdapter(userId, marketplaceId)` switch:
- `'coupang'` → reads `access_key/secret_key/vendor_id` via `readCredential` (Supabase Vault) → `new CoupangAdapter(...)`
- `default` → returns `null` (worker skips silently — Naver, 11st, etc. in Phase 8)

If adapter present but `!adapter.getInquiries` → also skipped with reason. `processInquiryCollection` calls `adapter.getInquiries(since)` then `upsertInquiries(userId, marketplaceId, fetched)`.

`startInquiryWorker()` constructs `Worker(INQUIRY_QUEUE, processInquiryCollection, { connection: getConnection(), concurrency: 2 })` with `completed/failed/error` listeners (mirrors order-collector logging style).

**`src/worker.ts` integration:**
- Import: `import { startInquiryWorker } from './workers/inquiry-worker'`
- Boot: `const inquiryWorker = startInquiryWorker()` alongside orderWorker + invoiceWorker
- Shutdown: `inquiryWorker.close()` added to the `Promise.all` in the SIGTERM/SIGINT handler

No repeatable scheduling — Phase 8 ends at "수집 가능". Manual `.add()` available via `getInquiryQueue()`.

## Acceptance Criteria — Verified

| Task | Criterion | Result |
|------|-----------|--------|
| 1 | `grep -n "export function normalizeCoupangShippingType" adapter.ts` | line 50 ✅ |
| 1 | `grep -n "shippingFee:"` inside normalizeOrder | line 478 ✅ |
| 1 | `grep -n "shippingType:"` inside normalizeOrder | line 480 ✅ |
| 1 | `npx vitest run tests/marketplace/coupang/normalize.test.ts` | 9 passed, 1 todo ✅ |
| 1 | `npx tsc --noEmit \| grep shipping*` | 0 new errors ✅ |
| 2 | `grep -n "async getInquiries(since: Date)" adapter.ts` | line 183 ✅ |
| 2 | `grep -n "onlineInquiries" adapter.ts` | line 196 ✅ |
| 2 | `grep -n "export interface CoupangOnlineInquiry" types.ts` | line 112 ✅ |
| 2 | `grep -n "export async function upsertInquiries" inquiry-queries.ts` | line 19 ✅ |
| 2 | `grep -n "onConflictDoUpdate" inquiry-queries.ts` | line 59 ✅ |
| 2 | `grep -n "export async function listInquiriesByOrderIds" inquiry-queries.ts` | line 93 ✅ |
| 2 | inquiries.test.ts GREEN | 4/4 passed ✅ |
| 3 | `grep -n "export const INQUIRY_QUEUE = 'inquiry-collection'"` | line 25 ✅ |
| 3 | `grep -n "export function startInquiryWorker"` | line 115 ✅ |
| 3 | `grep -n "upsertInquiries"` in worker | line 99 ✅ |
| 3 | `grep -n "startInquiryWorker"` in src/worker.ts | lines 20, 42 ✅ |
| 3 | `npx tsc --noEmit \| grep inquiry*` | 0 new errors ✅ |
| 3 | Adapter factory resolves to real export | `CoupangAdapter` at adapter.ts:63 ✅ |

## Acceptance Pattern Cheatsheet (for Plan 03 — Orders UI)

Plan 03 will consume `listInquiriesByOrderIds` to attach inquiry indicators to order rows:

```ts
import { listInquiriesByOrderIds } from '@/lib/orders/inquiry-queries'

// in getOrders / getOrderRows after assembling orderIds[]
const inquiriesByOrder = new Map<string, typeof inquiries.$inferSelect[]>()
for (const inq of await listInquiriesByOrderIds(orderIds)) {
  if (!inq.orderId) continue
  const arr = inquiriesByOrder.get(inq.orderId) ?? []
  arr.push(inq)
  inquiriesByOrder.set(inq.orderId, arr)
}
// Attach to row: row.inquiries = inquiriesByOrder.get(row.id) ?? []
```

The first column (claims indicator, per SC-03) checks `row.inquiries.length > 0` to render the inquiry icon next to claim badges.

## Deviations from Plan

None — plan executed exactly as written. Notes:
- **No new tsc errors introduced.** Project-wide tsc baseline (cafe24/coupang adapter v7, reverse-collect, elevenst.test.ts, invoice-upload.test.ts, worker.ts) is pre-existing per `deferred-items.md` and not affected by this plan.
- **Pre-existing worktree test failure** at `.claude/worktrees/infallible-pike/tests/marketplace/coupang.test.ts:139` (`recipientPhone` undefined) is unrelated to this plan — that test file lives in a separate worktree and is not part of `tests/marketplace/coupang/`.
- **All commits used `--no-verify`** per orchestrator instruction (Wave 2 parallel executor active; risk of pre-commit hook lock contention).

## Authentication Gates

None — no auth required during execution (test runs use mocked client, no live Coupang API calls).

## Known Stubs / TODOs

- **Naver inquiry collection** — explicitly deferred per CONTEXT.md D-03 ("Phase 8에서는 Coupang inquiry만 구현. Naver inquiry는 phase 종료 후 별도 quick task로 분리"). The `createInquiryAdapter` switch returns `null` for `'naver'`, the worker skips with `{ skipped: true }`, and the queue tolerates the no-op without error. When Naver inquiry adapter lands, add a `case 'naver':` arm.
- **Repeatable scheduling for inquiry collection** — intentionally NOT added in this plan (Phase 8 scope ends at "수집 가능"). Follow-up: extend `scheduleAllCollections()` in `src/lib/jobs/queues.ts` (or add a parallel `scheduleAllInquiries()`) to register repeatable jobs per marketplace_connection.
- **Other Coupang inquiry kinds** (`product` and `callcenter`) — `NormalizedInquiry.inquiryType` enum already supports them but only `'online'` is wired. Add additional endpoints (`/v5/.../productInquiries`, contact center variant) by extending `getInquiries` to fan out across kinds, or add separate methods.

## Verification

| Check | Result |
|-------|--------|
| `tests/marketplace/coupang/normalize.test.ts` GREEN (9 + 1 todo) | PASS |
| `tests/marketplace/coupang/inquiries.test.ts` GREEN (4) | PASS |
| 3 atomic per-task commits exist (`68d5160`, `bcc13ee`, `f8e36b7`) | PASS |
| `src/workers/inquiry-worker.ts` exists with required exports | PASS |
| `src/worker.ts` imports + boots + closes inquiry worker | PASS |
| `src/lib/orders/inquiry-queries.ts` exists with both exports | PASS |
| `npx tsc --noEmit` introduces 0 new errors related to my changes | PASS |
| All Wave 1 RED test stubs (Plan 01) for normalize/inquiries → GREEN | PASS |

## Self-Check: PASSED

Files claimed:
- `src/lib/marketplace/adapters/coupang/adapter.ts` — modified (FOUND)
- `src/lib/marketplace/adapters/coupang/types.ts` — modified (FOUND)
- `src/lib/orders/inquiry-queries.ts` — created (FOUND)
- `src/workers/inquiry-worker.ts` — created (FOUND)
- `src/worker.ts` — modified (FOUND)
- `tests/marketplace/coupang/normalize.test.ts` — modified (FOUND)
- `tests/marketplace/coupang/inquiries.test.ts` — modified (FOUND)

Commits claimed (all present in git log):
- `68d5160` feat(08-02): extend Coupang normalizeOrder with shippingFee + shippingType enum
- `bcc13ee` feat(08-02): implement Coupang getInquiries + inquiry-queries upsert
- `f8e36b7` feat(08-02): add BullMQ inquiry-collection worker + register in worker.ts
