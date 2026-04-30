---
quick_id: 260430-gbu
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/(auth)/products/mapping/order-rows-board.tsx
  - src/app/api/products/mapping-codes/order-rows/route.ts
autonomous: true
requirements:
  - GBU-01  # Dense filter panel: 수집일자 + 선택사항 I~IV + 매핑선택 2-row radio + 검색
  - GBU-02  # Toolbar: 자료수 + 일괄품번/단품매핑 + 일괄주문확정 + 다운로드 + 선택삭제 + 매핑해제
  - GBU-03  # 2-group header table — 좌:쇼핑몰 수집(주문금액 추가) / 우:매핑 적용 결과(확정여부 추가)
  - GBU-04  # searched sentinel — 검색 버튼 누르기 전에는 fetch 금지
  - GBU-05  # default pageSize 25, 상단 배치
  - GBU-06  # 절대 탭 사용 금지 — 단일 화면 + 모달만
must_haves:
  truths:
    - "/products/mapping 페이지 진입 시 fetch 가 실행되지 않고 안내문구가 보인다"
    - "검색 버튼을 눌러야 첫 조회가 일어난다 (searched=1 sentinel)"
    - "필터 패널에 수집일자 / 선택사항 I~IV(쇼핑몰·카테고리·상태·기타) 4개 select / 매핑선택 2행 라디오 / 검색 입력이 모두 보인다"
    - "툴바에 자료수 N건 + [일괄품번매핑/일괄단품매핑/일괄주문확정/다운로드/선택삭제/매핑해제] 액션 버튼이 보인다"
    - "테이블 헤더가 2그룹(쇼핑몰 수집 데이터 / 매핑 적용 결과) 으로 colSpan 분할되어 렌더된다 (탭 아님)"
    - "좌측 그룹에 주문금액(unitPrice * qty) 컬럼이 추가되어 보인다"
    - "우측 그룹에 확정여부(매핑완료=mapped_at IS NOT NULL) 배지가 보인다"
    - "행의 [+ 품번]/[+ 단품] 버튼 클릭 시 모달이 열려 자체상품 검색 후 즉시 매핑 저장된다"
    - "page=1 진입 시 pageSize 기본값이 25 이다"
    - "PageSizeSelector 가 테이블 위에(툴바와 함께) 배치되어 있다"
    - "탭(`<button>` 으로 구현된 좌/우 전환 컨트롤) 이 어디에도 없다"
  artifacts:
    - path: "src/app/(auth)/products/mapping/order-rows-board.tsx"
      provides: "사방넷 스타일 매핑보드 UI — dense 필터 + 툴바 + 2그룹 테이블 + 모달"
      contains: "쇼핑몰 수집 데이터"
    - path: "src/app/(auth)/products/mapping/order-rows-board.tsx"
      provides: "확정여부 배지 + 주문금액 컬럼"
      contains: "확정여부"
    - path: "src/app/(auth)/products/mapping/order-rows-board.tsx"
      provides: "searched sentinel — 검색 버튼 클릭 전 fetch 차단"
      contains: "searched"
    - path: "src/app/api/products/mapping-codes/order-rows/route.ts"
      provides: "행별 unitPrice / totalAmount / mappedAt / 카테고리·상태 필터 지원"
      contains: "unitPrice"
  key_links:
    - from: "order-rows-board.tsx"
      to: "/api/products/mapping-codes/order-rows"
      via: "fetch only when searched=1 sentinel set"
      pattern: "searched.*=.*1"
    - from: "order-rows-board.tsx"
      to: "/api/orders/apply-mappings"
      via: "POST 일괄주문확정 / 일괄품번매핑 / 일괄단품매핑"
      pattern: "apply-mappings"
    - from: "order-rows-board.tsx (다운로드)"
      to: "Excel export (window.location 또는 fetch+blob)"
      via: "현재 필터 + selected 행을 query string 으로 전달"
      pattern: "download|export"
---

<objective>
매핑관리 페이지(`/products/mapping`) 를 사방넷 주문서확정관리 스타일로 한 단계 더 개선한다.

기존 `order-rows-board.tsx` (260429-wnp 에서 도입) 의 dense 필터 + 2그룹 테이블 구조는 유지하되,
사용자 요구사항에 맞춰 다음을 추가/변경한다:

