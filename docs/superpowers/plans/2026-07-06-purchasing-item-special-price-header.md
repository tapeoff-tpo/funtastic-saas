# 품목 특가 헤더 변경 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 품목 업로드 버튼을 `파일 업로드`로 바꾸고 ESA009M의 표준 원가 헤더를 `특가(元)`로 변경하면서 이전 파일도 업로드할 수 있게 한다.

**Architecture:** `ESA009M_HEADERS`의 표준 키는 `특가(元)`로 교체한다. 파서에서 이전 `기존원가(元)` 헤더를 새 표준 키의 별칭으로만 허용해 저장, 화면, 다운로드에는 새 키만 남긴다.

**Tech Stack:** Next.js 16, TypeScript, ExcelJS, Vitest

---

### Task 1: ESA009M 특가 헤더 호환

**Files:**
- Modify: `src/lib/purchasing/items.ts`
- Test: `src/lib/purchasing/items.test.ts`

- [ ] **Step 1: 이전 헤더 호환 실패 테스트 작성**

`기존원가(元)` 열이 포함된 파일을 파싱했을 때 결과 키가 `특가(元)`이고 값이 보존되는 테스트를 추가한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/purchasing/items.test.ts`

Expected: `특가(元)` 키 또는 값 검증 실패.

- [ ] **Step 3: 표준 헤더와 별칭 처리 구현**

`ESA009M_HEADERS`와 숫자 헤더를 `특가(元)`로 변경하고, 헤더 조회 시 `특가(元)`가 없으면 `기존원가(元)`의 열 번호를 사용한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/purchasing/items.test.ts`

Expected: 모든 품목 파서 테스트 통과.

### Task 2: 업로드 버튼 문구 및 전체 검증

**Files:**
- Modify: `src/components/purchasing-item-upload.tsx`

- [ ] **Step 1: 버튼 문구 변경**

대기 상태 문구 `ESA009M 업로드`를 `파일 업로드`로 변경하고 진행 중 문구 `반영 중`은 유지한다.

- [ ] **Step 2: 정적 검사**

Run: `npx eslint src/lib/purchasing/items.ts src/lib/purchasing/items.test.ts src/components/purchasing-item-upload.tsx`

Expected: 오류 없음.

- [ ] **Step 3: 운영 빌드**

Run: `npm run build`

Expected: Next.js production build 성공.

- [ ] **Step 4: 배포**

변경 파일과 계획 문서만 커밋해 `origin main`에 푸시하고 Vercel 운영 배포 및 `/api/health`의 커밋 SHA를 확인한다.
