---
plan: 260515-collect-result-label
date: 2026-05-15
scope:
  - src/components/marketplace/marketplace-dashboard.tsx
  - src/components/marketplace/collect-orders-panel.tsx
  - src/lib/jobs/workers/order-collector.ts
status: completed
---

# Quick Task 260515-collect-result-label: Plan

## Context

Order collection result UI labeled `ordersCollected` as `신규주문`, but the field counts saved or updated orders, not only newly inserted `status='new'` orders.

## Work

1. Change collection result row text from `신규주문 N건 수집` to `주문 N건 수집/갱신`.
2. Change collection result total text from `총 N건 수집` to `총 N건 수집/갱신`.
3. Update an internal worker comment so it no longer says manual collection only collects new orders.

## Verification

- `git diff --check`