- 필터: **선택사항 I~IV** (쇼핑몰 / 카테고리 / 상태 / 기타) 4개 select 추가
- 필터: 매핑선택 라디오 그룹 라벨 정확히 일치 (전체/품번매핑/품번미매핑 + 전체/단품매핑/단품미매핑/SKU매핑)
- 동작: **searched=1 sentinel** — 검색 버튼 누르기 전엔 어떤 fetch 도 안 일어남 (`/orders` 페이지 패턴 일치)
- 툴바: **일괄주문확정 / 다운로드 / 선택삭제** 버튼 추가 (기존 일괄품번/단품매핑/매핑해제는 유지)
- 테이블 좌측 그룹: **주문금액** 컬럼 추가 (`oi.unit_price * oi.quantity`)
- 테이블 우측 그룹: **확정여부** 배지 추가 (`orders.mapped_at IS NOT NULL` → "확정완료")
- 페이지네이션: **기본 pageSize 25**, 상단 배치 (이미 상단이지만 기본값 변경)
- **탭 절대 금지** — 모든 인터랙션은 단일 화면 + 모달로

Purpose: 사용자가 매핑관리에서 한 화면에서 필터-선택-매핑-확정-다운로드 까지 끊김 없이 처리할 수 있게 한다 (사방넷 워크플로우 그대로).
Output: order-rows-board.tsx 와 order-rows API 가 위 변경을 반영한 단일 commit.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@AGENTS.md
@.planning/STATE.md

# 기존 매핑관리 보드 — 베이스
@src/app/(auth)/products/mapping/order-rows-board.tsx
@src/app/(auth)/products/mapping/page.tsx
@src/app/(auth)/products/mapping/mapping-manager.tsx

# Order rows API — 행 단위 좌/우 통합 조회
@src/app/api/products/mapping-codes/order-rows/route.ts

# 일괄확정 API (재사용)
@src/app/api/orders/apply-mappings/route.ts

# searched sentinel 패턴 참고 (`tab` 미선택 시 fetch skip)
@src/app/(auth)/orders/page.tsx
@src/app/(auth)/orders/filters.tsx

# 페이지네이션 컴포넌트
@src/components/ui/pagination.tsx

<interfaces>
<!-- 기존 OrderRow 타입 (order-rows API 의 응답) — 이번에 unitPrice / totalAmount / mappedAt 추가 -->
```typescript
// 기존
interface OrderRow {
  orderItemId: string
  orderId: string
  marketplaceId: string
  marketplaceOrderId: string
  orderedAt: string
  marketplaceItemId: string
  productName: string
  optionText: string | null
  quantity: number
  mappingStatus: 'both' | 'option' | 'product' | 'unmapped'
  hasProductMapping: boolean
  hasOptionMapping: boolean
  mappingSourceId: string | null
  mappingCodeId: string | null
  mappingCode: string | null
  mappingName: string | null
  components: OrderRowComponent[]
}

// 이번 plan 에서 추가
interface OrderRow {
  // ... 기존 필드
  unitPrice: string | null      // oi.unit_price (decimal as string)
  totalAmount: string | null    // unitPrice * quantity, server-side calculated
  mappedAt: string | null       // orders.mapped_at — null 이면 미확정, 아니면 매핑완료(확정완료)
}
```

<!-- order_items 컬럼 참고 (기존 schema):
  - oi.unit_price        decimal
  - oi.quantity          integer
  - orders.mapped_at     timestamp(nullable)
-->

<!-- apply-mappings API — 변경 없이 재사용 -->
```typescript
POST /api/orders/apply-mappings
Body: { orderIds: string[] }
Returns: { applied: number }
// orders.mapped_at = now(), orders.mapped_by_user_id = user.id
```

