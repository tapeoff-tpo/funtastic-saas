---
quick_id: 260430-gbu
type: execute
status: complete
completed_at: 2026-04-30
commits:
  - 0ce3edd
files_modified:
  - src/app/(auth)/products/mapping/order-rows-board.tsx
  - src/app/api/products/mapping-codes/order-rows/route.ts
requirements_satisfied:
  - GBU-01  # Dense filter panel — 수집일자 + 선택사항 I~IV + 매핑선택 2-row + 검색
  - GBU-02  # Toolbar — 자료수 + 일괄품번/단품매핑 + 일괄주문확정 + 다운로드 + 선택삭제 + 매핑해제
  - GBU-03  # 2-group header — 좌:주문금액 추가 / 우:확정여부 추가
  - GBU-04  # searched=1 sentinel — 진입 시 fetch 차단
  - GBU-05  # default pageSize 25, 상단 배치
  - GBU-06  # 탭 절대 미사용 (단일 화면 + 모달)
key_decisions:
  - "category / orderStatus / etc 는 UI plumbing 만 — 서버 필터는 후속 plan"
  - "선택삭제 / 다운로드 는 alert plumbing 만 — orders.hidden_from_mapping 컬럼 + Excel export 는 후속"
  - "확정여부 td 는 행(orderItem) 단위이므로 ci===0 + rowSpan 으로 component-row 묶음"
  - "Postgres numeric 컬럼은 string 으로 응답 — 클라이언트에서 Number().toLocaleString('ko-KR') 포맷"
---

# Quick Task 260430-gbu: 매핑관리 dense UI 추가요구 반영 Summary

사방넷 주문서확정관리 스타일 dense UI 보강 — searched sentinel + 선택사항 I~IV + 주문금액 + 확정여부 + 신규 액션 3개. 단일 commit (`0ce3edd`).

## Files Modified (2)

| File | What changed |
|------|--------------|
| `src/app/api/products/mapping-codes/order-rows/route.ts` | OrderRow 인터페이스 + SELECT 절에 `unitPrice / totalAmount / mappedAt` 추가 |
| `src/app/(auth)/products/mapping/order-rows-board.tsx` | searched sentinel + 4개 신규 nuqs 필드 + 선택사항 select 3개 + 매핑선택 2행 분리 + 신규 액션 3개 + 주문금액/확정여부 컬럼 |

## API: 추가된 OrderRow 필드 (3)

| Field | SQL Source | Type | Notes |
|-------|-----------|------|-------|
| `unitPrice` | `oi.unit_price` | `string \| null` | Postgres numeric → string (그대로 노출) |
| `totalAmount` | `(oi.unit_price * oi.quantity)` | `string \| null` | 서버 계산 |
| `mappedAt` | `o.mapped_at` | `string \| null` | ISO timestamp, null = 미확정 |

LATERAL JOIN / EXISTS / WHERE 등 기존 SQL 로직은 한 줄도 변경하지 않음. SELECT 절에 3줄, TypeScript 매핑에 4줄 추가만.

## UI: 신규 nuqs 필드 (4) + default 변경

| Key | Type | Default | Server filter | Purpose |
|-----|------|---------|---------------|---------|
| `category` | string | null | NO (plumbing) | 선택사항 II 카테고리 |
| `orderStatus` | string | null | NO (plumbing) | 선택사항 III 주문상태 |
| `etc` | string | null | NO (plumbing) | 선택사항 IV 기타 |
| `searched` | integer | 0 | sentinel | 0 = fetch 차단(안내문구), 1 = 자동 reload |
| `pageSize` | integer | 25 | YES (이전부터 25) | 기본 페이지 크기 (요구사항 재확인) |

## UI: searched=1 sentinel 동작

1. 페이지 첫 진입 → URL 에 `searched` 파라미터 없음 → default 0 → `reload()` 첫 줄 `if (filters.searched !== 1) return` → **fetch 0회**
2. 사용자가 조회 버튼 클릭 → `submitSearch()` → `setFilters({ ..., searched: 1 })` → 의존성 변경 → reload 실제 fetch 수행
3. 그 이후 필터(date / mkt / category / status / etc / productMatch / optionMatch) 변경 → searched 는 그대로 1 → 자동 reload
4. 초기화 버튼 → `searched: 0` 으로 되돌려서 다시 안내문구 화면

테이블 영역도 동일 분기:

```tsx
{filters.searched !== 1 ? (
  <div>상단 필터 설정 후 [조회] 버튼을 눌러 매핑관리 데이터를 불러오세요.</div>
) : (
  <table>...</table>
)}
```

