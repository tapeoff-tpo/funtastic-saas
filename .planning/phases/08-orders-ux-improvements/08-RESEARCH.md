# Phase 8: 주문관리 UX 개선 - Research

**Researched:** 2026-04-26
**Domain:** Next.js 16 admin dashboard UX, Drizzle schema migration, Korean marketplace inquiry APIs
**Confidence:** HIGH (architecture/data) / MEDIUM (Naver inquiry API path)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**탭/필터 구조 (취소 탭 + 단계별 필터)**
- 주문관리 상단 탭 구조는 단계별로 명확히 구분: **신규/확인/출고대기/출고완료/배송중/배송완료/취소/교환/반품**
- 각 탭에 정확한 카운트 표시 (마켓 + 사용자 스코프 적용된 SQL 카운트)
- 취소 탭은 cancellation_claim 또는 status='cancelled'인 주문 필터링
- 교환/반품 탭은 해당 클레임 타입(exchange/return)이 있는 주문 필터링
- 탭과 별도로 좌측 사이드/상단 필터바에 마켓플레이스/날짜/검색은 유지

**엑셀 업로드 제거**
- 주문관리 메인 헤더에서 "엑셀 업로드" 버튼/진입점 **완전 제거**
- 기존 엑셀 업로드 페이지(`/orders/import` 등) 자체는 유지 — 다만 주문관리 화면 내 진입점만 제거

**클레임/문의 인디케이터 통합 (CS 컬럼 제거)**
- 기존 별도 "CS" 컬럼 **완전 제거**
- 좌측 **첫 번째 컬럼(클레임)** 에 뱃지/아이콘으로 표시
- 클레임 있음 (cancel/return/exchange) → 색상별 뱃지
- 문의 있음 → 별도 아이콘
- 둘 다 있으면 둘 다 표시
- "문의" 데이터: 가능한 마켓플레이스(쿠팡/네이버 등)에서 수집해서 저장
- 데이터가 없는 마켓은 인디케이터 미표시 (오류 아님)

**매핑된 상품명 표시 (displayName)**
- 주문 행의 상품명 컬럼은 **매핑된 SaaS 상품의 displayName**을 우선 표시
- 매핑이 없는 주문은 마켓 원본 상품명 그대로 표시 (fallback)
- 매핑 정보는 product_mappings / option_mappings 테이블에서 조회
- 원본 마켓 상품명도 보고 싶을 수 있으니 tooltip 또는 보조 표시(작은 회색 글자)로 함께 노출

**배송구분 + 배송비 컬럼**
- **배송구분** 컬럼: 주문에 포함된 배송 타입 (예: 일반/선결제/착불/무료) — 마켓에서 수집
- **수집 배송비** 컬럼: 마켓에서 수집된 배송비 (orders 테이블에 이미 있을 가능성 — 확인 필요 → 현재 미저장)
- **SaaS 배송비(원가)** 컬럼: SaaS에 등록된 배송비 — products 또는 inventory의 새 필드
- 두 배송비를 별도 컬럼으로 노출해 차이를 한눈에 볼 수 있게 함

**재고관리에 배송비 입력**
- 재고관리 화면(`/inventory`)에서 상품별로 **배송비(원가)** 입력/수정 가능해야 함
- 스키마 확장: `products` 테이블에 `shipping_cost` (numeric, nullable) 추가 — 또는 inventory 측에 추가

### Claude's Discretion
- 탭 UI 구체적 디자인 (색상, 위치, 아이콘) — shadcn/ui 패턴 준수
- 클레임/문의 인디케이터 시각 표현 (이모지 vs 색칠 점 vs 아이콘 라이브러리)
- 문의 수집 구현 범위 — 어떤 마켓 어댑터부터 우선 (쿠팡/네이버 권장)
- 배송비 컬럼이 길어지면 테이블이 좁아지는 문제 — 컬럼 토글 또는 압축 표시
- 매핑 displayName이 너무 길 때 truncate

