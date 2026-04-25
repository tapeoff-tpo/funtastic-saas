---
phase: 08-orders-ux-improvements
plan: 04
subsystem: inventory-ui
tags: [server-action, drizzle, useTransition, sonner, tdd, inline-edit]
requires:
  - 08-01 (products.shipping_cost migration 012 + drizzle field + RED stub)
provides:
  - updateShippingCost(productId, value | null) server action with userId scope + input validation
  - ShippingCostCell inline-edit component (draft → onBlur → server action → toast)
  - InventoryTable 'SaaS 배송비(원가)' column
  - queries.getInventoryList now returns productId + shippingCost
affects:
  - src/app/(auth)/inventory/actions.ts (added updateShippingCost)
  - src/app/(auth)/inventory/inventory-table.tsx (added ShippingCostCell + new column + InventoryRow type)
  - src/app/(auth)/inventory/page.tsx (forward productId + shippingCost)
  - src/lib/inventory/queries.ts (select products.id + products.shippingCost)
tech_stack:
  added: []
  patterns:
    - "shadcn Input + sonner toast (이미 확립된 stack 재사용)"
    - "useState draft + useTransition + onBlur server action"
    - "drizzle update with userId+id scope (RLS 패턴)"
    - "useEffect로 외부 value 변경 시 draft sync (revalidatePath 후 표시 일치)"
key_files:
  created:
    - .planning/phases/08-orders-ux-improvements/08-04-SUMMARY.md
  modified:
    - src/app/(auth)/inventory/actions.ts
    - src/app/(auth)/inventory/inventory-table.tsx
    - src/app/(auth)/inventory/page.tsx
    - src/lib/inventory/queries.ts
    - tests/inventory/shipping-cost-edit.test.tsx
key_decisions:
  - "ShippingCostCell를 inventory-table.tsx 내부에 co-locate (별도 파일 분리하지 않음) — StockCell과 동일한 모듈 패턴 일관성"
  - "Empty input → null로 매핑 (배송비 미설정 상태 표현). '0'은 명시적 0원 (무료배송)으로 구분 가능"
  - "queries.getInventoryList에 productId 신설 — 기존 id 컬럼은 COALESCE(inventory.id, products.id)로 row key 용도, productId는 server action 호출용 stable identifier"
  - "useEffect로 initial value를 draft에 sync — revalidatePath('/inventory') 후 server-rendered value가 변경됐을 때 stale draft를 갱신"
  - "drizzle .set({ shippingCost: String(value) }) — drizzle numeric 컬럼이 string 인터페이스 (Plan 01 schema와 일치)"
requirements_completed:
  - SC-07
metrics:
  duration: "~3 min"
  tasks: 1
  files_modified: 4
  files_created: 0
  test_files_modified: 1
  completed_date: "2026-04-26"
---

# Phase 08 Plan 04: 재고관리 shipping_cost 인라인 편집 Summary

`/inventory` 화면에 상품별 SaaS 배송비(원가) 컬럼을 추가하고, 셀 단위로 인라인 편집(useTransition + onBlur 서버액션)할 수 있게 만들었다. Plan 01에서 둔 RED 테스트 stub이 GREEN으로 전환되었다.

## What Was Done

### Task 1 — TDD: RED → GREEN (commits `a32d1e4`, `ea8219b`)

#### RED (commit `a32d1e4`)
`tests/inventory/shipping-cost-edit.test.tsx`의 Plan 01 stub (`it.todo` 2개 + 단순 grep 1개)을 5개의 구체 assertion으로 교체:

| Assertion | Targets |
|-----------|---------|
| `updateShippingCost` server action 존재 + userId scope | `actions.ts`에 `'use server'`, `eq(products.userId, user.id)`, `eq(products.id, productId)` |
| Input 검증 (NaN / 음수 거부) | `actions.ts`에 `Number.isNaN`, `value < 0` |
| ShippingCostCell 컴포넌트 + '배송비' 컬럼 헤더 | `inventory-table.tsx`에 `ShippingCostCell`, `SaaS 배송비(원가)` |
| useTransition + onBlur + 서버액션 호출 | `inventory-table.tsx`에 `useTransition`, `onBlur`, `updateShippingCost` |
| page.tsx 데이터 페치에 shippingCost 포함 | `page.tsx`에 `shippingCost` |

