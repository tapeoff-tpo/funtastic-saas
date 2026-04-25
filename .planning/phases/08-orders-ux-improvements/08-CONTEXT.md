# Phase 8: 주문관리 UX 개선 - Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Source:** Inline (user 직접 피드백 — 5개 항목 + Option A 통합 결정)

<domain>
## Phase Boundary

이 phase는 **주문관리 화면의 UX/표시/필터 개선**과 **상품-배송비 데이터 모델 확장**까지를 다룬다. 매출관리(원가/판매가 기반 수익 계산)는 본 phase 범위 밖이며 별도 phase로 분리한다.

**In-scope:**
- 주문관리 탭/필터 구조 변경 (취소 탭 활성화, 단계별 필터, 엑셀 업로드 제거)
- 클레임/문의 인디케이터 통합 (CS 컬럼 제거)
- 매핑된 상품의 표시명 변경 (마켓 원본명 → SaaS displayName)
- 주문 행에 배송구분 + 수집 배송비 + SaaS 배송비(원가) 컬럼 추가
- 재고관리에 상품별 배송비(원가) 입력 UI/스키마 확장
- 가능한 마켓에서 "문의(inquiry)" 수집 (클레임 인디케이터에 함께 표시)

**Out-of-scope (별도 phase):**
- 매출관리 화면/계산 로직 (제품원가, 배송비원가, 판매가, 수령배송비 기반 수익)
- 배송비 자동 적용/판매가 동기화 로직 (이번엔 표시까지만)

</domain>

<decisions>
## Implementation Decisions

### 탭/필터 구조 (취소 탭 + 단계별 필터)
- 주문관리 상단 탭 구조는 단계별로 명확히 구분: **신규/확인/출고대기/출고완료/배송중/배송완료/취소/교환/반품**
- 각 탭에 정확한 카운트 표시 (마켓 + 사용자 스코프 적용된 SQL 카운트)
- 취소 탭은 cancellation_claim 또는 status='cancelled'인 주문 필터링
- 교환/반품 탭은 해당 클레임 타입(exchange/return)이 있는 주문 필터링
- 탭과 별도로 좌측 사이드/상단 필터바에 마켓플레이스/날짜/검색은 유지

### 엑셀 업로드 제거
- 주문관리 메인 헤더에서 "엑셀 업로드" 버튼/진입점 **완전 제거**
- 기존 엑셀 업로드 페이지(`/orders/upload` 등) 자체는 유지 — 다만 주문관리 화면 내 진입점만 제거
- 사용자 의견: "엑셀 업로드는 사실 의미없는 거 아냐?" — 즉 단계별 필터링이 더 가치 있음

### 클레임/문의 인디케이터 통합 (CS 컬럼 제거)
- 기존 별도 "CS" 컬럼 **완전 제거** (사용자 피드백: "칸만 차지하는 느낌")
- 좌측 **첫 번째 컬럼(클레임)** 에 뱃지/아이콘으로 표시:
  - 클레임 있음 (cancel/return/exchange) → 색상별 뱃지
  - 문의 있음 → 별도 아이콘
  - 둘 다 있으면 둘 다 표시
- "문의" 데이터: 가능한 마켓플레이스(쿠팡/네이버 등 inquiry/문의 API 지원 마켓)에서 수집해서 저장
- 데이터가 없는 마켓은 인디케이터 미표시 (오류 아님)

### 매핑된 상품명 표시 (displayName)
- 주문 행의 상품명 컬럼은 **매핑된 SaaS 상품의 displayName**을 우선 표시
- 매핑이 없는 주문은 마켓 원본 상품명 그대로 표시 (fallback)
- 매핑 정보는 product_mappings / option_mappings 테이블에서 조회
- 원본 마켓 상품명도 보고 싶을 수 있으니 tooltip 또는 보조 표시(작은 회색 글자)로 함께 노출

### 배송구분 + 배송비 컬럼
- **배송구분** 컬럼: 주문에 포함된 배송 타입 (예: 일반/선결제/착불/무료) — 마켓에서 수집
- **수집 배송비** 컬럼: 마켓에서 수집된 배송비 (orders 테이블에 이미 있을 가능성 — 확인 필요)
- **SaaS 배송비(원가)** 컬럼: SaaS에 등록된 배송비 — products 또는 inventory의 새 필드
- 두 배송비를 별도 컬럼으로 노출해 차이를 한눈에 볼 수 있게 함