### Deferred Ideas (OUT OF SCOPE)
- **매출관리 화면** — 제품원가 / 배송비원가 / 판매가 / 수령배송비 기반 수익 계산 (별도 phase)
- **배송비 자동 적용 로직** — SaaS 등록 배송비를 주문 처리 시 자동 사용 (이번엔 표시까지만)
- **문의 답변 기능** — 수집된 문의에 답변 보내기 (이번엔 인디케이터 표시까지만)
- **매핑 자동 추천**
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-01 | 취소 탭에 정확한 카운트가 표시되고 클릭 시 취소 클레임 주문만 필터링 | `claims.claimType='cancel'` 카운트는 이미 `getOrderStats()`에서 계산됨 (line 539-575). claimType='cancel' 필터는 `getOrders()`에서 이미 동작 (line 131-159). status='cancelled' 추가 OR 조건이 누락되어 있어 — 이게 "비활성화"의 원인일 가능성 |
| SC-02 | 엑셀 업로드 진입점 제거 + 단계별(출고대기/출고완료/교환 등) 탭/필터로 대체 | `page.tsx` line 128-134의 "엑셀 업로드" 링크 제거. `stage-tabs.tsx`가 이미 존재 — 현재는 `claims-filter.tsx`만 표시 중 (page.tsx line 138-142). 9개 탭 통합 또는 2단 탭 구조 결정 필요 |
| SC-03 | CS 컬럼 제거 → 클레임/문의 인디케이터를 좌측 첫 컬럼에 통합 (가능한 마켓에서 문의도 수집) | `columns.tsx` line 388-420의 CS 컬럼 제거. line 187-210 (statusActions, 첫번째 데이터 컬럼)에 클레임 뱃지 + 문의 아이콘 통합. inquiry 수집은 신규 어댑터 메서드 + DB 테이블 + 워커 통합 필요 |
| SC-04 | 매핑된 상품의 displayName 표시 (원본명 아님) | `product_name_mappings` 테이블이 이미 존재 (schema.ts line 529-553). 현재 `columns.tsx` line 288에서 `first.productName` (원본명)을 표시 중. queries.ts에서 displayName join 추가 필요 (현재는 매핑 status 판정용으로만 사용) |
| SC-05 | 단계별 필터가 빠짐없이 동작하고 카운트 정확 | `matchStage()` 로직은 queries.ts line 14-45에 있음 — 단, **post-fetch filter** 라서 카운트가 페이지 결과 한정. **stage별 카운트는 별도 SQL이 필요** (현재 `getOrderStats`에는 없음) |
| SC-06 | 배송구분 + 수집 배송비 + SaaS 배송비(원가) 별도 컬럼 노출 | orders 스키마에 shippingType/shippingFee 필드 **없음**. NormalizedOrder에도 없음. 어댑터에서는 Coupang `shippingPrice`/`shipmentType`이 raw로 들어옴 (저장 안됨). 신규 마이그레이션 + adapter normalize 변경 필요 |
| SC-07 | 재고관리에서 상품별 배송비(원가) 입력/수정 가능 | products 스키마에 `shipping_cost` 필드 **없음**. inventory 화면은 SKU 기반, products는 internalSku 기반 — 조인 필요. inventory 페이지 (`page.tsx`/`inventory-table.tsx`) 컬럼 추가 + 인라인 수정 UI |
</phase_requirements>

## Summary

Phase 8은 기존에 이미 build되어 있는 주문관리 시스템(orders/claims/products/inventory schema 모두 존재) 위에 **UI/UX 통합과 새로운 데이터 필드 노출**을 얹는 phase다. 핵심 작업은 5가지: (1) tab 구조 통합 (claimsFilter + stageTabs 통합 또는 9탭 단일화), (2) CS 컬럼 제거 후 클레임/문의 인디케이터를 첫 컬럼에 합치기, (3) `product_name_mappings.display_name`을 주문 테이블 표시에 활용, (4) `orders.shippingType`/`orders.shippingFee` 신규 컬럼 + Coupang/Naver normalize 확장, (5) `products.shipping_cost` 신규 컬럼 + 재고관리 인라인 입력 UI + 주문 행 join 표시.

**가장 큰 변경은 데이터 모델 확장 2건** (orders 측 shippingType/shippingFee, products 측 shipping_cost). 그 외엔 기존 코드 수정.

**Inquiry 수집은 완전히 새로운 도메인.** MarketplaceAdapter 인터페이스에 `getInquiries(since: Date): Promise<NormalizedInquiry[]>`을 신규 추가, `inquiries` 테이블 신설, BullMQ 워커에 inquiry 수집 작업 추가, Coupang/Naver 어댑터에서 우선 구현. Coupang 문의 API는 명확히 존재(`/v5/vendors/{vendorId}/onlineInquiries`, `/v5/vendors/{vendorId}/callCenterInquiries`, `/v4/.../customer-inquiries`).

**Primary recommendation:** 4개의 plan으로 분할 — (P1) 데이터 모델 확장 (마이그레이션 + schema/types + normalize), (P2) 주문 테이블 UI 리팩터 (탭 통합, CS 제거, 인디케이터, displayName, 배송비 컬럼), (P3) 재고관리 shipping_cost 입력 UI, (P4) 문의 수집 (Coupang 우선, Naver는 best-effort 또는 별도 quick).

## Project Constraints (from CLAUDE.md)

| Directive | Source | Phase 8 Impact |
|-----------|--------|----------------|
| Next.js 16 has breaking changes — read `node_modules/next/dist/docs/` before code | AGENTS.md | params/searchParams는 Promise (이미 페이지에서 await 중 — page.tsx line 51, 57) |
| Drizzle ORM (no Prisma) | CLAUDE.md | 신규 마이그레이션은 `supabase/migrations/0XX_*.sql` + `src/lib/db/schema.ts` 동기화 |
| Tailwind v4 + shadcn/ui | CLAUDE.md | Badge/Dialog/Input은 이미 사용 중. 신규 인라인 입력은 Input 사용 |
| nuqs for URL state | CLAUDE.md / 기존 코드 | 탭 변경은 `useQueryState` 사용 (이미 확립된 패턴 — claims-filter, stage-tabs) |
| TanStack Table v8 | CLAUDE.md | columns.tsx 직접 수정. v9 alpha 사용 금지 |
| BullMQ for background work | CLAUDE.md | inquiry 수집은 신규 BullMQ repeatable job |
| 자체 사용 우선, 안정화 후 셀러 서비스화 | CLAUDE.md | 인디케이터 미지원 마켓은 조용히 미표시 (에러 아님) — Decisions와 일치 |
| GSD 워크플로우 통해서만 편집 | CLAUDE.md | plan 단계에서 task로 분할 — 직접 편집 금지 |

## Standard Stack

