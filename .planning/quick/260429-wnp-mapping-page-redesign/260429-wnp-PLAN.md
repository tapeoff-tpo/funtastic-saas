---
phase: quick-260429-wnp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/api/products/mapping-codes/order-rows/route.ts
  - src/app/(auth)/products/mapping/page.tsx
  - src/app/(auth)/products/mapping/mapping-manager.tsx
  - src/app/(auth)/products/mapping/order-rows-board.tsx
  - src/app/(auth)/products/mapping-codes/page.tsx
autonomous: false
requirements:
  - QUICK-260429-WNP — 매핑관리 페이지를 사방넷 주문서확정관리 스타일(상단 dense 필터 + 좌/우 그룹 헤더 테이블)로 리디자인

must_haves:
  truths:
    - "사용자가 /products/mapping 진입 시 사방넷 주문서확정관리와 동일하게 상단 dense 필터(수집일자 + 쇼핑몰 + 매핑상태 라디오 2그룹 + 검색)를 본다"
    - "툴바에 자료수 N건이 좌측, 일괄 품번매핑/일괄 단품매핑/매핑해제/새로고침 버튼이 우측에 표시된다"
    - "테이블은 2-그룹 헤더(쇼핑몰 수집 데이터 / 매핑 적용 결과)로 dense 하게 렌더된다 — 각 행 = orderItem 1건"
    - "매핑된 행은 매핑 적용 결과 그룹에 매핑코드(품번-단품), SKU, 재고 상품명/옵션, 수량(orderItem.qty * component.qty)을 표시한다"
    - "미매핑 행에서 [+ 품번매핑] / [+ 단품매핑] 버튼 클릭 시 기존 EditDialog 가 prefill 상태로 열리고 저장 후 행이 매핑됨으로 갱신된다"
    - "필터/검색/페이지네이션 상태는 URL query string(nuqs)으로 직렬화되어 새로고침/공유 가능하다"
    - "기존 매핑코드 마스터 관리 화면은 /products/mapping-codes 로 이동되어도 기능(생성/편집/삭제/검색) 손실 없이 동작한다"
    - "탭 UI 가 어디에도 존재하지 않는다 (사용자가 명시 거부)"
  artifacts:
    - path: "src/app/api/products/mapping-codes/order-rows/route.ts"
      provides: "GET /api/products/mapping-codes/order-rows — orderItem 단위 행 조회 API (필터 적용)"
      exports: ["GET"]
    - path: "src/app/(auth)/products/mapping/order-rows-board.tsx"
      provides: "사방넷 스타일 dense 보드 — 필터 패널 + 툴바 + 2그룹 헤더 테이블 + EditDialog 재호출"
      min_lines: 200
    - path: "src/app/(auth)/products/mapping/page.tsx"
      provides: "매핑관리 페이지 진입점 — OrderRowsBoard 렌더 (탭 없음)"
    - path: "src/app/(auth)/products/mapping-codes/page.tsx"
      provides: "매핑코드 마스터 페이지 — 기존 MappingManager 좌측 마스터 목록을 그대로 마이그레이션"
    - path: "src/app/(auth)/products/mapping/mapping-manager.tsx"
      provides: "EditDialog + emptyForm + openCreate prefill 로직 export — order-rows-board.tsx 가 재사용"
  key_links:
    - from: "src/app/(auth)/products/mapping/order-rows-board.tsx"
      to: "/api/products/mapping-codes/order-rows"
      via: "fetch with URLSearchParams (필터/검색/페이지)"
      pattern: "fetch.*api/products/mapping-codes/order-rows"
    - from: "src/app/(auth)/products/mapping/order-rows-board.tsx"
      to: "EditDialog from mapping-manager.tsx"
      via: "import + onSave callback → POST/PATCH /api/products/mapping-codes → 보드 재조회"
      pattern: "import.*EditDialog|emptyForm"
    - from: "src/app/api/products/mapping-codes/order-rows/route.ts"
      to: "orders + order_items + mapping_sources + mapping_codes + mapping_components + inventory"
      via: "drizzle SQL with LEFT JOIN to mapping_sources(품번/단품 우선순위) → mapping_codes → mapping_components → inventory"
      pattern: "marketplace_option_id.*marketplace_product_id|LEFT JOIN.*mapping_sources"
---