### 재고관리에 배송비 입력
- 재고관리 화면(`/inventory`)에서 상품별로 **배송비(원가)** 입력/수정 가능해야 함
- 스키마 확장: `products` 테이블에 `shipping_cost` (numeric, nullable) 추가 — 또는 inventory 측에 추가 (어느 쪽이 더 적절한지 research에서 판단)
- 사용자 의견: "현재 재고관리부분에 그 부분도 없다보니 그것도 넣어서"

### Claude's Discretion
- 탭 UI 구체적 디자인 (색상, 위치, 아이콘 선택) — shadcn/ui 패턴 준수
- 클레임/문의 인디케이터의 정확한 시각 표현 (이모지 vs 색칠 점 vs 아이콘 라이브러리)
- 문의 수집 구현 범위 — 어떤 마켓 어댑터부터 우선 구현할지 (쿠팡/네이버 우선 권장)
- 배송비 컬럼이 길어지면 테이블이 좁아지는 문제 — 컬럼 토글 또는 압축 표시 고려
- 매핑 displayName이 너무 길 때 truncate 처리

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements
- `.planning/ROADMAP.md` — Phase 8 entry (line ~151)
- `.planning/REQUIREMENTS.md` — 전체 프로젝트 요구사항

### Order management (Phase 2/3 기존 구현)
- `src/app/(auth)/orders/` — 주문관리 화면 (탭, 테이블, 액션)
- `src/lib/orders/` — 주문 쿼리, 액션, 타입
- `src/lib/db/schema/orders.ts` — 주문 스키마 (확인 필요)
- `src/lib/db/schema/claims.ts` — 클레임 스키마 (확인 필요)

### Product mapping (Phase 5 기존 구현)
- `src/app/api/products/mappings/` — 상품 매핑 API
- `src/app/api/products/option-mappings/` — 옵션 매핑 API
- `src/app/api/orders/apply-mappings/` — 주문에 매핑 적용
- `src/lib/products/` — 상품 쿼리/액션

### Inventory (Phase 4 기존 구현)
- `src/app/(auth)/inventory/` — 재고관리 화면
- `src/lib/inventory/` — 재고 로직
- `src/lib/db/schema/products.ts` (또는 inventory.ts) — 상품/재고 스키마

### Marketplace adapters (문의 수집용)
- `src/lib/marketplace/adapters/coupang/` — 쿠팡 어댑터 (문의 API 확인)
- `src/lib/marketplace/adapters/naver/` — 네이버 어댑터 (문의 API 확인)

### Migrations
- `supabase/migrations/` — 마이그레이션 디렉토리 (배송비 컬럼 추가 시 새 migration)

</canonical_refs>

<specifics>
## Specific Ideas

- 사용자 캡처 화면에서 현재 주문관리에:
  - 취소 탭이 비활성화 상태
  - "엑셀 업로드" 버튼이 헤더에 노출
  - "CS" 컬럼이 별도로 자리 차지
  - 상품명이 마켓 원본명 그대로 (매핑되어 있어도)
- 단계별 필터는 사용자 명시: **출고대기, 출고완료, 교환** 등 — 즉 기존 status workflow 그대로 활용

</specifics>

<deferred>
## Deferred Ideas

- **매출관리 화면** — 제품원가 / 배송비원가 / 판매가 / 수령배송비 기반 수익 계산 (별도 phase로 분리)
- **배송비 자동 적용 로직** — SaaS 등록 배송비를 주문 처리 시 자동으로 사용하는 기능 (이번엔 표시까지만)
- **문의 답변 기능** — 수집된 문의에 답변 보내기 (이번엔 인디케이터 표시까지만)
- **매핑 자동 추천** — 매핑되지 않은 주문 상품에 대해 자동 매핑 제안

</deferred>

---

*Phase: 08-orders-ux-improvements*
*Context gathered: 2026-04-26 via inline user feedback*
