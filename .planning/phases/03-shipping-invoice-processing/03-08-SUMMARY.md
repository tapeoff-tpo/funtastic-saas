---
phase: 03-shipping-invoice-processing
plan: "08"
subsystem: orders/claims
tags: [claims, orders, ui, server-actions, drizzle]
dependency_graph:
  requires: [src/lib/db/schema.ts, src/lib/orders/types.ts, src/lib/supabase/server.ts]
  provides: [getClaims, updateClaimStatus, updateClaimMemo, /orders/claims]
  affects: [src/components/layout/sidebar.tsx]
tech_stack:
  added: []
  patterns: [drizzle-join-query, server-actions-with-auth, server-component-page, client-table-with-transitions]
key_files:
  created:
    - src/lib/orders/claims-queries.ts
    - src/lib/orders/claims-actions.ts
    - src/app/(auth)/orders/claims/page.tsx
    - src/app/(auth)/orders/claims/claims-table.tsx
  modified:
    - src/components/layout/sidebar.tsx
decisions:
  - Used inArray from drizzle-orm for productName lookup (not raw SQL) — consistent with existing queries.ts pattern
  - Reused claims.reason field for admin memo (as specified in plan)
  - Status action buttons show only actions that differ from current status (reduces clutter)
  - Pagination uses window.location.search to preserve existing filter params
metrics:
  duration: "~15 min"
  completed: "2026-04-09"
  tasks: 2
  files: 5
---

# Phase 03 Plan 08: Claims Management Page Summary

**One-liner:** Dedicated /orders/claims page with Drizzle join queries, Server Actions for status/memo updates, type/status filter tabs, and inline table row actions.

## What Was Built

### Task 1: Claims queries and server actions

- **`src/lib/orders/claims-queries.ts`** — `getClaims(userId, filters?)` query using Drizzle joins:
  - `INNER JOIN orders` for buyerName, recipientName, marketplaceOrderId
  - Separate `inArray` query for first orderItem productName per order
  - Filters: claimType, claimStatus, page, pageSize (default 50)
  - Returns `{ claims: ClaimWithOrder[], total: number }`

- **`src/lib/orders/claims-actions.ts`** — Two `'use server'` actions:
  - `updateClaimStatus(claimId, status)` — updates claimStatus + updatedAt, verifies ownership via `AND userId = user.id`, revalidates path
  - `updateClaimMemo(claimId, memo)` — overwrites reason field, verifies ownership, revalidates path

### Task 2: Claims UI page and sidebar

- **`src/app/(auth)/orders/claims/page.tsx`** — Server component:
  - Auth check via supabase server client, redirects to /login if unauthenticated
  - Parses searchParams (claimType, claimStatus, page)
  - Type filter tabs: 전체 / 취소 / 반품 / 교환
  - Status filter pills: 전체 / 접수 / 처리중 / 완료 / 반려
  - Passes data to `ClaimsTable` client component

- **`src/app/(auth)/orders/claims/claims-table.tsx`** — `'use client'` component:
  - Native HTML table with Tailwind styling
  - Columns: 마켓, 주문번호, 구매자, 상품명, 클레임유형, 상태, 접수일, 사유/메모, 액션
  - Type badges: 취소(gray), 반품(amber), 교환(blue)
  - Status badges: 접수(yellow), 처리중(blue), 완료(green), 반려(red)
  - Per-row `ClaimRow` component with local state for memo, `useTransition` for non-blocking status updates
  - Memo saves on blur if changed
  - Status buttons show only transitions away from current status
  - Pagination preserves filter query params via `window.location.search`

- **`src/components/layout/sidebar.tsx`** — Added `AlertTriangle` import and nav item for 클레임 after 주문관리

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data is wired from the real claims table via getClaims.

## Self-Check: PASSED

Files created:
- src/lib/orders/claims-queries.ts — FOUND
- src/lib/orders/claims-actions.ts — FOUND
- src/app/(auth)/orders/claims/page.tsx — FOUND
- src/app/(auth)/orders/claims/claims-table.tsx — FOUND
- src/components/layout/sidebar.tsx (modified) — FOUND

Commits:
- f7452e5 feat(03-08): add claims queries and server actions — FOUND
- da102b6 feat(03-08): add claims management UI page and sidebar link — FOUND

TypeScript: No new errors introduced by this plan.