`npx vitest run tests/inventory/shipping-cost-edit.test.tsx` → 5/5 FAIL (intended RED).

#### GREEN (commit `ea8219b`)

**`src/app/(auth)/inventory/actions.ts`** — 새 export `updateShippingCost`:

```ts
export async function updateShippingCost(
  productId: string,
  value: number | null,
): Promise<{ ok: true } | { ok: false; error: string }>
```

Flow:
1. `createClient()` → `auth.getUser()` — 미인증 시 `{ ok: false, error: 'unauthorized' }`
2. `value !== null`이면 `typeof number && !NaN && >= 0` 검증 — 위반 시 `{ ok: false, error: 'invalid value' }`
3. `db.update(products).set({ shippingCost: value === null ? null : String(value), updatedAt: new Date() }).where(and(eq(products.id, productId), eq(products.userId, user.id)))` — userId scope로 다른 사용자 product 변조 방지
4. `revalidatePath('/inventory')` → `{ ok: true }`

**`src/app/(auth)/inventory/inventory-table.tsx`** — 신규 `ShippingCostCell`:
- `useState(draft)` 으로 입력 string 보관
- `useEffect` 로 외부 `value` 변경 시 `draft`를 sync (revalidatePath 후 stale 방지)
- `onBlur` 핸들러:
  - `draft === initial` 이면 no-op
  - empty string → `null`, otherwise `Number(draft)`
  - `Number.isNaN || < 0` → revert + `toast.error('숫자만 입력 가능합니다')`
  - 정상이면 `startTransition(async () => updateShippingCost(...))` → 결과에 따라 `toast.success('배송비 저장됨')` 또는 revert + `toast.error(result.error)`
- shadcn `<Input type="number" min={0} step="1">` + `disabled={pending}` + `w-24 text-right text-xs h-7` + 우측 '원' 라벨

신규 컬럼 등록 위치: `availableStock` 컬럼 직후, `monthlyIncoming` 직전 (재고 정보 그룹과 흐름 정보 그룹 사이).

```ts
columnHelper.accessor('shippingCost', {
  header: 'SaaS 배송비(원가)',
  cell: (info) => (
    <ShippingCostCell
      productId={info.row.original.productId}
      value={info.getValue()}
    />
  ),
}),
```

`InventoryRow` 인터페이스에 `productId: string` + `shippingCost: string | null` 두 필드 추가 (drizzle numeric 컬럼은 string 직렬화).

**`src/app/(auth)/inventory/page.tsx`** — `items.map` 에 `productId: item.productId` + `shippingCost: item.shippingCost` 두 필드 추가하여 `<InventoryTable>` 로 forward.

**`src/lib/inventory/queries.ts`** — `getInventoryList()` select에:
- `productId: products.id` 추가 (row key COALESCE id와 별개의 stable product identifier)
- `shippingCost: products.shippingCost` 추가

## Verification

| Check | Command | Result |
|-------|---------|--------|
| RED test 5/5 fail (RED phase) | `vitest run tests/inventory/shipping-cost-edit.test.tsx` | PASS (intended) |
| GREEN test 5/5 pass | `vitest run tests/inventory/shipping-cost-edit.test.tsx` | 5/5 GREEN |
| 전체 inventory 디렉토리 | `vitest run tests/inventory` | 5/5 GREEN |
| `tsc --noEmit` (내 변경 영역) | grep tsc output for inventory|shippingCost | 0 errors |
| `npm run build` | full Next.js build | succeeded (모든 route 정상 컴파일) |
| Acceptance grep 11/11 | manual grep checklist | all match |