<objective>
매핑관리 페이지(`/products/mapping`)를 사방넷 주문서확정관리 스타일로 리디자인. 미매핑/매핑된 주문 행을 한 화면 dense 폼으로 보여주고 좌측 "쇼핑몰 수집 데이터" / 우측 "매핑 적용 결과" 2그룹 컬럼 테이블에서 행 단위로 매핑/해제 작업을 한다. 기존 매핑코드 마스터 관리 화면은 `/products/mapping-codes` 로 분리.

Purpose: 사방넷에서 익숙한 흐름을 그대로 재현 — 1) 필터로 미매핑만 본다 → 2) 행에서 즉시 [+ 품번매핑]/[+ 단품매핑] → 3) prefill 된 다이얼로그에서 SKU만 입력하고 저장. 사용자가 매일 반복하는 매핑 작업의 클릭/스크롤 횟수 감소가 사방넷 끊기의 마지막 piece.

Output:
- GET `/api/products/mapping-codes/order-rows` (orderItem 단위 행 조회, 필터 지원)
- `/products/mapping` 페이지 = OrderRowsBoard (탭 없음)
- `/products/mapping-codes` 페이지 = 기존 매핑코드 마스터 관리 (좌 패널 그대로 이동)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

이 코드베이스는 **Next.js 16.2.2** 입니다. 학습 데이터의 Next.js API/관습은 outdated 일 수 있습니다. 작업 시작 전 반드시 `node_modules/next/dist/docs/` 의 관련 가이드(특히 route handlers, dynamic params, async APIs)와 deprecation notices 를 먼저 읽으세요. — `AGENTS.md` 강제 사항.
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@AGENTS.md

# 현재 매핑관리 UI/API
@src/app/(auth)/products/mapping/page.tsx
@src/app/(auth)/products/mapping/mapping-manager.tsx
@src/app/api/products/mapping-codes/route.ts
@src/app/api/products/mapping-codes/[id]/route.ts
@src/app/api/products/mapping-codes/unmapped/route.ts

# 매칭 로직 (재사용)
@src/lib/orders/mapping-match.ts
@src/lib/db/schema.ts

<interfaces>
<!-- 실행자가 그대로 사용해야 하는 핵심 타입/시그니처. 코드베이스 탐색 불필요. -->

From src/lib/db/schema.ts (mapping 관련 컬럼):

```ts
// orders
{
  id: uuid, userId: uuid, marketplaceId: varchar(50),
  marketplaceOrderId: varchar(200), orderedAt: timestamptz,
}

// orderItems  (테이블명: order_items)
{
  id: uuid, orderId: uuid,
  marketplaceItemId: varchar(200) | null,   // = "{productId}" 또는 "{productId}-{optionId}"
  productName: text, optionText: text | null,
  quantity: integer,                         // 주문 수량
  sku: varchar(100) | null,
  skuMultiplier: integer (default 1),
}

// mappingCodes
{ id, userId, code: varchar(100), name: text, note, isActive, updatedAt }

// mappingSources
{
  id, userId, mappingCodeId: uuid (FK CASCADE),
  marketplaceId, marketplaceProductId, marketplaceOptionId,  // option_id = '' 이면 품번매핑
  productNameSnapshot, optionNameSnapshot,
}

// mappingComponents
{ id, userId, mappingCodeId, sku: varchar(100), quantity: integer }

// inventory
{ id, userId, sku, productName, optionName, ... }
```

From src/lib/orders/mapping-match.ts:

```ts
export const MAPPING_SEPARATOR = '-'
// 매칭 우선순위: 1) 단품 정확매치  2) productId 풀매치  3) productId + '-' prefix
// 위 3개 모두 미스 = 미매핑
```

From src/app/(auth)/products/mapping/mapping-manager.tsx (재사용 대상):

```ts
// 현재 default export 는 MappingManager 컴포넌트만.
// 이 plan 에서 EditDialog, FormState, SourceMode, emptyForm, MARKETPLACE_LABELS 를 named export 로 추가한다.

export type SourceMode = 'product' | 'option'
export interface FormState { ... }   // 위 파일 60~63줄 참고
export function emptyForm(): FormState { ... }
export const MARKETPLACE_LABELS: Record<string, string>
export interface DialogProps { state: FormState; onChange; onClose; onSave; saving: boolean }
export function EditDialog(props: DialogProps): JSX.Element
```