<!-- 선택삭제 / 다운로드 — 신규 엔드포인트 만들지 말 것.
     선택삭제: 사용자가 주문을 직접 삭제하는 것이 아닌, 매핑보드 화면에서 행을 숨기는 의미.
              기존 매핑해제(`mapping-codes` 마스터에서 마켓상품 행 제거) 와 별개로,
              "이 주문은 매핑 대상에서 제외" — orders 에 별도 컬럼 없으므로 alert("미구현 — 선택된 N건") 로 plumbing 만 깔고 실제 동작은 후속 plan.
     다운로드: 현재 필터/선택 행을 Excel 로 내보내기 — 이번 plan 범위에서는
              `alert('다운로드 기능은 후속 plan 에서 구현')` 로 button 만 노출.
     일괄주문확정: 선택된 행의 orderId 전체에 대해 apply-mappings 호출 (mode 무관). -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: order-rows API 에 unitPrice / totalAmount / mappedAt 추가</name>
  <files>src/app/api/products/mapping-codes/order-rows/route.ts</files>
  <action>
    `src/app/api/products/mapping-codes/order-rows/route.ts` 의 SELECT 절과 OrderRow 인터페이스에
    행별 금액과 확정상태 필드를 추가한다.

    **OrderRow interface 변경** (route.ts 상단 type 정의):
    ```typescript
    interface OrderRow {
      // ... 기존 필드 그대로
      unitPrice: string | null      // 단가 (decimal as string)
      totalAmount: string | null    // unitPrice * quantity (server-side)
      mappedAt: string | null       // orders.mapped_at (null = 미확정, value = 확정완료)
    }
    ```

    **데이터 SELECT 변경** (line 162 근방의 `SELECT ... FROM order_items oi` 절):
    기존 `oi.quantity AS "quantity"` 다음에 다음 컬럼 추가:
    ```sql
    oi.unit_price                   AS "unitPrice",
    (oi.unit_price * oi.quantity)   AS "totalAmount",
    o.mapped_at                     AS "mappedAt",
    ```

    **TypeScript 매핑** (rawRows.map((r) => ({ ... })) 부분):
    ```typescript
    unitPrice: (r.unitPrice as string | null) ?? null,
    totalAmount: (r.totalAmount as string | null) ?? null,
    mappedAt: r.mappedAt ? new Date(r.mappedAt as string).toISOString() : null,
    ```

    **주의사항:**
    - Postgres decimal 컬럼은 drizzle execute 에서 string 으로 반환됨 — 그대로 string 으로 응답
    - mapped_at 은 nullable timestamp — null 처리 필수
    - 기존 LATERAL JOIN / EXISTS 로직은 절대 변경 금지 (매칭 우선순위 깨짐)
    - 기존 productMatch / optionMatch / from / to / marketplaceIds / q 필터 로직 그대로 유지
    - 기존 `pageSize Math.min(200, ...)` 캡 유지하되, 새 default 25 와는 별개 (서버는 max 캡, 클라이언트가 default 결정)

    **Schema 확인:**
    - `oi.unit_price` 컬럼 존재 확인 — 없으면 `oi.price` / `oi.sale_price` 등으로 대체. drizzle schema(`src/lib/db/schema.ts`) 의 `orderItems` 테이블에서 정확한 컬럼명을 먼저 grep 으로 확인할 것:
      ```bash
      grep -n "unit_price\|unitPrice\|price" src/lib/db/schema.ts | head -20
      ```
    - 컬럼명이 `unit_price` 가 아니면 SELECT 와 곱셈식을 실제 컬럼명으로 치환
  </action>
  <verify>
    <automated>
    # 1) 타입스크립트 컴파일 통과
    npx tsc --noEmit -p . 2>&1 | grep -E "src/app/api/products/mapping-codes/order-rows" | head -5
    # 빈 출력이면 통과
    # 2) API 응답 shape 수동 확인 (개발 서버에서 curl)
    # curl 'http://localhost:3000/api/products/mapping-codes/order-rows?from=2026-04-01&to=2026-04-30&page=1&pageSize=10' -b 'cookies' | jq '.rows[0] | keys'
    # 결과에 "unitPrice", "totalAmount", "mappedAt" 가 포함되어야 함
    </automated>
  </verify>
  <done>
    - OrderRow 인터페이스에 unitPrice, totalAmount, mappedAt 3개 필드 추가됨
    - SELECT 절에 해당 컬럼이 추가되어 응답 JSON 에 노출됨
    - tsc 통과, 기존 필터 로직 변경 없음 (diff 가 추가만 있고 기존 SQL 변경 없음)
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: order-rows-board.tsx 를 사방넷 dense UI 요구사항 모두 반영하여 리라이트</name>
  <files>src/app/(auth)/products/mapping/order-rows-board.tsx</files>
  <action>
    기존 `order-rows-board.tsx` 를 베이스로 다음 변경을 적용한다 (전체 리라이트가 아니라 targeted 수정):

    ### 2-1. nuqs 필터 스키마 확장 — 신규 필터 + sentinel 추가

    `useQueryStates({...})` 호출에 다음 필드 추가:
    ```typescript
    {
      // 기존 from, to, mkt, productMatch, optionMatch, q, page, pageSize 유지
      // 신규
      category: parseAsString,                                  // 카테고리 (선택사항 II)
      orderStatus: parseAsString,                               // 주문상태 (선택사항 III)
      etc: parseAsString,                                       // 기타 (선택사항 IV)
      searched: parseAsInteger.withDefault(0),                  // 0 = 미검색, 1 = 검색됨 sentinel
      // pageSize default 변경
      pageSize: parseAsInteger.withDefault(25),                 // 기본값 50 → 25
    }
    ```

    `mkt` 는 그대로 유지 (선택사항 I = 쇼핑몰).
    카테고리/주문상태/기타 옵션 목록은 일단 placeholder 로:
    ```typescript
    const CATEGORY_OPTIONS = [
      { value: '', label: '전체 카테고리' },
      // 후속 plan 에서 실제 카테고리 채움
    ]
    const ORDER_STATUS_OPTIONS = [
      { value: '', label: '전체 상태' },
      { value: 'new', label: '신규' },
      { value: 'confirmed', label: '확인' },
      { value: 'preparing', label: '출고준비' },
      { value: 'shipped', label: '배송중' },
      { value: 'delivered', label: '배송완료' },
      { value: 'cancelled', label: '취소' },
    ]
    const ETC_OPTIONS = [
      { value: '', label: '기타 — 전체' },
      { value: 'has_memo', label: '메모 있음' },
      { value: 'gift', label: '선물주문' },
    ]
    ```

    ### 2-2. searched sentinel — 검색 버튼 누르기 전 fetch 차단

    `reload` 안에서 가장 먼저:
    ```typescript
    if (filters.searched !== 1) {
      setRows([])
      setTotal(0)
      setLoading(false)
      return
    }
    ```

    `submitSearch` 에서 `setFilters({ q: searchInput.trim() || null, page: 1, searched: 1 })` 로 검색 시점에 sentinel 세팅.

    필터 변경 (date / mkt / category / orderStatus / etc / productMatch / optionMatch) 핸들러는 sentinel 을 건드리지 않음 — 이미 검색된 상태라면 자동 reload, 미검색 상태라면 그대로 0 결과.

    `resetFilters` 는 `searched: 0` 으로 되돌려서 다시 안내문구 상태로:
    ```typescript
    void setFilters({ from: null, to: null, mkt: null, category: null, orderStatus: null, etc: null,
                     productMatch: 'all', optionMatch: 'all', q: null, page: 1, searched: 0 })
    ```

    `useOrders` 페이지 패턴(`tab` 미선택 시 안내문구) 처럼 테이블 영역은 다음 분기 추가:
    ```tsx
    {filters.searched !== 1 ? (
      <div className="rounded border bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground">
        상단 필터 설정 후 [조회] 버튼을 눌러 매핑관리 데이터를 불러오세요.
      </div>
    ) : (
      <table ...>...</table>
    )}
    ```

    ### 2-3. 필터 패널 — 사방넷 폼 그대로

    기존 4-row 필터 패널을 다음 6-row 로 확장:

    - **Row 1 — 수집일자**: 그대로 유지 (date / date / quick range buttons)
    - **Row 2 — 선택사항 I (쇼핑몰)**: 기존 chip 토글 그대로 유지 (사용성 좋음)
    - **Row 2.5 — 선택사항 II~IV**: 한 줄에 select 3개 가로 배치
      ```tsx
      <div className="flex flex-wrap items-center gap-2 border-b py-1.5">
        <span className="w-16 shrink-0 text-muted-foreground">선택사항</span>
        <select value={filters.category ?? ''} onChange={(e) => setFilters({ category: e.target.value || null, page: 1 })}
                className="rounded border px-2 py-0.5 text-xs">
          {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filters.orderStatus ?? ''} ...>{ORDER_STATUS_OPTIONS.map(...)}</select>
        <select value={filters.etc ?? ''} ...>{ETC_OPTIONS.map(...)}</select>
      </div>
      ```
    - **Row 3 — 매핑선택 라디오 2그룹**: 라벨을 사용자 요구사항 정확히 일치하게:
      - PRODUCT_MATCH_OPTIONS: `[{all,'전체'},{matched,'품번매핑'},{unmatched,'품번미매핑'}]` (기존 그대로)
      - OPTION_MATCH_OPTIONS: `[{all,'전체'},{matched,'단품매핑'},{unmatched,'단품미매핑'},{sku,'SKU매핑'}]` (기존 그대로)
      - 두 그룹을 한 줄에 두지 말고 두 줄로 분리 (사용자 명세: "1줄 / 2줄"):
        ```tsx
        <div className="flex items-center gap-1.5 border-b py-1">
          <span className="w-16 shrink-0 text-muted-foreground">매핑선택</span>
          {PRODUCT_MATCH_OPTIONS.map((opt) => <label>...</label>)}
        </div>
        <div className="flex items-center gap-1.5 border-b py-1">
          <span className="w-16 shrink-0 text-muted-foreground"></span>{/* 정렬용 빈 라벨 */}
          {OPTION_MATCH_OPTIONS.map((opt) => <label>...</label>)}
        </div>
        ```
    - **Row 4 — 검색**: 기존 `<form onSubmit={submitSearch}>` 유지하되 placeholder 라벨을 "검색항목" 으로:
      ```tsx
      <span className="w-16 shrink-0 text-muted-foreground">검색항목</span>
      <select disabled className="rounded border bg-background px-2 py-0.5 text-xs text-muted-foreground">
        <option>쇼핑몰상품코드/상품명/옵션</option>
      </select>
      <input ... placeholder="검색어 입력" />
      <button type="submit">조회</button>
      <button type="button" onClick={resetFilters}>초기화</button>
      ```

    ### 2-4. 툴바 — 액션 버튼군 확장

    툴바 우측에 신규 버튼 3개 추가 (기존 일괄품번/일괄단품/매핑해제/새로고침 사이에):
    ```tsx
    <Button onClick={() => void applyBulkOrderConfirm()} disabled={applying}
            size="sm" variant="outline" className="h-7 px-2 text-xs">
      일괄주문확정
    </Button>
    <Button onClick={handleDownload} size="sm" variant="outline" className="h-7 px-2 text-xs">
      다운로드
    </Button>
    <Button onClick={handleSelectDelete} size="sm" variant="outline" className="h-7 px-2 text-xs"
            disabled={selected.size === 0}>
      선택삭제
    </Button>
    ```

    동작 정의:
    - `applyBulkOrderConfirm` — 선택된 행의 unique orderId 들에 대해 mode 무관하게 `apply-mappings` 호출:
      ```typescript
      async function applyBulkOrderConfirm() {
        const selRows = rows.filter((r) => selected.has(r.orderItemId))
        if (selRows.length === 0) return alert('선택된 행이 없습니다')
        const orderIds = Array.from(new Set(selRows.map((r) => r.orderId)))
        if (!confirm(`선택된 ${orderIds.length}건의 주문을 매핑확정 처리합니다. 진행할까요?`)) return
        setApplying(true)
        try {
          const res = await fetch('/api/orders/apply-mappings', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderIds }),
          })
          if (!res.ok) { alert('주문확정 실패'); return }
          const data = await res.json() as { applied: number }
          alert(`주문확정 ${data.applied}건 처리됨`)
          setSelected(new Set())
          await reload()
        } finally { setApplying(false) }
      }
      ```
    - `handleDownload` — 이번 plan 범위 외, plumbing 만:
      ```typescript
      function handleDownload() {
        alert('다운로드 기능은 후속 plan 에서 구현됩니다 (현재 필터+선택행 기준 Excel export 예정)')
      }
      ```
    - `handleSelectDelete` — 이번 plan 범위 외, plumbing 만:
      ```typescript
      function handleSelectDelete() {
        if (selected.size === 0) return
        alert(`선택삭제는 후속 plan 에서 구현됩니다 (선택 ${selected.size}건)`)
      }
      ```

    PageSizeSelector 의 default 도 25로 일치시켜야 함 — `pageSize={pageSize}` 에 nuqs default 25 가 흘러감 (자동).

    ### 2-5. 테이블 — 좌:주문금액 / 우:확정여부 추가

    OrderRow 인터페이스를 Task 1 의 새 필드로 확장:
    ```typescript
    interface OrderRow {
      // ... 기존 필드
      unitPrice: string | null
      totalAmount: string | null
      mappedAt: string | null
    }
    ```

    헤더 colSpan 변경:
    - 좌측 그룹 colSpan: **6 → 7** (수량 다음 주문금액 1개 추가)
    - 우측 그룹 colSpan: **4 → 5** (수량 다음 확정여부 1개 추가)
    - 전체 colSpan (loading/empty tr): **11 → 13**

    헤더 second row 에 컬럼 추가:
    ```tsx
    {/* 좌측 — 수량 다음 */}
    <th className="border-b px-1.5 py-1 text-right font-medium">주문금액</th>
    {/* 매핑여부 그대로 */}
    {/* 우측 — 수량 다음 */}
    <th className="border-b px-1.5 py-1 text-center font-medium">확정여부</th>
    ```

    데이터 cells 추가:
    ```tsx
    {/* 좌측: 수량 td 다음 */}
    <td rowSpan={compsOrEmpty.length} className="px-1.5 py-1 text-right align-top tabular-nums">
      {r.totalAmount != null ? Number(r.totalAmount).toLocaleString('ko-KR') : '-'}
    </td>
    {/* 우측: 수량 td 다음 */}
    <td className="px-1.5 py-1 text-center">
      {r.mappedAt ? (
        <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100">확정완료</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">미확정</Badge>
      )}
    </td>
    ```

    ### 2-6. **탭 절대 금지 검증**

    파일 내 `<button>` / `<div>` 가 탭 전환 컨트롤로 사용된 곳이 없어야 함. 마켓 chip 토글은 탭이 아닌 다중선택 필터이므로 OK.

    ### 2-7. 기타 정리

    - 첫 진입 시 `searched=0` → 안내문구만 보임 → fetch 0번 (성능)
    - reload 의 useEffect dependency 에 `filters.searched`, `filters.category`, `filters.orderStatus`, `filters.etc` 추가
    - category/orderStatus/etc 는 이번 plan 에서 서버 필터 미적용 (UI 만 노출). reload 의 URLSearchParams 에 넣지 않음. 후속 plan 에서 API 확장.
    - 기존 BulkMappingModal / submitBulkMapping / openMapping / openUnmap 은 변경 없이 그대로 유지
    - PageSizeSelector pageSizeOptions 는 `[25, 50, 100, 200, 500, 1000]` 그대로

    **주의사항:**
    - Next.js 16 — `node_modules/next/dist/docs/` 의 nuqs 사용 패턴 변경 여부 확인 (이번 plan 은 기존 nuqs 사용 패턴을 그대로 따르므로 영향 없음 예상, 그래도 확인)
    - 'use client' directive 유지
    - `parseAsInteger`, `parseAsString`, `parseAsStringEnum` import 유지하고 필요시 추가
    - 기존 BulkMappingModal 함수 본문은 한 글자도 수정 금지 (행의 [+ 품번]/[+ 단품] 클릭 시 모달 동작이 검증됨)
    - 사용자 요구사항: **탭 절대 금지** — 코드 어디에도 "tab" 변수/state/UI element 추가 금지
  </action>
  <verify>
    <automated>
    # 1) tsc 통과
    npx tsc --noEmit -p . 2>&1 | grep -E "order-rows-board" | head -5
    # 빈 출력 = 통과
    # 2) lint 통과 (있다면)
    npx eslint src/app/\(auth\)/products/mapping/order-rows-board.tsx 2>&1 | tail -10
    # 3) 탭 컴포넌트 미사용 확인
    grep -i -E "tab|Tabs" src/app/\(auth\)/products/mapping/order-rows-board.tsx | grep -v "tabular-nums" | grep -v "^//\|^\s*\*" || echo "PASS — 탭 컨트롤 없음"
    # 4) sentinel 확인
    grep -n "searched" src/app/\(auth\)/products/mapping/order-rows-board.tsx | head -5
    # "searched: parseAsInteger" 와 "filters.searched !== 1" 등이 보여야 함
    # 5) 신규 select 3개 확인
    grep -E "CATEGORY_OPTIONS|ORDER_STATUS_OPTIONS|ETC_OPTIONS" src/app/\(auth\)/products/mapping/order-rows-board.tsx | wc -l
    # ≥ 6 (선언 3개 + 사용 3개)
    # 6) 신규 액션 버튼 확인
    grep -E "일괄주문확정|다운로드|선택삭제" src/app/\(auth\)/products/mapping/order-rows-board.tsx | wc -l
    # ≥ 3
    # 7) 주문금액 / 확정여부 텍스트 노출
    grep -E "주문금액|확정여부|확정완료|미확정" src/app/\(auth\)/products/mapping/order-rows-board.tsx | wc -l
    # ≥ 4
    </automated>
  </verify>
  <done>
    - 페이지 진입 시 fetch 0번, "조회" 버튼 누른 뒤부터 fetch 시작 (Network tab 으로 검증)
    - 필터 패널에 수집일자 + 쇼핑몰 chip + 카테고리/상태/기타 select 3개 + 매핑선택 2행 라디오 + 검색 입력 모두 보임
    - 툴바에 [일괄품번매핑/일괄단품매핑/일괄주문확정/다운로드/선택삭제/매핑해제/새로고침] 7개 액션 버튼 보임
    - 테이블 좌측 그룹에 주문금액 컬럼, 우측 그룹에 확정여부 배지 보임
    - 탭(`<button>` 으로 좌/우 전환) UI 는 어디에도 없음
    - 기본 pageSize=25, page=1 진입 시 selector 가 25 로 표시됨
    - 기존 `[+ 품번]`/`[+ 단품]` 모달 인라인 매핑 흐름은 그대로 동작
  </done>
