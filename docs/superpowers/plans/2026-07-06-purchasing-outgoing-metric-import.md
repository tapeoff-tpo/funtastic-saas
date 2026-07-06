# 품목 출고 지표 강제 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 월 판매 계산기의 2026년 4~6월 출고량을 현재 ESA009M 품목 3,065개에 반영한다.

**Architecture:** 월 판매 계산기 파서는 사방넷 상품코드와 4~6월 값을 읽어 6월 출고량 및 3개월 평균을 만든다. 결과는 품목 메타데이터의 별도 키에 출처와 기준월을 포함해 저장하고, 품목 목록과 발주 추천은 이 강제 반영값을 기존 사방넷 집계값보다 우선 사용한다.

**Tech Stack:** TypeScript, ExcelJS, Drizzle ORM, PostgreSQL, Vitest, Next.js 16

---

### Task 1: 월 판매 계산기 파서

**Files:**
- Create: `src/lib/purchasing/monthly-sales-calculator.ts`
- Create: `src/lib/purchasing/monthly-sales-calculator.test.ts`

- [ ] **Step 1:** 4~6월 평균, 6월 당월값, 빈 값 0 처리 테스트를 작성한다.
- [ ] **Step 2:** 테스트가 구현 부재로 실패하는지 확인한다.
- [ ] **Step 3:** `메인` 시트의 사방넷상품코드와 `26/04`, `26/05`, `26/06` 열을 헤더명으로 찾아 파싱한다.
- [ ] **Step 4:** 파서 테스트가 통과하는지 확인한다.

### Task 2: 저장값 우선 조회

**Files:**
- Modify: `src/lib/purchasing/items.ts`
- Modify: `src/lib/purchasing/items.test.ts`

- [ ] **Step 1:** 저장된 강제 반영값의 검증 및 우선순위 테스트를 작성한다.
- [ ] **Step 2:** 테스트 실패를 확인한다.
- [ ] **Step 3:** 품목 메타데이터의 `purchasingOutgoingMetrics`를 읽고 유효한 값이면 기존 사방넷 주문 집계값을 덮어쓴다.
- [ ] **Step 4:** 관련 테스트를 모두 통과시킨다.

### Task 3: 안전한 일회성 반영 도구

**Files:**
- Create: `scripts/import-purchasing-outgoing-metrics.ts`

- [ ] **Step 1:** 기본 실행은 읽기 전용으로 매칭·미매칭 수만 출력하게 한다.
- [ ] **Step 2:** `--apply`에서만 일치하는 ESA009M 품목 메타데이터를 배치 업데이트하게 한다.
- [ ] **Step 3:** 출처 `monthly-sales-calculator`, 기준월 `2026-06`, 반영 시각을 함께 저장한다.
- [ ] **Step 4:** 읽기 전용 실행에서 일치 3,065개, 계산기 미매칭 36개를 다시 확인한다.

### Task 4: 검증, 배포, 운영 반영

**Files:**
- Verify all modified files

- [ ] **Step 1:** 관련 Vitest와 ESLint를 실행한다.
- [ ] **Step 2:** Next.js 운영 빌드를 실행한다.
- [ ] **Step 3:** 변경을 커밋해 `origin main`에 푸시하고 Vercel Ready 상태를 확인한다.
- [ ] **Step 4:** 일회성 도구를 `--apply`로 실행하고 업데이트 수를 확인한다.
- [ ] **Step 5:** 운영 DB에서 표본과 총 저장 건수를 읽기 전용으로 검증한다.