기존 unmapped API 매칭 SQL (`src/app/api/products/mapping-codes/unmapped/route.ts` 23~50줄) 패턴은 그대로 새 order-rows API 의 LEFT JOIN 조건으로 사용한다 — `(ms.option_id <> '' AND oi.marketplace_item_id = ms.product_id || '-' || ms.option_id) OR (ms.option_id = '' AND (oi.marketplace_item_id = ms.product_id OR oi.marketplace_item_id LIKE ms.product_id || '-%'))`.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: GET /api/products/mapping-codes/order-rows — orderItem 단위 매핑 행 조회 API</name>
  <files>src/app/api/products/mapping-codes/order-rows/route.ts</files>
  <action>
새 파일 `src/app/api/products/mapping-codes/order-rows/route.ts` 를 생성. 작성 전 `node_modules/next/dist/docs/` 의 route handler 문서를 한 번 확인 (Next.js 16 의 dynamic route signatures, Request/Response, runtime 기본값).

**기능 요건:**

GET 핸들러로 다음 query params 를 받는다:
- `from`, `to`: 수집일자 범위 (orderedAt 기준, ISO date, 둘 다 optional)
- `marketplaceIds`: comma-separated 쇼핑몰 ID (optional, 미지정 = 전체)
- `productMatch`: 'all' | 'matched' | 'unmatched' — 품번 매핑 그룹 A
- `optionMatch`: 'all' | 'matched' | 'unmatched' | 'sku' — 단품 매핑 그룹 B (sku = mapping_components.sku 가 inventory 와 매핑되어 있는 경우)
- `q`: 검색어 (쇼핑몰상품코드 / 상품명 / 옵션텍스트 부분일치, optional)
- `page` (default 1), `pageSize` (default 50, max 200)

**SQL (drizzle `db.execute(sql\`...\`)` 또는 select+leftJoin 둘 중 단순한 쪽):**

```sql
SELECT
  oi.id            AS "orderItemId",
  o.id             AS "orderId",
  o.marketplace_id                     AS "marketplaceId",
  o.marketplace_order_id               AS "marketplaceOrderId",
  o.ordered_at                         AS "orderedAt",
  oi.marketplace_item_id               AS "marketplaceItemId",
  oi.product_name                      AS "productName",
  oi.option_text                       AS "optionText",
  oi.quantity                          AS "quantity",
  -- 매칭된 mapping_source (단품 우선)
  ms.id                                AS "mappingSourceId",
  ms.marketplace_option_id             AS "msOptionId",   -- '' = 품번매핑
  mc.id                                AS "mappingCodeId",
  mc.code                              AS "mappingCode",
  mc.name                              AS "mappingName",
  -- 첫 component 1줄(요약). 다중 component 일 때는 array_agg 로 묶어서 반환.
  COALESCE(
    json_agg(
      json_build_object(
        'sku', mcomp.sku,
        'quantity', mcomp.quantity,
        'productName', inv.product_name,
        'optionName', inv.option_name
      )
    ) FILTER (WHERE mcomp.id IS NOT NULL),
    '[]'::json
  ) AS "components"
FROM order_items oi
INNER JOIN orders o ON o.id = oi.order_id
LEFT JOIN LATERAL (
  -- 사방넷 우선순위 매칭: 단품매핑 → 품번 풀매치 → 품번 prefix
  SELECT *
  FROM mapping_sources s
  WHERE s.user_id = o.user_id
    AND s.marketplace_id = o.marketplace_id
    AND (
      (s.marketplace_option_id <> '' AND oi.marketplace_item_id = s.marketplace_product_id || '-' || s.marketplace_option_id)
      OR (s.marketplace_option_id = '' AND (oi.marketplace_item_id = s.marketplace_product_id
                                          OR oi.marketplace_item_id LIKE s.marketplace_product_id || '-%'))
    )
  ORDER BY (s.marketplace_option_id <> '') DESC   -- 단품 우선
  LIMIT 1
) ms ON TRUE
LEFT JOIN mapping_codes mc        ON mc.id = ms.mapping_code_id AND mc.user_id = o.user_id
LEFT JOIN mapping_components mcomp ON mcomp.mapping_code_id = mc.id
LEFT JOIN inventory inv            ON inv.user_id = o.user_id AND inv.sku = mcomp.sku
WHERE o.user_id = $userId
  AND oi.marketplace_item_id IS NOT NULL AND oi.marketplace_item_id <> ''
  -- + from/to/marketplaceIds/q 동적 조건
  -- + productMatch/optionMatch 필터:
  --     productMatch = 'matched'    → mc.id IS NOT NULL
  --     productMatch = 'unmatched'  → mc.id IS NULL
  --     optionMatch  = 'matched'    → ms.marketplace_option_id <> ''
  --     optionMatch  = 'unmatched'  → ms.id IS NULL OR ms.marketplace_option_id = ''
  --     optionMatch  = 'sku'        → EXISTS inv (component.sku 가 inventory 에 있음)
GROUP BY oi.id, o.id, ms.id, mc.id
ORDER BY o.ordered_at DESC, oi.id
LIMIT $pageSize OFFSET ($page - 1) * $pageSize
```

