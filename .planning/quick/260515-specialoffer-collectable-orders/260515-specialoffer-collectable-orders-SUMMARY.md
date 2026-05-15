---
plan: 260515-specialoffer-collectable-orders
date: 2026-05-15
tags: [specialoffer, orders, collectable-filter]
status: completed
---

# Quick Task 260515-specialoffer-collectable-orders: Summary

Specialoffer collection now excludes already-shipped seller orders.

## Changes

- Added a collectable-order filter for Specialoffer seller orders.
- Only `order_state` `2` or `3` with no delivery number/date is collected.
- Collectable Specialoffer orders map to SaaS `new`.
- Added test coverage for skipping shipped Specialoffer orders.

## Verification

- `git diff --check` passed.
