---
phase: 8
slug: orders-ux-improvements
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-26
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Detailed mapping is in `08-RESEARCH.md` "## Validation Architecture" section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + @testing-library/react + jsdom (vitest 본체 미설치 — Wave 0 install) |
| **Config file** | `vitest.config.ts` (Wave 0에서 신설) |
| **Quick run command** | `npx vitest run --reporter=dot tests/<area>` |
| **Full suite command** | `npx vitest run` |
| **Phase gate (build)** | `npx tsc --noEmit && npm run build` |
| **Estimated runtime** | ~30s for full vitest suite (target) |

---

## Sampling Rate

- **After every task commit:** `npx tsc --noEmit` + 해당 영역 vitest 단위 테스트
- **After every plan wave:** `npx vitest run` + `npm run build`
- **Before `/gsd:verify-work`:** Full suite 그린 + 사용자 9탭 click-through manual smoke
- **Max feedback latency:** ~10s for unit, ~60s for full + build

---

## Per-Task Verification Map

See `08-RESEARCH.md` § Validation Architecture for the full Req → Test mapping table (15+ rows covering SC-01..SC-07 + inquiry + build).

Key mappings:
- SC-01, SC-05 (탭 카운트 정확성) → `tests/orders/get-order-stats.test.ts`
- SC-02 (엑셀 업로드 제거 + 9탭) → `tests/orders/page-header.test.tsx`, `tests/orders/order-tabs.test.tsx`
- SC-03 (CS 컬럼 제거 + 클레임/문의 인디케이터) → `tests/orders/columns.test.tsx`
- SC-04 (displayName 표시) → `tests/orders/get-orders.test.ts`, `tests/orders/columns.test.tsx`
- SC-06 (배송 컬럼 + 스키마) → `tests/db/schema.test.ts`, `tests/marketplace/coupang/normalize.test.ts`, `tests/orders/columns.test.tsx`
- SC-07 (재고 shipping_cost 입력) → `tests/db/schema.test.ts`, `tests/inventory/shipping-cost-edit.test.tsx`
- inquiry 수집 → `tests/marketplace/coupang/inquiries.test.ts`

---

## Wave 0 Requirements

- [ ] `vitest` 설치 (devDep) + `vitest.config.ts` (jsdom env, alias 설정)
- [ ] `tests/setup.ts` — @testing-library/jest-dom matchers + MSW server boot
- [ ] `tests/orders/get-order-stats.test.ts` — stub for SC-01, SC-05
- [ ] `tests/orders/get-orders.test.ts` — stub for SC-04
- [ ] `tests/orders/order-tabs.test.tsx` — stub for SC-01, SC-02
- [ ] `tests/orders/page-header.test.tsx` — stub for SC-02
- [ ] `tests/orders/columns.test.tsx` — stub for SC-03, SC-04, SC-06
- [ ] `tests/db/schema.test.ts` — stub for SC-06, SC-07 (schema import 정적 검증)
- [ ] `tests/inventory/shipping-cost-edit.test.tsx` — stub for SC-07
- [ ] `tests/marketplace/coupang/normalize.test.ts` — stub for SC-06
- [ ] `tests/marketplace/coupang/inquiries.test.ts` — stub for inquiry collection

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 9탭 click-through 카운트/필터 일관성 | SC-01, SC-05 | 실데이터에서 검증 | 운영 환경에서 각 탭 클릭 → URL 변경 + 표 결과 확인 |
| displayName 표시 우선순위 | SC-04 | 매핑 데이터 케이스 다양 | 매핑 있는 주문 + 매핑 없는 주문 비교 |
| 재고관리 shipping_cost 입력 + 새로고침 후 유지 | SC-07 | 인라인 편집 UX | 재고관리 행 클릭 → 값 입력 → 새로고침 → 값 유지 확인 |
| Coupang inquiry 실제 수집 | inquiry | Coupang 운영 계정 필요 | 실제 운영 데이터로 verify |
| Naver inquiry (해당 plan에 포함되면) | inquiry | Partner 권한 필요 | 운영 환경 verify |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s for full + build
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