### Core (already installed — confirmed via package.json)
| Library | Version (verified) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.2.2 | App Router, async searchParams | Already installed |
| react | 19.2.4 | UI | Already installed |
| @tanstack/react-table | 8.21.3 | Headless table — `columns.tsx` 사용 | Already installed |
| drizzle-orm | 0.45.2 | Schema + queries | Already installed |
| @supabase/ssr | 0.10.0 | Server auth (`createClient`) | Already installed |
| nuqs | 2.8.9 | URL state for tabs/filters | Already installed |
| zod | 4.3.6 | API body validation | Already installed |
| ky | 1.14.3 | Marketplace HTTP client | Already installed |
| bullmq | 5.72.1 | Inquiry collection worker | Already installed |
| sonner | 2.0.7 | Toast for inline edit success/fail | Already installed |
| lucide-react | 1.7.0 | 아이콘 (인디케이터용 MessageCircle, AlertCircle 등) | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | 4.1.0 | KST 변환 (이미 어댑터에서 사용) | inquiry 수집 시 `since` 변환 |
| pino | 10.3.1 | Inquiry 수집 로깅 | 워커 통합 |

### No new dependencies required
모든 작업이 기존 stack으로 가능. 신규 install 없음.

## Architecture Patterns

### Recommended Layout
```
src/
├── app/(auth)/
│   ├── orders/
│   │   ├── page.tsx                  # 헤더에서 엑셀 업로드 제거, 탭 구조 통합
│   │   ├── columns.tsx               # CS 컬럼 제거, statusActions에 인디케이터 통합, displayName 표시, 배송 컬럼 신설
│   │   ├── stage-tabs.tsx            # (가능하면) 단일 통합 탭 컴포넌트로 합치기
│   │   ├── claims-filter.tsx         # 통합되면 제거 가능
│   │   └── ...
│   └── inventory/
│       ├── page.tsx                  # shipping_cost 컬럼 노출
│       └── inventory-table.tsx       # shipping_cost 인라인 수정 셀
├── lib/
│   ├── orders/
│   │   ├── queries.ts                # getOrders에 displayName join, shippingFee/shippingType 포함, getOrderStats에 stage별 카운트 추가
│   │   └── types.ts                  # OrderStats 확장
│   ├── inventory/
│   │   └── actions.ts                # updateShippingCost 서버액션 신설
│   ├── marketplace/
│   │   ├── types.ts                  # NormalizedOrder에 shippingType/shippingFee, NormalizedInquiry 신설, MarketplaceAdapter에 getInquiries 추가 (optional)
│   │   └── adapters/
│   │       ├── coupang/adapter.ts    # normalizeOrder에 shippingType/shippingFee, getInquiries 구현
│   │       └── naver/adapter.ts      # 동일
│   └── db/
│       └── schema.ts                 # orders 테이블에 shippingType/shippingFee, products에 shippingCost, 신규 inquiries 테이블
├── worker.ts                         # inquiry 수집 큐 등록
└── workers/
    └── inquiry-worker.ts             # 신규
supabase/migrations/
├── 011_add_order_shipping_info.sql   # orders.shipping_type, orders.shipping_fee
├── 012_add_product_shipping_cost.sql # products.shipping_cost
└── 013_add_inquiries.sql             # inquiries 테이블
```

### Pattern 1: Drizzle migration + schema 동기화
**What:** 신규 컬럼 추가는 두 곳에 동시 변경
**When to use:** orders/products 컬럼 추가 시
**Example:**
```sql
-- supabase/migrations/011_add_order_shipping_info.sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12,2);

COMMENT ON COLUMN orders.shipping_type IS '배송구분 (일반/선결제/착불/무료) — 마켓에서 수집';
COMMENT ON COLUMN orders.shipping_fee IS '마켓에서 수집된 배송비 (KRW)';
```
```typescript
// src/lib/db/schema.ts (orders 테이블에 필드 추가)
shippingType: varchar('shipping_type', { length: 50 }),
shippingFee: numeric('shipping_fee', { precision: 12, scale: 2 }),
```

### Pattern 2: 단계별 카운트 (Stage Counts) — 단일 GROUP BY 권장
**What:** 9개 탭 카운트를 1번의 SQL로 (per-tab COUNT 회피)
**When to use:** `getOrderStats()` 확장 시
**Example (개념):**
```typescript
// claim_type별 카운트 + status별 카운트 + 매핑/송장 상태는 application-side 계산
// stage 카운트는 status + has_tracking + mapping_status 조합 → 한 번의 select
const stageCounts = await db
  .select({
    status: orders.status,
    hasTracking: sql<boolean>`EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = ${orders.id})`,
    value: count(),
  })
  .from(orders)
  .where(eq(orders.userId, userId))
  .groupBy(orders.status, sql`EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = ${orders.id})`)
// 그 다음 application에서 stage 매칭 (matchStage 로직 재사용)
```
**Note:** mapping_status는 application-side라 SQL group이 어려움 — `(status, has_tracking)` 조합 카운트만 SQL로, mapping/stage는 후처리 합산.

