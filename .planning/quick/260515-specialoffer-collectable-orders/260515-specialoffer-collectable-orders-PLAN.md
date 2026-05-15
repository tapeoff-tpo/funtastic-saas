---
plan: 260515-specialoffer-collectable-orders
date: 2026-05-15
scope:
  - src/lib/marketplace/adapters/specialoffer/adapter.ts
  - tests/marketplace/specialoffer.test.ts
status: completed
---

# Quick Task 260515-specialoffer-collectable-orders: Plan

## Context

Specialoffer order collection still reported 9 collected/updated orders even though the seller page showed only 1 shipping-preparation order.

Live API inspection showed the first seller order page contained:
- `order_state=3`: 1 order without delivery data
- `order_state=5`: many orders with delivery numbers/dates
- other completed/cancel-like states

The adapter was collecting all recent changed orders, including shipped orders.

## Work

1. Restrict Specialoffer seller order collection to collectable states `2` and `3`.
2. Require no `delivery_no` and no `delivery_date`.
3. Map collectable Specialoffer orders to SaaS `new`.
4. Add tests that shipped seller orders are skipped.

## Verification

- `git diff --check`