응답 shape (반드시 클라이언트 타입과 일치):

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
    mappingStatus: 'option' | 'product' | 'unmapped'  // ms.option_id != '' / ms.option_id = '' / ms 없음
    mappingSourceId: string | null
    mappingCodeId: string | null
    mappingCode: string | null
    mappingName: string | null
    components: Array<{
      sku: string
      quantity: number              // mapping_components.quantity (1 unit 당)
      productName: string | null    // inventory.product_name
      optionName: string | null     // inventory.option_name
    }>
  }>,
  total: number,    // COUNT(*) (필터 적용된 전체)
  page: number,
  pageSize: number,
}
```

`total` 은 별도 COUNT 쿼리(같은 WHERE/JOIN, GROUP BY 제거하고 COUNT(DISTINCT oi.id))로 계산.

**기존 패턴 준수:**
- 인증: `createClient()` → `supabase.auth.getUser()` (mapping-codes/route.ts 36~38줄과 동일)
- 401 unauthorized 처리 동일
- params 는 Next.js 16 의 async signature 준수 — 현재 `[id]/route.ts` 36줄에서 `{ params }: { params: Promise<{ id: string }> }` 패턴 확인 가능. 이 plan 은 query params 만 쓰므로 `req.nextUrl.searchParams` 직접 사용.
- SQL 인젝션 방지: `sql\`\`` 템플릿 + drizzle 파라미터 바인딩만 사용 (문자열 concat 금지).

**기존 unmapped API 는 손대지 않는다** — `mapping-manager.tsx` (좌 패널 마스터 페이지로 이동될) 가 계속 사용한다.
  </action>
  <verify>
    <automated>npx tsc --noEmit && curl -s "http://localhost:3000/api/products/mapping-codes/order-rows?productMatch=all&amp;optionMatch=unmatched&amp;page=1&amp;pageSize=10" -H "Cookie: $(node -e 'console.log(process.env.TEST_SESSION_COOKIE||\"\"')" | head -c 500</automated>
  </verify>
  <done>
파일 존재, `npx tsc --noEmit` 에러 0건. 인증된 요청에 대해 200 응답 + `{ rows: [...], total, page, pageSize }` JSON 반환. productMatch=unmatched 필터 시 mappingCodeId=null 인 행만, optionMatch=matched 시 mappingStatus='option' 인 행만 반환됨을 수동 확인.
  </done>
</task>

<task type="auto">
  <name>Task 2: 매핑코드 마스터 페이지 분리 + EditDialog/유틸 named export 화</name>
  <files>src/app/(auth)/products/mapping-codes/page.tsx, src/app/(auth)/products/mapping/mapping-manager.tsx</files>
  <action>
**Part A — `src/app/(auth)/products/mapping/mapping-manager.tsx` 수정:**

다음 심볼들을 named export 로 노출 (Task 3 의 OrderRowsBoard 가 재사용):
- `MARKETPLACE_LABELS`, `marketLabel`
- `type SourceMode`
- `interface SourceForm`, `interface ComponentForm`, `interface FormState`
- `function emptyForm()`
- `interface DialogProps`, `function EditDialog`

**기존 동작 보존**: `MappingManager` 컴포넌트는 그대로 두고 export 만 추가. 좌측 매핑코드 리스트 + 우측 미매핑 패널 + EditDialog 흐름 모두 그대로 유지 — 기능 회귀 0건.

**Part B — `src/app/(auth)/products/mapping-codes/page.tsx` 신규 생성:**