## UI: 신규 툴바 액션 버튼 (3)

| Button | 동작 | 상태 |
|--------|------|------|
| 일괄주문확정 | 선택 행의 unique orderId 추출 → `POST /api/orders/apply-mappings` → mapped_at 기록 | **실제 동작** |
| 다운로드 | `alert('다운로드 기능은 후속 plan 에서 구현됩니다 ...')` | plumbing |
| 선택삭제 | `alert('선택삭제는 후속 plan 에서 구현됩니다 (선택 N건)')` | plumbing |

기존 [일괄 품번매핑 / 일괄 단품매핑 / 매핑해제 / 새로고침] 4개는 그대로 유지. 총 7개 액션 버튼 노출.

## UI: 테이블 컬럼 변경

- 좌측 그룹 (쇼핑몰 수집): `colSpan 6 → 7` — 수량 다음에 **주문금액** (`Number(totalAmount).toLocaleString('ko-KR')`) 추가
- 우측 그룹 (매핑 적용 결과): `colSpan 4 → 5` — 수량 다음에 **확정여부** 배지 추가
  - `mappedAt != null` → 보라색 "확정완료" Badge
  - `mappedAt == null` → outline "미확정" Badge
- loading / empty `colSpan` 도 11 → 13 으로 동기화
- 확정여부는 행(orderItem) 단위 속성이므로 `ci === 0` + `rowSpan={compsOrEmpty.length}` 으로 component-row 묶음

## UI: 매핑선택 라디오 — 1행→2행 분리

이전: 한 줄에 `[품번 그룹] | [단품 그룹]`
변경: 두 줄로 분리 — 품번 그룹 (1줄) / 단품 그룹 (2줄, 정렬용 빈 라벨)

라디오 항목 라벨은 사용자 명세 그대로 유지:
- 품번: 전체 / 품번매핑 / 품번미매핑
- 단품: 전체 / 단품매핑 / 단품미매핑 / SKU매핑

## 탭 미사용 검증

```bash
grep -i -E "\btab[a-zA-Z]*" order-rows-board.tsx | grep -v "tabular-nums"
# 출력: <table> HTML 태그 + "tab-sentinel" 주석 1줄. 탭 컨트롤 0건.
```

`<button>` 으로 구현된 좌/우 전환 컨트롤, `Tabs` 컴포넌트, `tab` state/variable 일체 없음.

## Deviations from Plan

### Auto-fixed Issues

None - 플랜대로 그대로 실행.

### Scope notes

- **카테고리 / 주문상태 / 기타** select 는 UI plumbing 만 (서버 미적용). reload 의 URLSearchParams 에 추가하지 않았으며, 의존성 배열에는 포함시켜 향후 서버 필터 적용 시 자동 동작.
- 기존 `BulkMappingModal` 함수 본문은 한 글자도 수정하지 않음 (제약 준수).
- 기존 LATERAL JOIN / EXISTS / 매칭 우선순위 SQL 로직은 그대로 유지 (제약 준수).

## Authentication Gates

없음 — 인증 흐름 미변경.

## Verification

- `npx tsc --noEmit -p .` — 수정 파일(`order-rows-board.tsx`, `order-rows/route.ts`) 0 에러. 다른 파일의 사전 존재 에러는 본 plan 범위 외.
- 검증 grep: searched sentinel ✓ / 신규 OPTIONS 3개 ✓ / 신규 버튼 텍스트 3개 ✓ / 주문금액·확정여부·확정완료·미확정 텍스트 ✓ / 탭 컨트롤 부재 ✓

## Follow-up Candidates

1. **다운로드** — 현재 필터 + 선택 행을 ExcelJS 로 export (별도 라우트 `/api/products/mapping-codes/order-rows/export`)
2. **선택삭제** — `orders` 테이블에 `hidden_from_mapping boolean` 컬럼 추가 + 매핑보드 기본 필터링 + 일괄 토글 API
3. **category / orderStatus / etc 서버 필터** — order-rows API 에 동일명 query param 받아서 WHERE 추가 (orderStatus 는 `o.status` , etc 은 sub-filter)
4. **카테고리 옵션 채우기** — `/api/products/categories` 에서 사용자 카테고리 목록 fetch → CATEGORY_OPTIONS 동적 생성

## Self-Check: PASSED

- File `src/app/api/products/mapping-codes/order-rows/route.ts` — FOUND
- File `src/app/(auth)/products/mapping/order-rows-board.tsx` — FOUND
- Commit `0ce3edd` — FOUND in `git log`
