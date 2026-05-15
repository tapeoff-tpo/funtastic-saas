---
plan: 260515-collect-result-label
date: 2026-05-15
tags: [orders, collection, ui-copy]
status: completed
---

# Quick Task 260515-collect-result-label: Summary

Updated collection result copy so the UI no longer implies `ordersCollected` means only new orders.

## Changes

- Result rows now show `주문 N건 수집/갱신`.
- Result totals now show `총 N건 수집/갱신`.
- Worker comment now describes manual collection as order collection/update only.

## Verification

- `git diff --check` passed.