```tsx
import { MappingManager } from '../mapping/mapping-manager'

export default function MappingCodesPage() {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">매핑코드 마스터</h1>
        <p className="text-sm text-muted-foreground">
          매핑코드(품번/단품 ↔ SKU) 마스터 관리. 일상 매핑 작업은 <a href="/products/mapping" className="underline">매핑관리</a> 화면에서.
        </p>
      </header>
      <MappingManager />
    </div>
  )
}
```

**탭 절대 만들지 말 것** — 두 페이지는 서로 별도 URL. 사이드바/네비게이션이 두 항목을 모두 가리키도록 추가가 필요한 경우, 사이드바 메뉴 데이터 파일에서 "매핑관리"(/products/mapping) 와 "매핑코드 마스터"(/products/mapping-codes) 두 항목으로 표시. (사이드바 컴포넌트 위치는 작업 시 grep `products/mapping` 으로 확인 후 동일 파일 내에서만 항목 추가.)

작업 시작 전 Next.js 16 의 file-based routing 관습이 변경되지 않았는지 `node_modules/next/dist/docs/` 한 번 확인.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -E "^export (interface |type |const |function )(SourceMode|FormState|emptyForm|EditDialog|MARKETPLACE_LABELS|DialogProps|SourceForm|ComponentForm|marketLabel)" src/app/\(auth\)/products/mapping/mapping-manager.tsx | wc -l</automated>
  </verify>
  <done>
`mapping-manager.tsx` 에서 9개 심볼이 named export 로 노출됨 (`grep` 결과 ≥ 9). `/products/mapping-codes` 라우트 진입 시 기존 매핑코드 마스터 UI(MappingManager) 가 그대로 렌더되며, 생성/편집/삭제/검색이 모두 동작. tsc 에러 0건.
  </done>
</task>

<task type="auto">
  <name>Task 3: OrderRowsBoard 컴포넌트 + /products/mapping 페이지 교체</name>
  <files>src/app/(auth)/products/mapping/order-rows-board.tsx, src/app/(auth)/products/mapping/page.tsx</files>
  <action>
**Part A — `src/app/(auth)/products/mapping/order-rows-board.tsx` 신규 생성** ('use client'):

레이아웃 구성 (위에서 아래로):

1. **상단 dense 필터 패널** (rounded-md border, 12px 폰트):
   - Row 1: "수집일자" label + `<input type="date" from>` ~ `<input type="date" to>` + quick buttons [오늘] [1주일] [당월] [1개월]. quick 클릭 시 from/to 자동 세팅.
   - Row 2: "쇼핑몰" label + multiselect (간단히 체크박스 칩 그룹: `MARKETPLACE_LABELS` 의 entries 를 토글 칩으로). 선택 0개 = 전체.
   - Row 3: "매핑선택" label + 라디오 그룹 A `[전체/품번매핑/품번미매핑]` + 구분선 + 라디오 그룹 B `[전체/단품매핑/단품미매핑/SKU매핑]`.
   - Row 4: "검색" label + `<input>` (쇼핑몰상품코드 / 상품명 / 옵션) + `[조회]` 버튼 + `[초기화]` 버튼.

2. **툴바** (필터 패널 아래, flex justify-between):
   - 좌: `자료수 {total}건` (total 은 API 응답 사용)
   - 우: `[일괄 품번매핑] [일괄 단품매핑] [매핑해제] [새로고침]` 버튼들

3. **2그룹 헤더 dense 테이블**:
   - `<thead>` 2단:
     - 1단: `<th colspan=6>쇼핑몰 수집 데이터</th><th colspan=4>매핑 적용 결과</th>`
     - 2단: 좌측 6컬럼 — 쇼핑몰, 쇼핑몰주문번호, 쇼핑몰상품코드, 상품명/옵션, 수량, 매핑여부 / 우측 4컬럼 — 품번-단품, SKU, 상품명/옵션(inventory), 수량
   - `<tbody>` 행 = orderItem 1건. 각 행 좌측에 체크박스 (TanStack 없이 단순 `useState<Set<string>>` 으로 충분).
   - 매핑여부 컬럼 배지: 'option' → 단품매핑(녹색), 'product' → 품번매핑(파란색), 'unmapped' → 미매핑(회색) + 같은 셀에 [+ 품번] [+ 단품] 인라인 버튼 표시.
   - 수량(매핑 결과) = `row.quantity * components[i].quantity` — components 배열이 여러 개면 각 component 한 줄씩 sub-row 로 (rowspan 또는 inner block 표시).

