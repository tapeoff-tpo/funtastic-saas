---
phase: 1
slug: foundation-marketplace-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-03
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | None — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every wave merge:** Run `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

---

## Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | Login with email/password | integration | `npx vitest run src/__tests__/auth/login.test.ts -t "login"` | No — Wave 0 |
| FOUND-02 | Session persists across refresh | integration | `npx vitest run src/__tests__/auth/session.test.ts` | No — Wave 0 |
| FOUND-03 | Register marketplace credentials | unit + integration | `npx vitest run src/__tests__/marketplace/credentials.test.ts` | No — Wave 0 |
| FOUND-04 | Credentials stored encrypted | unit | `npx vitest run src/__tests__/marketplace/vault.test.ts` | No — Wave 0 |
| FOUND-05 | Dashboard shows marketplace status | unit | `npx vitest run src/__tests__/marketplace/health.test.ts` | No — Wave 0 |
| MKT-06 | Adapter interface extensibility | unit | `npx vitest run src/__tests__/marketplace/registry.test.ts` | No — Wave 0 |

---

## Wave 0 Gaps

- [ ] `vitest.config.ts` — Vitest configuration with path aliases
- [ ] `src/__tests__/marketplace/registry.test.ts` — Adapter registry CRUD tests
- [ ] `src/__tests__/marketplace/credentials.test.ts` — Credential storage/retrieval tests (mock Vault RPC)
- [ ] `src/__tests__/marketplace/health.test.ts` — Connection status logic tests
- [ ] `src/__tests__/auth/login.test.ts` — Auth flow tests (mock Supabase Auth)
- [ ] Framework install: `npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react`
