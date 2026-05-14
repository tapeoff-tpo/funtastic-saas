---
plan: 260514-specialoffer-seller-orders
date: 2026-05-14
tags: [specialoffer, orders, seller-api]
status: completed
---

# Quick Task 260514-specialoffer-seller-orders: Summary

Specialoffer order collection now uses the supplier-side seller order endpoint.

## Findings

- `GET /api/v2/orders` is buyer-side purchase history and returned `total: 0` for the supplied key.
- `GET /api/v2/seller/orders` is supplier-side inbound order history and returned the current new order.
- The adapter previously returned `[]` from `getOrders()`, so the order collector could not save Specialoffer orders.

## Changes

- `SpecialofferAdapter.getOrders()` now fetches `api/v2/seller/orders`.
- Seller order rows are normalized to `NormalizedOrder`.
- `order_no` is used as the marketplace order id and `order_id` is retained as the line/item id.
- `order_state: 2` maps to SaaS `new`; shipped orders with delivery data map to `shipped`.
- Seller order pagination uses `per_page=30` because Specialoffer returns HTTP 500 at `per_page=50` and `per_page=100`.
- Added Vitest coverage for seller order collection.

## Verification

- Live API smoke check confirmed `api/v2/seller/orders?per_page=10` returns supplier orders.
- Live API smoke check confirmed `per_page=30` succeeds and `per_page>=50` fails with Specialoffer server 500.
- `git diff --check` passed.
- Full Vitest/build could not run locally because this checkout has no `node_modules` and no `npm` binary in PATH.