**상태 관리:**
- 필터 상태는 `nuqs` 사용 (CLAUDE.md 추천 스택). 키: `from`, `to`, `mkt`, `productMatch`, `optionMatch`, `q`, `page`. 다른 페이지에서 nuqs 사용 패턴이 없으면 그냥 `useState` + `URLSearchParams` 수동 동기화로 fallback (이 경우 새로고침 시 필터 보존만 보장).
- `fetch('/api/products/mapping-codes/order-rows?' + params)` → setRows / setTotal.

**EditDialog 재사용:**
```tsx
import { EditDialog, emptyForm, MARKETPLACE_LABELS, marketLabel, type FormState, type SourceMode } from './mapping-manager'
```

`openMapping(row, mode: SourceMode)` 함수:
- `emptyForm()` 호출 후 `form.name` = row.productName, `form.sources[0]` = `{ mode, marketplaceId: row.marketplaceId, marketplaceProductId/marketplaceOptionId: row.marketplaceItemId 분리 (mapping-manager.tsx 95~114줄 로직 동일), productNameSnapshot: row.productName, optionNameSnapshot: row.optionText }` 로 prefill.
- `setEditing(form)` → EditDialog 렌더 → onSave 시 POST `/api/products/mapping-codes` 호출 (기존 mapping-manager handleSave 와 동일 페이로드).
- 저장 성공 후 `reload()` 으로 보드 재조회 — 그 행은 매핑된 상태로 다시 그려진다.

**일괄 액션:**
- `[일괄 품번매핑]` / `[일괄 단품매핑]`: 선택된 행 중 첫 번째를 prefill base 로 EditDialog 열기 + 나머지 선택 행을 추가 sources 로 같이 prefill (한 매핑코드에 N 개의 마켓상품 묶기).
- `[매핑해제]`: 선택된 행들의 mappingSourceId 들을 모아 DELETE 호출. 별도 API `DELETE /api/products/mapping-codes/sources?ids=...` 가 없으므로 이번 plan 에서는 PATCH `/api/products/mapping-codes/{id}` 의 `sources` 배열을 다시 보내 해당 source 만 제거하는 방식으로 처리 (편집 다이얼로그 열어서 source 행 삭제 후 저장하는 단축 흐름이라도 OK). 구현 우선순위 낮음 — 일단 버튼은 만들고 클릭 시 "선택된 행을 다이얼로그에서 편집해서 해제하세요" 안내 모달로 fallback 가능. (true delete API 가 필요해지면 후속 quick task.)
- `[새로고침]`: `reload()`.

**스타일:** Tailwind v4. 행 높이 28~32px (dense). 숫자 컬럼 `tabular-nums text-right`. 매핑여부/품번-단품/SKU 는 `font-mono text-xs`. 헤더 `bg-muted/50`. 행 hover `bg-muted/30`. **shadcn/ui** Button/Badge 만 사용.

**Part B — `src/app/(auth)/products/mapping/page.tsx` 교체:**

```tsx
import { OrderRowsBoard } from './order-rows-board'

export default function MappingPage() {
  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">매핑관리</h1>
        <p className="text-sm text-muted-foreground">
          쇼핑몰 수집 주문을 품번/단품 단위로 매핑합니다. 매핑코드 마스터는 <a href="/products/mapping-codes" className="underline">매핑코드 마스터</a> 에서.
        </p>
      </header>
      <OrderRowsBoard />
    </div>
  )
}
```

**탭/sub-nav 절대 만들지 말 것.** 페이지 헤더의 inline 링크로만 두 화면을 연결.

**Next.js 16 주의:** 작업 시작 전 `node_modules/next/dist/docs/` 의 client component / 'use client' / nuqs 사용 가이드 확인. searchParams 사용 시 async signature (Next 16) 가 필요한지 확인.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx next build 2>&1 | grep -E "(error|Error|fail)" | grep -v "warn" | head -20</automated>
  </verify>
  <done>
`/products/mapping` 진입 시: 상단 dense 필터(수집일자+쇼핑몰+매핑상태 라디오 2그룹+검색) → 툴바(자료수 + 4버튼) → 2그룹 헤더 테이블 순으로 렌더. 미매핑 행에서 [+ 품번매핑] / [+ 단품매핑] 클릭 시 `EditDialog` 가 prefill 상태로 열리고, 저장 후 그 행이 매핑된 상태로 갱신됨. 탭 UI 없음. `npx next build` 에러 0건. 기존 `/products/mapping-codes` 의 마스터 관리 화면은 회귀 없이 동작.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: 사용자 검수 — 사방넷 화면과 흐름 비교</name>
  <what-built>
