---
plan: 260514-specialoffer-seller-orders
date: 2026-05-14
scope:
  - src/lib/marketplace/adapters/specialoffer/adapter.ts
  - tests/marketplace/specialoffer.test.ts
status: completed
---

# Quick Task 260514-specialoffer-seller-orders: Plan

## Context

Specialoffer 신규주문 1건이 운영 화면에서 보이지만 SaaS 주문수집에 들어오지 않는다.

Investigation found:
- `GET /api/v2/orders` returns buyer-side purchase orders and currently returns `total: 0`.
- `GET /api/v2/seller/orders` returns supplier-side inbound orders, including the current 신규주문.
- Existing adapter `getOrders()` returned `[]`, so the worker had no orders to save.

## Work

1. Change `SpecialofferAdapter.getOrders()` to call `api/v2/seller/orders`.
2. Normalize seller order fields into `NormalizedOrder`.
3. Treat `order_state: 2` as `new`; shipped orders with delivery data map to `shipped`.
4. Add focused test coverage for seller order collection.

## Verification

- Live API smoke check confirms `api/v2/seller/orders` returns orders.
- Run local static checks available in this environment.