### Pattern 3: 매핑 displayName join (LEFT JOIN)
**What:** 주문 아이템마다 product_name_mappings로 displayName 조회 — 매핑 없으면 NULL → fallback to 원본명
**When to use:** `getOrders()` 확장
**Example:**
```typescript
// queries.ts items 조회 시 LEFT JOIN
const items = await db
  .select({
    ...orderItems.fields,
    displayName: productNameMappings.displayName,
  })
  .from(orderItems)
  .leftJoin(
    productNameMappings,
    and(
      eq(productNameMappings.userId, userId),
      eq(productNameMappings.marketplaceId, /* from outer order */),
      eq(productNameMappings.marketplaceName, orderItems.productName),
    )
  )
  .where(inArray(orderItems.orderId, orderIds))
```
**Caveat:** marketplaceId는 orders에 있고 join은 orderItems에서 — `innerJoin(orders)` 후 `leftJoin(productNameMappings ON marketplaceName + marketplaceId)` 가 자연스러움.

### Pattern 4: 인라인 수정 셀 (재고관리 shipping_cost)
**What:** Cell 내 `<input type="number">` + onBlur server action 호출
**When to use:** inventory-table.tsx의 새 컬럼
**Example skeleton:**
```typescript
function ShippingCostCell({ productId, value }: { productId: string; value: number | null }) {
  const [draft, setDraft] = useState(value?.toString() ?? '')
  const [pending, startTransition] = useTransition()
  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => startTransition(() => updateShippingCostAction(productId, Number(draft)))}
      className="w-20 ..."
    />
  )
}
```

### Pattern 5: Inquiry 수집 어댑터 메서드 (optional interface 멤버)
**What:** MarketplaceAdapter 인터페이스에 `getInquiries?` 라는 optional method 추가 — 미지원 마켓은 그냥 구현 안 함
**When to use:** Coupang/Naver만 우선 구현
**Example interface change:**
```typescript
// types.ts
export interface NormalizedInquiry {
  marketplaceInquiryId: string
  marketplaceId: MarketplaceId
  marketplaceOrderId?: string  // 주문 연관 있을 때만
  inquiryType: 'product' | 'callcenter' | 'online'
  question: string
  answeredAt?: Date
  requestedAt: Date
  rawData: Record<string, unknown>
}
export interface MarketplaceAdapter {
  // ... existing methods
  getInquiries?(since: Date): Promise<NormalizedInquiry[]>  // optional
}
```

### Anti-Patterns to Avoid
- **per-tab COUNT 9번 호출** — `Promise.all`로 병렬화해도 같은 테이블 9번 스캔. 단일 GROUP BY 사용
- **post-fetch stage filter on count** — 현재 `getOrders().total`은 stage 적용 전 count라서 페이지네이션 깨짐. SQL 레벨 stage 필터로 옮기거나 카운트도 후처리
- **inquiry 수집을 모든 어댑터에 강제** — optional method로 두고 미구현 어댑터는 무시
- **shipping_cost를 inventory 측에 두기** — products 마스터 데이터. 동일 SKU가 여러 inventory 행에 있을 수 있고 (option/warehouse 분리), 배송비는 상품 단위가 자연스러움. inventory join은 `internalSku ↔ inventory.sku`
- **CS 컬럼 데이터 마이그레이션 시도** — 현재 CS 컬럼은 단순 `claims` join + `is_held` 표시 (별도 cs 테이블 없음). 컬럼 제거 = UI 변경뿐, 데이터 마이그레이션 불필요

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 탭 active state 관리 | useState로 탭 상태 관리 | `useQueryState` (nuqs) — 이미 확립 | URL 공유/북마크 가능, 새로고침 유지 |
| 인라인 수정 dirty/save flow | 자체 dirty tracking | `useTransition` + onBlur server action | 이미 inventory-table.tsx 패턴 |
| KST 날짜 변환 (inquiry since) | new Date() 수동 보정 | date-fns + 기존 어댑터 패턴 (coupang/adapter.ts line 54-60) | 일관성 |
| Drizzle SQL 그룹핑 | Map<>으로 후처리 | `groupBy()` + `count()` | DB 측 집계가 빠름 |
| Inquiry HTTP 호출 | 자체 fetch | 기존 `client.ts` (ky 기반) 재사용 | HMAC 서명 등 인증 코드 재사용 |
| 인디케이터 아이콘 | SVG inline | lucide-react (이미 설치) | 일관성, accessibility |

**Key insight:** Phase 8은 기존 인프라 위에 얹는 작업. 새 라이브러리 도입은 **불필요**. 모든 작업이 이미 있는 패턴 재사용.

## Runtime State Inventory

> 이 phase는 마이그레이션 + 데이터 모델 확장 + UI 변경 phase. Rename은 없으나 새 컬럼 backfill / inquiry 신규 수집은 데이터 측면 영향 있음.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) `orders` 테이블에 `shipping_type`/`shipping_fee` 신설 — 기존 행은 NULL (backfill 가능: rawData에서 추출). (2) `products`에 `shipping_cost` 신설 — 기존 행 NULL. (3) `inquiries` 신규 테이블 — 비어있게 시작 | (1) backfill 마이그레이션은 optional — rawData JSONB에서 Coupang `shippingPrice.units`, `shipmentType` 추출 가능. 데이터 양에 따라 결정. (2) NULL 허용 (사용자가 수동 입력). (3) Worker가 채움 |
| Live service config | None — 신규 BullMQ queue (`inquiry-collection`) 등록은 코드/Redis만 영향, 외부 서비스 없음 | Worker 코드에 큐 등록만 |
| OS-registered state | None | None |
| Secrets/env vars | 신규 secret 없음. Coupang/Naver 인증은 기존 `marketplace_connections` + Vault 재사용 | None |
| Build artifacts | None — TypeScript-only 변경. Drizzle Kit 마이그레이션은 standard | `npm run build` 정상 통과 확인 |