Acceptance grep 결과:
- `export async function updateShippingCost` — actions.ts L110
- `eq(products.userId` — actions.ts L132
- `eq(products.id, productId)` — actions.ts L132
- `Number\.isNaN` — actions.ts L121
- `revalidatePath\('/inventory'\)` — actions.ts L60, L98, L134
- `ShippingCostCell` — inventory-table.tsx L72, L325 등
- `useTransition` — inventory-table.tsx L3 import, L81 (셀), L161 (기존 검색)
- `updateShippingCost` — inventory-table.tsx L22 import, L107 호출
- `SaaS 배송비\(원가\)` — inventory-table.tsx L323
- `shippingCost` — page.tsx L93

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] queries.getInventoryList didn't expose productId**
- **Found during:** Task 1 (Step 3 — page.tsx forward)
- **Issue:** Plan called `<ShippingCostCell productId={row.original.productId} ... />`, but the existing `InventoryRow` only had `id` (a COALESCE'd string of inventory.id OR products.id). server action 호출은 stable `products.id` 가 필요했음.
- **Fix:** `src/lib/inventory/queries.ts`에 `productId: products.id` select 추가, `page.tsx`의 row mapping에 forward, `InventoryRow` 인터페이스에 `productId: string` 필드 추가.
- **Files modified:** `src/lib/inventory/queries.ts`, `src/app/(auth)/inventory/page.tsx`, `src/app/(auth)/inventory/inventory-table.tsx`
- **Verification:** tsc 통과, build 통과, 5/5 vitest GREEN
- **Commit:** `ea8219b` (with rest of GREEN)

**2. [Rule 2 - Missing Critical] useEffect로 initial value sync**
- **Found during:** Task 1 (Step 4 — ShippingCostCell)
- **Issue:** `useState(initial)`만 쓰면 server-rendered value가 revalidatePath 이후 변경됐을 때 클라이언트 draft가 stale (old value 그대로 표시).
- **Fix:** `useEffect(() => setDraft(initial), [initial])` 로 외부 value 변경을 draft에 동기화.
- **Files modified:** `src/app/(auth)/inventory/inventory-table.tsx`
- **Verification:** 시각 검증 (코드 리뷰) — 사용자가 다른 셀 편집 후 이 셀 표시 일치 보장
- **Commit:** `ea8219b`

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical). **Impact:** None blocked the plan; both improvements strengthen the contract (productId stability + UI freshness).

## Authentication Gates

None. `auth.getUser()` 흐름은 기존 `setStockAction`/`adjustStockAction` 패턴 그대로 재사용.

## Known Stubs

None. Plan 01의 RED stub이 정상적으로 GREEN으로 전환되었고, 모든 셀이 실제 데이터(productId, shippingCost)에 wired되어 있다.

## Forward Pointers (매출관리 phase 사용 hint)

향후 매출관리 phase에서 `products.shippingCost` ↔ `orders.shippingFee` 차이 계산:

- `products.shippingCost` (Plan 01 추가): SaaS에 등록된 **원가** 배송비 (사용자가 inventory에서 입력)
- `orders.shippingFee` (Plan 01 추가, Plan 02에서 Coupang adapter normalize): 마켓플레이스에서 **수집된** 배송비 (수령액)
- 차이 = `orders.shippingFee - products.shippingCost` (per item) → 배송 마진/적자 계산 기반
- inventory join: `inventory.sku = products.internal_sku` (기존), order item join: order item의 SKU/매핑된 productId
- 음수일 경우 적자 배송 (사용자 알림 candidate)

이 데이터 모델은 매출관리 phase의 "배송비 차익" 컬럼 + 일별 배송 마진 dashboard의 입력으로 직접 활용 가능.

## Self-Check: PASSED

All claimed files exist on disk:
- `src/app/(auth)/inventory/actions.ts` FOUND
- `src/app/(auth)/inventory/inventory-table.tsx` FOUND
- `src/app/(auth)/inventory/page.tsx` FOUND
- `src/lib/inventory/queries.ts` FOUND
- `tests/inventory/shipping-cost-edit.test.tsx` FOUND

All claimed commits exist:
- `a32d1e4` test(08-04): add failing tests for shipping_cost inline edit
- `ea8219b` feat(08-04): inventory shipping_cost 인라인 편집 + 컬럼 추가
