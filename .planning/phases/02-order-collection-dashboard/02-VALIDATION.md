---
phase: 2
slug: order-collection-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-03
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | `vitest.config.ts` (exists from Phase 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every wave merge:** Run `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

---

## Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORD-01 | Order collection from Coupang/Naver on schedule | integration | `npx vitest run tests/jobs/order-collector.test.ts` | No — Wave 0 |
| ORD-02 | Unified order listing query | unit | `npx vitest run tests/orders/queries.test.ts` | No — Wave 0 |
| ORD-03 | Filter/search orders | unit | `npx vitest run tests/orders/queries.test.ts` | No — Wave 0 |
| ORD-04 | Status transitions | unit | `npx vitest run tests/orders/status.test.ts` | No — Wave 0 |
| ORD-05 | Claims collection | integration | `npx vitest run tests/jobs/claims-collector.test.ts` | No — Wave 0 |
| ORD-06 | Hold order with reason | unit | `npx vitest run tests/orders/hold-release.test.ts` | No — Wave 0 |
| ORD-07 | Release held order | unit | `npx vitest run tests/orders/hold-release.test.ts` | No — Wave 0 |
| MKT-01 | Coupang adapter getOrders | unit | `npx vitest run tests/marketplace/coupang.test.ts` | No — Wave 0 |
| MKT-02 | Naver adapter getOrders | unit | `npx vitest run tests/marketplace/naver.test.ts` | No — Wave 0 |

---

## Wave 0 Gaps

- [ ] `tests/marketplace/coupang.test.ts` — Coupang HMAC signing + order normalization (MKT-01)
- [ ] `tests/marketplace/naver.test.ts` — Naver OAuth + order normalization (MKT-02)
- [ ] `tests/orders/queries.test.ts` — Order listing, filtering, pagination (ORD-02, ORD-03)
- [ ] `tests/orders/status.test.ts` — Status transition validation (ORD-04)
- [ ] `tests/orders/hold-release.test.ts` — Hold/release logic (ORD-06, ORD-07)
- [ ] `tests/jobs/order-collector.test.ts` — BullMQ job processing with mocked adapters (ORD-01)
- [ ] `tests/jobs/claims-collector.test.ts` — Claims collection (ORD-05)
- [ ] `tests/helpers/msw-handlers.ts` — MSW handlers for Coupang/Naver API mocks

---

## Notes

- UI plans (02-04, 02-05) use `npx tsc --noEmit` only — no Vitest tests for UI components.
  This tradeoff is accepted because Next.js server/client component testing adds significant
  complexity. Behavioral verification is done via the checkpoint in Plan 02-05.