**Backfill 결정 포인트:** orders.shipping_fee/type을 기존 데이터에 backfill할지는 **plan 단계에서 결정**. JSONB 추출 SQL은 마켓별로 다름 (Coupang `raw_data->'shippingPrice'->>'units'`, Naver는 `deliveryFeeAmount`). 사용자 데이터 양 모름 → 일단 NULL로 시작하고 backfill은 별도 quick task로 미룰 것을 권장.

## Common Pitfalls

### Pitfall 1: 단계별 탭 카운트가 페이지 결과 기준으로 잘못 계산됨
**What goes wrong:** 현재 `getOrders().total`은 `buildOrderWhereClause` (stage 무시) 기반. UI가 카운트를 page total로 표시하면 stage 필터링 적용된 결과와 불일치
**Why it happens:** matchStage가 application-side post-filter라서 SQL count에 안 들어감
**How to avoid:** stage별 카운트 전용 함수 (`getStageCount()` 또는 `getOrderStats` 확장) 신설. matchStage 조건을 SQL로 풀어쓰기
**Warning signs:** 탭 카운트 합 ≠ 전체 카운트, 페이지네이션 표시가 이상

### Pitfall 2: displayName join 시 marketplaceId 매칭 누락
**What goes wrong:** 같은 marketplaceName이 다른 마켓에 존재할 수 있어 잘못된 displayName 매칭
**Why it happens:** `product_name_mappings_unique` constraint가 `(user_id, marketplace_id, marketplace_name)` 인데 join에서 marketplaceId 빼먹기 쉬움
**How to avoid:** join condition에 반드시 `eq(productNameMappings.marketplaceId, orders.marketplaceId)` 포함
**Warning signs:** 쿠팡 주문에 네이버 매핑된 displayName이 표시됨

### Pitfall 3: CS 컬럼 제거 시 holdReason 표시 누락
**What goes wrong:** 현재 CS 컬럼이 (a) 클레임, (b) 미발송 사유 (`holdReason`) 두 가지를 함께 표시 (columns.tsx line 403-415). 단순 제거하면 미발송 사유가 보이지 않게 됨
**Why it happens:** "CS 컬럼 제거"만 보고 미발송 표시까지 같이 제거
**How to avoid:** 클레임 인디케이터 옆에 미발송 인디케이터(자물쇠 아이콘 등)도 함께 통합
**Warning signs:** 미발송 주문에 hold reason이 안 보임

### Pitfall 4: Naver inquiry API 경로 미확인 상태로 plan
**What goes wrong:** Naver 문의 API의 정확한 경로를 외부 검색으로 못 찾음. 실제 구현 시 경로 모르면 막힘
**Why it happens:** Naver 문서가 partner 등록 후 접근 가능
**How to avoid:** plan에서 **Naver inquiry는 best-effort + TODO marker로** 표시하거나, Naver는 phase 8에서 제외하고 quick task로 분리. 사용자 동의된 "Coupang/Naver 우선"의 "Naver" 부분을 검증 필요
**Warning signs:** "Naver inquiry endpoint 찾을 수 없음" 에러

### Pitfall 5: shipping_fee 마이그레이션 시 인덱스 누락
**What goes wrong:** orders 테이블에 컬럼 추가는 빠르나, shipping_fee 기준 정렬/필터 시 인덱스 없으면 느림
**Why it happens:** Phase 8 범위에서 정렬은 안 하지만 미래에 매출관리 phase에서 필요
**How to avoid:** 마이그레이션 시 인덱스는 보류 (사용 패턴 확인 후 별도 추가). NULL 비율이 높을 가능성 → partial index 후보
**Warning signs:** 매출관리 phase 진행 시 쿼리 느림

### Pitfall 6: Coupang shipmentType 값을 한국어로 직접 매핑
**What goes wrong:** Coupang `shipmentType`은 영문 코드 (e.g., `DOMESTIC`, `OVERSEA`)일 수 있는데, 한국어 라벨 ("일반/선결제/착불/무료")로 그대로 매핑하면 잘못됨
**Why it happens:** "배송구분"을 사용자 의도(일반/선결제/착불/무료)로 해석하느냐, 실제 marketplace 필드(국내/해외)로 해석하느냐
**How to avoid:** Coupang의 `deliveryChargeTypeName` 필드 (CoupangOrderItem)와 `parcelPrintMessage`/`shipmentType` (CoupangOrderSheet) 모두 검토. 사용자가 원하는 "배송구분"이 무엇인지 plan 단계에서 1차 확정 (raw 표시 vs 정규화)
**Warning signs:** 표시 값이 사용자 기대와 다름

## Code Examples

