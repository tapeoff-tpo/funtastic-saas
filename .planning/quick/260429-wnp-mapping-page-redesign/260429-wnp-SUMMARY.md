---
phase: quick-260429-wnp
plan: 01
subsystem: products/mapping
tags: [ui, mapping, sabangnet-style, dense-table, nuqs]
requires:
  - mapping-codes API (GET/POST /api/products/mapping-codes)
  - mapping-codes detail API (GET/PATCH /api/products/mapping-codes/[id])
  - mapping_sources/mapping_codes/mapping_components/inventory schema
provides:
  - GET /api/products/mapping-codes/order-rows (orderItem 단위 행 조회 + 필터/페이지)
  - /products/mapping = OrderRowsBoard (사방넷 스타일 dense 매핑 보드)
  - /products/mapping-codes = 매핑코드 마스터 (기존 MappingManager 분리)
  - mapping-manager.tsx named exports (EditDialog, emptyForm, FormState 등 9개)
affects:
  - 사이드바 메뉴: 상품 섹션에 "매핑코드 마스터" 항목 추가
tech-stack:
  added: []
  patterns:
    - nuqs useQueryStates + parseAsStringEnum (필터 URL 직렬화)
    - drizzle sql`...` + sql.join + LATERAL JOIN (단품매핑 우선 매칭)
    - shadcn/ui Button + Badge only (탭/Tabs 컴포넌트 절대 미사용)
key-files:
  created:
    - src/app/api/products/mapping-codes/order-rows/route.ts
    - src/app/(auth)/products/mapping/order-rows-board.tsx
    - src/app/(auth)/products/mapping-codes/page.tsx
  modified:
    - src/app/(auth)/products/mapping/mapping-manager.tsx (named exports만 추가)
    - src/app/(auth)/products/mapping/page.tsx (MappingManager → OrderRowsBoard)
    - src/components/layout/sidebar.tsx (매핑코드 마스터 항목 추가)
decisions:
  - matching SQL 은 unmapped/route.ts 와 동일 패턴 (LATERAL JOIN + 단품 우선 ORDER BY)
  - 일괄 매핑해제는 별도 DELETE API 없이 안내 모달로 fallback (후속 quick task 후보)
  - 필터 페이지는 nuqs (이미 다른 페이지에서 사용 중인 표준)
metrics:
  duration: ~25min
  completed: 2026-04-29
---

# Quick Task 260429-wnp: 매핑관리 페이지 사방넷 스타일 리디자인 Summary

## One-liner

매핑관리 페이지를 사방넷 주문서확정관리 스타일(상단 dense 필터 + 툴바 + 2그룹 헤더 테이블)로 리디자인하고, 기존 매핑코드 마스터 관리는 별도 페이지로 분리. 미매핑 행에서 [+ 품번]/[+ 단품] 클릭 한 번으로 EditDialog 가 prefill 되어 SKU 입력만으로 매핑 완료.

## What Changed

### 1. 새 API: `GET /api/products/mapping-codes/order-rows`

**파일:** `src/app/api/products/mapping-codes/order-rows/route.ts` (신규, 237줄)

orderItem 단위 행을 LEFT LATERAL JOIN 으로 mapping_sources(단품 우선) → mapping_codes → mapping_components → inventory 와 결합해서 한 번에 반환.

**Query params:**

| 파라미터 | 타입 | 설명 |
| --- | --- | --- |
| `from` | ISO date | 수집일자 시작 (orderedAt >= from) |
| `to` | ISO date | 수집일자 종료 (orderedAt < to+1일) |
| `marketplaceIds` | comma-separated | 쇼핑몰 ID 필터 (미지정=전체) |
| `productMatch` | `all` \| `matched` \| `unmatched` | 품번매핑 그룹 |
| `optionMatch` | `all` \| `matched` \| `unmatched` \| `sku` | 단품매핑/SKU 그룹 |
| `q` | string | 쇼핑몰상품코드/상품명/옵션 부분일치 |
| `page`, `pageSize` | int | 페이지(기본 1) / 페이지크기(기본 50, 최대 200) |

**응답 shape:**

```ts
{
  rows: Array<{
    orderItemId: string
    orderId: string
    marketplaceId: string
    marketplaceOrderId: string
    orderedAt: string  // ISO
    marketplaceItemId: string
    productName: string
    optionText: string | null
    quantity: number
    mappingStatus: 'option' | 'product' | 'unmapped'
    mappingSourceId: string | null
    mappingCodeId: string | null
    mappingCode: string | null
    mappingName: string | null
    components: Array<{
      sku: string
      quantity: number
      productName: string | null  // inventory.product_name
      optionName: string | null   // inventory.option_name
    }>
  }>
  total: number
  page: number
  pageSize: number
}
```

