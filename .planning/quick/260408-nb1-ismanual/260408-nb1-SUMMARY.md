---
phase: quick
plan: 260408-nb1
subsystem: dashboard
tags: [manual-channel, marketplace, excel-upload]
dependency_graph:
  requires: [marketplace-connections-schema, dashboard-ui]
  provides: [manual-channel-support]
  affects: [order-import-flow]
tech_stack:
  added: []
  patterns: [server-action-with-useTransition, modal-pattern]
key_files:
  created:
    - supabase/migrations/004_add_is_manual.sql
    - src/app/(auth)/dashboard/actions.ts
  modified:
    - src/lib/db/schema.ts
    - src/app/(auth)/dashboard/page.tsx
    - src/components/marketplace/marketplace-dashboard.tsx
decisions:
  - Use api_key as placeholder authType for manual channels (field is NOT NULL)
  - Manual channels use nanoid(6) suffix for unique marketplaceId
  - Manual cards show descriptive text instead of lastCheckedAt info
metrics:
  duration: 3min
  completed: 2026-04-08
---

# Quick Task 260408-nb1: Manual Channel Support Summary

Manual channel (is_manual) for marketplace dashboard -- users add channels with just a display name for excel-only order management.

## What Was Done

### Task 1: DB migration + schema update (0336a82)
- Created migration 004 adding `is_manual BOOLEAN NOT NULL DEFAULT false` to marketplace_connections
- Added `isManual` field to Drizzle schema in schema.ts

### Task 2: Server action + dashboard UI (3694484)
- Created `addManualChannel` server action that inserts a connection with `isManual: true`, `status: connected`, `authType: api_key`, empty vault secrets
- Updated dashboard page.tsx to pass `isManual` in connection props
- Updated marketplace-dashboard.tsx:
  - "수동 쇼핑몰 추가" button always visible in header
  - Modal with name input, uses `useTransition` for submission
  - Manual channel cards: no checkbox, no click-to-select, "수동" badge, blue border accent
  - Manual channels excluded from `connectedMarkets` filter (not counted in 전체수집)
  - Excel upload button remains functional on manual cards
  - Manual cards show "엑셀 업로드로 주문을 관리합니다." instead of lastCheckedAt

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all features are fully wired.

## Verification

- TypeScript compiles (only pre-existing errors in unrelated files)
- Migration SQL is valid single ALTER TABLE statement
- Manual channel cards render without checkbox and with "수동" badge
- Manual channels excluded from connectedMarkets (전체수집 count)