### Example 1: 통합 탭 컴포넌트 (claims + stage)
```tsx
// 권장: 단일 컴포넌트로 합치기 — 사용자 결정 "신규/확인/출고대기/출고완료/배송중/배송완료/취소/교환/반품" 9탭
'use client'
import { useQueryState, parseAsString } from 'nuqs'

const TABS = [
  { id: 'all', label: '전체', kind: 'all' },
  { id: 'new', label: '신규', kind: 'status' },
  { id: 'confirmed', label: '확인', kind: 'status' },
  { id: 'preparing', label: '출고대기', kind: 'status' },
  { id: 'shipped', label: '출고완료', kind: 'status' },
  { id: 'delivering', label: '배송중', kind: 'status' },
  { id: 'delivered', label: '배송완료', kind: 'status' },
  { id: 'cancel', label: '취소', kind: 'claim' },
  { id: 'exchange', label: '교환', kind: 'claim' },
  { id: 'return', label: '반품', kind: 'claim' },
] as const

export function OrderTabs({ counts }: { counts: Record<string, number> }) {
  const [status, setStatus] = useQueryState('status', parseAsString)
  const [claimType, setClaimType] = useQueryState('claimType', parseAsString)
  // active 판정 + 클릭 시 status/claimType만 상호 배타적으로 set
  // ...
}
```

### Example 2: orders.shippingType normalize (Coupang)
```typescript
// adapter.ts normalizeOrder 확장
private normalizeOrder(sheet: CoupangOrderSheet): NormalizedOrder {
  return {
    // ... existing fields
    shippingFee: sheet.shippingPrice?.units ?? 0,
    shippingType: sheet.shipmentType ?? null,  // raw "DOMESTIC" 등 — 또는 deliveryChargeTypeName
    // ...
  }
}
```

### Example 3: Coupang 문의 API 호출 (verified path)
```typescript
// adapter.ts 신규 메서드
async getInquiries(since: Date): Promise<NormalizedInquiry[]> {
  const fmt = (d: Date) => /* 기존 KST formatter 재사용 */
  const qs = `inquiryStartAt=${fmt(since)}&inquiryEndAt=${fmt(new Date())}&pageSize=50`
  const path = `v2/providers/openapi/apis/api/v5/vendors/${this.vendorId}/onlineInquiries?${qs}`
  const response = await this.client.get(path).json<{ code: string; data: any[] }>()
  return (response.data ?? []).map(/* normalize */)
}
```
**Source:** Coupang Open API docs (verified via WebSearch — see Sources)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 별도 CS 컬럼으로 클레임/미발송 표시 | 첫 데이터 컬럼(주문상태)에 통합 인디케이터 | Phase 8 변경 | UI 컴팩트해짐, 한눈에 들어옴 |
| 마켓 원본 상품명 그대로 표시 | displayName 우선 + 원본 보조 | Phase 8 변경 | 사용자 인지 명확 |
| 단계별 워크플로우 탭 (prep/mapping/confirm/invoice/shipping/done) | 사용자 status 기반 9탭 (신규/확인/출고대기...) | Phase 8 — 사용자 명시 | 사방넷과 유사한 mental model |
| post-fetch stage filter | (가능하면) SQL 레벨 stage filter | Phase 8 권장 | 카운트 정확 + 페이지네이션 정상 |
| products에 shipping_cost 없음 | products.shipping_cost 추가 | Phase 8 | 매출관리 phase 준비 |

**Deprecated/outdated 안에서 보존:**
- 기존 `OrderStage` enum (prep/mapping/confirm/invoice/shipping/done): 9탭 통합 시 제거할지, 유지할지 결정 필요. **권장: 9탭과 별개로 stage는 부가 필터로 유지** (URL ?stage=mapping 으로 매핑 필요만 보기) — 사용자가 출고 워크플로우 도구로 stage 사용 가능

## Open Questions

1. **9탭 통합 vs 2단 탭 (status/claim 분리) — UI 결정**
   - What we know: 사용자가 명시한 9탭 = `신규/확인/출고대기/출고완료/배송중/배송완료/취소/교환/반품`. 처음 6개는 `orders.status`, 뒤 3개는 `claims.claimType`. status='cancelled'와 claimType='cancel'은 거의 동의어이나 정확히 같지 않음 (취소되지 않은 cancel 클레임 가능)
   - What's unclear: "취소" 탭은 (a) status='cancelled', (b) claimType='cancel', (c) 둘의 OR — 어느 것?
   - Recommendation: **(c) OR**. CONTEXT.md "취소 탭은 cancellation_claim 또는 status='cancelled'인 주문 필터링" 명시됨

2. **stage-tabs (기존)는 유지 vs 폐기**
   - What we know: stage-tabs.tsx, stage filter 로직, prep 하위탭 (mapping/confirm) UI 모두 이미 build됨
   - What's unclear: 9탭 통합 시 stage는 (a) 완전 제거, (b) 별도 부가 필터로 유지
   - Recommendation: **(b) 부가 필터로 유지**. 사용자 워크플로우 (매핑 필요 → 확정 대기 → 송장 발급 → 출고)는 status보다 더 실용적. 두 탭을 병렬로 두지 말고 stage는 secondary toggle 또는 카운트 카드로 강등

3. **Naver inquiry endpoint 정확한 경로**
   - What we know: Naver Commerce API에 상품문의 기능 존재 (검색 결과 confirmed). GitHub `commerce-api-naver/commerce-api`가 기술지원 채널
   - What's unclear: 정확한 endpoint path / scope / pagination 형태
   - Recommendation: **Phase 8에서는 Coupang inquiry만 구현**. Naver inquiry는 (a) plan 단계에서 사용자에게 partner 문서 접근 권한 확인, (b) 별도 quick task 또는 phase 9로 분리. 코드는 optional method로 인터페이스만 미리 두기