매칭 우선순위: 단품 정확매치 → 품번 풀매치 → 품번 prefix (LATERAL JOIN `ORDER BY (s.marketplace_option_id <> '') DESC LIMIT 1`).

### 2. mapping-manager.tsx — named exports 추가 (기능 변경 없음)

**파일:** `src/app/(auth)/products/mapping/mapping-manager.tsx` (수정 — export 만 추가)

OrderRowsBoard 가 재사용할 9개 심볼을 named export 화:

- `MARKETPLACE_LABELS`, `marketLabel`
- `type SourceMode`
- `interface SourceForm`, `interface ComponentForm`, `interface FormState`
- `function emptyForm()`
- `interface DialogProps`, `function EditDialog`

기존 `MappingManager` 컴포넌트(좌 매핑코드 리스트 + 우 미매핑 패널)는 그대로 동작 — 회귀 0.

### 3. 매핑코드 마스터 페이지 분리

**파일:** `src/app/(auth)/products/mapping-codes/page.tsx` (신규)

기존 `MappingManager` 를 그대로 렌더. `/products/mapping-codes` 진입 시 매핑코드 생성/편집/삭제/검색이 회귀 없이 동작.

**사이드바:** `src/components/layout/sidebar.tsx` 의 상품 섹션에 "매핑코드 마스터" 항목 추가 (매핑관리 바로 아래).

### 4. /products/mapping = OrderRowsBoard

**파일:** `src/app/(auth)/products/mapping/order-rows-board.tsx` (신규, 약 460줄)
**파일:** `src/app/(auth)/products/mapping/page.tsx` (수정 — MappingManager → OrderRowsBoard)

레이아웃 (위에서 아래):

1. **상단 dense 필터 패널** (rounded border, text-xs):
   - Row 1: 수집일자 from/to + quick 버튼 [오늘 / 1주일 / 당월 / 1개월]
   - Row 2: 쇼핑몰 토글 칩 (10개 마켓, 선택 0=전체)
   - Row 3: 매핑선택 라디오 그룹 A `[전체/품번매핑/품번미매핑]` + 그룹 B `[전체/단품매핑/단품미매핑/SKU매핑]`
   - Row 4: 검색 입력 + [조회] [초기화]

2. **툴바**: 좌 `자료수 N건 (선택 M건)` / 우 `[일괄 품번매핑] [일괄 단품매핑] [매핑해제] [새로고침]`

3. **2그룹 헤더 dense 테이블**:
   - thead 1단: `<th colSpan=6>쇼핑몰 수집 데이터</th><th colSpan=4>매핑 적용 결과</th>`
   - thead 2단: 좌 6컬럼(쇼핑몰/주문번호/상품코드/상품명·옵션/수량/매핑여부) + 우 4컬럼(품번-단품/SKU/상품명·옵션[재고]/수량)
   - 미매핑 행: `매핑여부` 셀에 회색 "미매핑" 배지 + [+ 품번] [+ 단품] 인라인 버튼
   - 매핑된 행: 'option'=녹색 단품매핑, 'product'=파란색 품번매핑 배지
   - components 다중일 때 좌측 6컬럼 rowspan, 우측 4컬럼은 component 당 1줄
   - 우측 수량 = `row.quantity * component.quantity` (실제 출고 수량)

**상태 관리:** `nuqs` `useQueryStates` 로 `from`/`to`/`mkt`/`productMatch`/`optionMatch`/`q`/`page` 직렬화. 새로고침/공유 시 필터 보존.

**EditDialog 재사용:**
- `openMapping(row, mode)` — 단일 행 prefill
- `openBulk(mode)` — 선택된 행들을 한 매핑코드의 sources 로 묶어 prefill (N 마켓상품 → 1 매핑코드)
- `handleSave` — POST/PATCH `/api/products/mapping-codes` (mapping-manager handleSave 와 동일 페이로드) → reload

## Filter Matrix