</task>

</tasks>

<verification>
**자동 검증:**
- `npx tsc --noEmit -p .` — 컴파일 에러 0
- `grep -i tab src/app/\(auth\)/products/mapping/order-rows-board.tsx` — `tabular-nums` 외 매치 없음
- 신규 컬럼/필드 SQL 응답에 노출 (curl 또는 브라우저 devtool)

**수동 검증 (사용자):**
1. `/products/mapping` 진입 → 안내문구만 보이고 자료수=0
2. 수집일자 1개월 선택, "조회" 클릭 → 자료가 로드되고 자료수가 표시됨
3. 행을 체크, "일괄주문확정" → confirm dialog → "주문확정 N건 처리됨" alert
4. 매핑완료된 행의 우측 그룹에 "확정완료" 배지가 보임
5. 좌측 그룹에 주문금액 컬럼이 표시되고 ko-KR locale 천단위 콤마 포맷
6. 카테고리/상태/기타 select 가 보이지만 변경해도 (서버 필터 미적용) 결과 변화 없음 — UI plumbing 만 확인
7. "다운로드", "선택삭제" 클릭 시 "후속 plan 에서 구현" alert 노출
</verification>

<success_criteria>
1. tsc 통과
2. /products/mapping 첫 진입 fetch 0번
3. "조회" 버튼 클릭 후 정상 fetch 및 테이블 렌더
4. 좌:7컬럼(쇼핑몰/주문번호/상품코드/상품명·옵션/수량/주문금액/매핑여부) + 우:5컬럼(품번-단품/SKU/상품명·옵션·재고/수량/확정여부) = 12 데이터 + 1 체크박스 = 13 colSpan
5. 사용자 명세의 모든 액션 버튼이 툴바에 노출됨 (동작은 일괄확정만 실제 작동, 나머지 2개는 plumbing)
6. 탭 UI 부재 — 코드/UI 어디에도 없음
7. git 커밋 1개로 종료, push 즉시 실행
</success_criteria>

<output>
태스크 완료 후 다음 파일 생성:
.planning/quick/260430-gbu-dense-2/260430-gbu-SUMMARY.md

내용:
- 변경된 파일 목록 (2개)
- 추가된 OrderRow 필드 3개 (unitPrice/totalAmount/mappedAt)
- 신규 nuqs 필터 (category/orderStatus/etc/searched) + default pageSize 25
- 신규 액션 버튼 3개 동작 요약
- 후속 plan 후보:
  * 다운로드 — 현재 필터+선택 행 Excel export
  * 선택삭제 — orders 에 hidden_from_mapping 컬럼 추가 + 필터링
  * category/orderStatus/etc 서버 필터 적용 (API 확장)
</output>