4. **배송구분(shipping_type) 값의 형태**
   - What we know: Coupang은 `shipmentType` (DOMESTIC/OVERSEA), `deliveryChargeTypeName` (한글), `parcelPrintMessage` 등 여러 후보
   - What's unclear: 사용자가 원하는 "배송구분"의 의미 — 결제 방식(선결제/착불) vs 배송 형태(일반/예약발송)
   - Recommendation: **plan 단계에서 1차 확정**. 우선 `deliveryChargeTypeName` (한글, 사람이 읽을 수 있음) + `shipmentType` (영문 코드)을 둘 다 raw로 저장 후 표시 — 추후 정규화

5. **shipping_fee backfill 여부**
   - What we know: 기존 주문의 raw_data JSONB에 Coupang/Naver 배송비 정보 들어있음
   - What's unclear: backfill을 phase 8에서 할지, 별도 quick task로 미룰지
   - Recommendation: **phase 8 범위 외 (별도 quick)**. 마이그레이션은 컬럼만 추가, 신규 수집부터 채워지게 → 안전

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | dev/build | ✓ | >=22 (engines) | — |
| Postgres (Supabase) | 신규 마이그레이션 실행 | ✓ (Supabase) | 15+ | — |
| Redis | BullMQ inquiry queue | ✓ (기존 사용 중) | — | — |
| Drizzle Kit | 마이그레이션 검증 | ✓ | 0.31.10 | — |
| Coupang Open API 문의 endpoint | inquiry 수집 | ✓ (외부 docs 확인됨) | v5 | API 키 필요 (기존 vault에 있음) |
| Naver Commerce API 문의 endpoint | inquiry 수집 | ✗ (정확한 path 미확인) | — | Coupang만 구현, Naver는 TODO |

**Missing dependencies with fallback:**
- Naver inquiry API 정확한 path → Coupang만 우선 구현, Naver는 stub + TODO

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (devDeps에 vitest 설치 안 보임 — `@vitejs/plugin-react`만 있음) + @testing-library/react 16.3.2 + jsdom 29.0.1 |
| Config file | None confirmed — Wave 0에서 `vitest.config.ts` 신설 필요할 수 있음 |
| Quick run command | `npx vitest run --reporter=dot tests/<file>` (제안 — 실제 명령은 Wave 0에서 확정) |
| Full suite command | `npx vitest run` |
| Phase gate | TypeScript: `npx tsc --noEmit` + Build: `npm run build` |