| productMatch \\ optionMatch | all | matched | unmatched | sku |
| --- | --- | --- | --- | --- |
| **all** | 전체 | 단품매핑 행만 | 단품미매핑 행만 | SKU 가 inventory 에 있는 행만 |
| **matched** | 매핑된 행만 | 단품매핑된 행만 | 품번매핑(단품 없음) 행만 | 매핑+SKU 재고 |
| **unmatched** | 미매핑 행만 | (불가능 — 빈 결과) | 미매핑 행만 (=unmatched) | 미매핑 (재고 EXISTS 도 mc.id IS NULL 로 모두 빈셋) |

## Deviations from Plan

**None — plan executed exactly as written.**

CLAUDE.md / AGENTS.md 의 Next.js 16 가이드라인(`route handlers async params signature` / `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`)을 사전 확인. 새 API 는 query params 만 사용하므로 async params signature 불필요 — `req.nextUrl.searchParams` 직접 사용.

## Known Limitations / Deferred Items

1. **일괄 매핑해제** — 별도 `DELETE /api/products/mapping-codes/sources?ids=...` API 가 없어, 현재는 안내 모달로 fallback (사용자가 `/products/mapping-codes` 의 EditDialog 에서 source 행을 수동 제거). 후속 quick task 로 별도 DELETE 엔드포인트 + 보드 인라인 버튼 통합 가능.
2. **선택 매핑 prefill** — 일괄 매핑 시 첫 행의 productName 을 매핑코드 이름으로 사용. 사용자가 다이얼로그에서 매핑코드(`code`) 와 SKU 를 입력해야 함 (의도된 흐름 — 사방넷도 동일).
3. **데이터 그리드** — TanStack Table 미사용 (요건상 dense 한 정적 테이블만 필요). 향후 정렬/컬럼 토글이 필요해지면 도입 검토.

## Verification

### Automated

- `npx tsc --noEmit` — 본 plan 변경 파일 5개에 신규 에러 0건 (코드베이스의 기존 pre-existing 에러는 out of scope)
- `grep -E "^export ..." mapping-manager.tsx` — 9개 named export 확인

### Manual (Task 4 — checkpoint:human-verify) — **사용자 액션 필요**

워크트리 brunch `claude/infallible-pike` 를 pull 한 뒤 브라우저에서 직접 확인하세요:

1. `pnpm dev` (or `npm run dev`) → `http://localhost:3000/products/mapping` 진입
2. 상단 필터 패널 4행(수집일자+quick / 쇼핑몰 칩 / 매핑선택 라디오 A·B / 검색) 모두 보이는지 확인 — 사방넷과 동일한 dense 톤
3. 매핑선택 라디오 "품번미매핑" 클릭 → 미매핑 행만, "단품매핑" → 단품매핑 배지 행만 보이는지
4. 미매핑 행 [+ 품번] / [+ 단품] 클릭 → EditDialog 가 마켓/상품ID/상품명 prefill 된 상태로 열리는지. SKU 만 입력 후 저장 → 그 행이 매핑된 상태로 즉시 갱신
5. 툴바 [일괄 품번매핑] / [일괄 단품매핑] — 선택된 행들이 다이얼로그에 sources 로 묶여 들어오는지
6. [새로고침] / 페이지네이션 / `?from=…` URL 직접 입력 → 필터 보존되는지
7. `/products/mapping-codes` 진입 → 매핑코드 마스터 화면(좌 코드 리스트 / 우 미매핑) 정상 동작 (생성/편집/삭제/검색 회귀 0)
8. DOM 검사 — `/products/mapping`, `/products/mapping-codes` 어디에도 `role="tablist"` 없음

문제 시 보고할 것: 필터 위치/컬럼 그룹 차이, prefill 누락, 매핑 후 행 갱신 실패, mapping-codes 회귀.

## Self-Check

**Files claimed created/modified:**

- `src/app/api/products/mapping-codes/order-rows/route.ts` — FOUND
- `src/app/(auth)/products/mapping/order-rows-board.tsx` — FOUND
- `src/app/(auth)/products/mapping-codes/page.tsx` — FOUND
- `src/app/(auth)/products/mapping/mapping-manager.tsx` — FOUND (modified)
- `src/app/(auth)/products/mapping/page.tsx` — FOUND (modified)
- `src/components/layout/sidebar.tsx` — FOUND (modified)

**Commits claimed:**

- `445ff7b` (Task 1 — order-rows API) — FOUND
- `7cdb12c` (Task 2 — mapping-codes page + named exports) — FOUND
- `fe1ccae` (Task 3 — OrderRowsBoard + page swap) — FOUND

## Self-Check: PASSED