- `/products/mapping` 페이지가 사방넷 주문서확정관리 스타일(상단 dense 필터 + 툴바 + 2그룹 헤더 테이블) 로 리디자인됨.
- 기존 매핑코드 마스터 관리 화면은 `/products/mapping-codes` 로 이동.
- 행에서 [+ 품번매핑] / [+ 단품매핑] 으로 EditDialog prefill 호출 가능.
- 새 API `GET /api/products/mapping-codes/order-rows` 가 필터/페이지네이션 적용 행을 반환.
  </what-built>
  <how-to-verify>
1. `pnpm dev` (또는 프로젝트 dev 명령) 후 `http://localhost:3000/products/mapping` 진입.
2. 상단 필터 패널 5개 영역(수집일자 + quick / 쇼핑몰 / 매핑선택 라디오 그룹 A·B / 검색) 모두 보이고, 사방넷 화면과 같은 dense 한 톤인지 확인.
3. 매핑선택 라디오 "품번미매핑" 클릭 → 미매핑 행만 표시되는지 확인. "단품매핑" → 단품매핑 배지 행만 표시.
4. 미매핑 행의 [+ 품번매핑] 클릭 → 기존 EditDialog 가 열리고 마켓/상품ID/상품명이 prefill 되어 있는지 확인. SKU 만 입력 후 저장 → 행이 즉시 매핑된 상태로 갱신.
5. 툴바 [새로고침] 클릭 시 자료수가 다시 fetch 되는지 확인.
6. 사이드바/주소창에서 `/products/mapping-codes` 진입 → 기존 매핑코드 마스터 화면(좌 매핑코드 리스트 / 우 미매핑 패널) 이 그대로 동작하는지 확인 (생성/편집/삭제/검색).
7. 페이지 어디에도 탭(`role=tablist`) 이 없는지 DOM 확인.

**문제 시 보고할 것:**
- 사방넷과 시각적 흐름 차이 (필터 위치, 컬럼 그룹, 버튼 배치)
- prefill 누락/오류
- 매핑 후 행 갱신 실패
- `/products/mapping-codes` 회귀
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues with screenshots/repro steps</resume-signal>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` — 0 errors
2. `npx next build` — 0 errors (warnings 허용)
3. 수동: `/products/mapping` 사용자 검수 통과 (Task 4)
4. 회귀 확인: `/products/mapping-codes` 의 매핑코드 마스터 관리(생성/편집/삭제/검색) 모두 정상
5. DOM 검사: `/products/mapping` 와 `/products/mapping-codes` 어디에도 `role="tablist"` / `<Tabs>` 컴포넌트 없음
</verification>

<success_criteria>
- 사용자가 `/products/mapping` 에서 사방넷과 동일한 필터→테이블→인라인 매핑 흐름을 경험한다
- 미매핑 행 → [+ 품번매핑]/[+ 단품매핑] → prefill 된 EditDialog → 저장 → 행이 매핑됨 으로 갱신되는 라운드트립이 동작한다
- 라디오 필터 그룹 A(품번 매핑/미매핑/전체) + 그룹 B(단품 매핑/미매핑/SKU/전체) 가 서로 독립적으로 적용되어 행 셋이 좁혀진다
- 기존 매핑코드 마스터 관리는 `/products/mapping-codes` 에서 기능 손실 없이 동작한다
- 어디에도 탭 UI 가 없다
- Next.js 16 dev/build 모두 성공
</success_criteria>

<output>
완료 후 `.planning/quick/260429-wnp-mapping-page-redesign/260429-wnp-SUMMARY.md` 를 생성:
- 변경 파일 목록 + 각 파일의 핵심 변경
- 새 API 응답 shape 와 필터 query params 매트릭스
- EditDialog 재사용을 위해 named export 로 추가한 심볼 목록
- 일괄 매핑해제 흐름의 현재 한계(별도 DELETE API 없이 PATCH 우회)와 후속 작업 후보
- 사방넷 화면과 비교한 구현 vs 의도적 차이 1~3줄
</output>