**Note:** package.json scripts에 `test`가 없음. **Wave 0에서 vitest 설치/설정 필요.** `@testing-library/jest-dom`, `@testing-library/react`, `jsdom`, `msw`는 이미 있음 → vitest 본체만 추가하면 됨.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-01 | 취소 탭 카운트 = `claims.claimType='cancel'` ∪ `orders.status='cancelled'` 의 distinct order 수 | unit (queries) | `npx vitest run tests/orders/get-order-stats.test.ts` | ❌ Wave 0 |
| SC-01 | 취소 탭 클릭 시 `?status=cancelled` 또는 `?claimType=cancel` URL 변경 → 결과 테이블에 cancel only | integration (table) | `npx vitest run tests/orders/order-tabs.test.tsx` | ❌ Wave 0 |
| SC-02 | 주문관리 헤더에 "엑셀 업로드" 텍스트/링크 부재 | smoke (DOM) | `npx vitest run tests/orders/page-header.test.tsx` | ❌ Wave 0 |
| SC-02 | 9개 탭 렌더 + 각 탭에 카운트 뱃지 노출 | unit (component) | `npx vitest run tests/orders/order-tabs.test.tsx` | ❌ Wave 0 |
| SC-03 | CS 컬럼 부재 (header에 'CS' 없음) | smoke | `npx vitest run tests/orders/columns.test.tsx` | ❌ Wave 0 |
| SC-03 | 클레임 있는 주문 행 첫 컬럼에 클레임 뱃지 노출 | unit (cell) | `npx vitest run tests/orders/columns.test.tsx` | ❌ Wave 0 |
| SC-03 | 문의 있는 주문 행에 문의 아이콘 노출 (test fixture: order with inquiries[0]) | unit (cell) | `npx vitest run tests/orders/columns.test.tsx` | ❌ Wave 0 |
| SC-04 | 매핑 있는 주문 행 상품명 = displayName, 원본명은 보조 표시 | unit (cell) + query | `npx vitest run tests/orders/get-orders.test.ts` | ❌ Wave 0 |
| SC-04 | 매핑 없는 주문 행 = 원본명 (fallback) | unit | 위와 동일 파일 | ❌ Wave 0 |
| SC-05 | 9개 탭 카운트 합 + 다른 탭 (전체) 카운트와 일관성 | unit | `npx vitest run tests/orders/get-order-stats.test.ts` | ❌ Wave 0 |
| SC-06 | orders 테이블 select 결과에 shipping_type, shipping_fee 컬럼 존재 | unit (schema) | `npx vitest run tests/db/schema.test.ts` | ❌ Wave 0 |
| SC-06 | 주문 행에 배송구분 + 수집 배송비 + SaaS 배송비 컬럼 렌더 | smoke (DOM) | `npx vitest run tests/orders/columns.test.tsx` | ❌ Wave 0 |
| SC-06 | Coupang adapter normalizeOrder가 shippingFee를 raw `shippingPrice.units`에서 추출 | unit (adapter) | `npx vitest run tests/marketplace/coupang/normalize.test.ts` | ❌ Wave 0 |
| SC-07 | products.shipping_cost 컬럼 존재 + numeric 타입 | unit (schema) | `npx vitest run tests/db/schema.test.ts` | ❌ Wave 0 |
| SC-07 | 재고관리 행에서 shipping_cost 입력 → server action → DB 업데이트 | integration | `npx vitest run tests/inventory/shipping-cost-edit.test.tsx` | ❌ Wave 0 |
| inquiry | Coupang `getInquiries(since)` 호출 → MSW mock → NormalizedInquiry[] 반환 | unit (adapter) | `npx vitest run tests/marketplace/coupang/inquiries.test.ts` | ❌ Wave 0 |
| build | TypeScript 컴파일 통과 | smoke | `npx tsc --noEmit` | ✅ |
| build | Next.js production build 통과 | smoke | `npm run build` | ✅ |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` + 해당 task 영역 vitest 단위 테스트
- **Per wave merge:** `npx vitest run` + `npm run build`
- **Phase gate:** `npx vitest run` 그린 + `npm run build` 그린 + UI smoke (사용자 manual confirm — 9탭 클릭, displayName 표시, 인라인 수정 동작)

### Wave 0 Gaps
- [ ] `vitest` install + `vitest.config.ts` (jsdom env) — 테스트 인프라 부재
- [ ] `tests/orders/get-order-stats.test.ts` — SC-01, SC-05
- [ ] `tests/orders/get-orders.test.ts` — SC-04 (displayName join)
- [ ] `tests/orders/order-tabs.test.tsx` — SC-01, SC-02
- [ ] `tests/orders/page-header.test.tsx` — SC-02
- [ ] `tests/orders/columns.test.tsx` — SC-03, SC-04, SC-06
- [ ] `tests/db/schema.test.ts` — SC-06, SC-07
- [ ] `tests/inventory/shipping-cost-edit.test.tsx` — SC-07
- [ ] `tests/marketplace/coupang/normalize.test.ts` — SC-06
- [ ] `tests/marketplace/coupang/inquiries.test.ts` — inquiry collection
- [ ] `tests/conftest.ts` 또는 `tests/setup.ts` — MSW + Drizzle test DB or mocks
- [ ] DB schema 테스트는 실제 DB 없이 schema.ts 정적 분석으로 충분 (drizzle-kit introspect 또는 단순 import)

**Manual UI smoke (test 자동화 어려운 항목):**
- 사용자 본인이 9개 탭 모두 클릭하여 카운트/필터 일치 확인
- displayName이 매핑된 주문에 표시, 매핑 없는 주문에 원본명 표시
- 재고관리에서 shipping_cost 입력 → 새로고침 후 유지
- (Coupang inquiry 동작은 실제 운영 데이터로 verify)

## Sources

### Primary (HIGH confidence)
- 코드베이스 직접 분석 — `src/lib/db/schema.ts`, `src/lib/orders/queries.ts`, `src/lib/orders/types.ts`, `src/app/(auth)/orders/{page,columns,claims-filter,stage-tabs}.tsx`, `src/lib/marketplace/types.ts`, `src/lib/marketplace/adapters/coupang/{adapter,types}.ts`, `src/lib/marketplace/adapters/naver/adapter.ts`, `src/app/api/orders/apply-mappings/route.ts`, `src/app/(auth)/inventory/{page,inventory-table}.tsx`, `package.json`, `supabase/migrations/*.sql`
- [Coupang Customer Inquiry Query by Product](https://developers.coupangcorp.com/hc/en-us/articles/360033400754-Customer-Inquiry-Query-by-Product) — 상품 문의 endpoint
- [Coupang Contact Center Inquiry Check](https://developers.coupangcorp.com/hc/en-us/articles/360034204013-Coupang-Contact-Center-Inquiry-Check) — 콜센터 문의
- [Query of Coupang Contact Center Inquiries](https://developers.coupangcorp.com/hc/en-us/articles/360033645354-Query-of-Coupang-Contact-Center-Inquiries) — 콜센터 문의 조회

### Secondary (MEDIUM confidence)
- [Coupang Open API Smartship Guide](https://qxguide.oopy.io/119297d6-85d0-4569-85c4-05b5d6b73b2f) — 비공식 가이드, 한국어
- [Naver Commerce API GitHub](https://github.com/commerce-api-naver/commerce-api) — 기술지원 — Naver inquiry 정확한 path는 미확인

### Tertiary (LOW confidence)
- Naver inquiry 정확한 endpoint — partner docs 접근 필요. **plan에서 사용자 확인 필요**

## Metadata

**Confidence breakdown:**
- Codebase architecture: HIGH — 직접 코드 read
- Schema 변경 strategy: HIGH — 기존 마이그레이션 패턴 일치
- UI patterns: HIGH — 기존 nuqs/TanStack/shadcn 패턴 재사용
- Coupang inquiry API: HIGH — 공식 docs 검색 결과 다수 확인 (path 명시됨)
- Naver inquiry API: LOW — 존재 confirmed, 정확한 path 미확인
- 9탭 vs 다단 탭 결정: MEDIUM — 사용자 명시는 9탭이지만 stage-tabs 폐기 여부 미확정
- Backfill 전략: MEDIUM — 기존 데이터 형태 모름, 보수적으로 NULL 시작 권장

**Research date:** 2026-04-26
**Valid until:** 2026-05-26 (마켓플레이스 API spec stable, 단 Naver는 partner docs 변경 가능)

## RESEARCH COMPLETE
