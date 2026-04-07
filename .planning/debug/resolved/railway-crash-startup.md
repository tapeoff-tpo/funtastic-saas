---
status: resolved
trigger: "Railway production app crashing (ERROR 1408100838) after recent git push. /shipping/combined shows 'This page couldn't load - A server error occurred.'"
created: 2026-04-07T00:00:00Z
updated: 2026-04-07T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — /shipping/combined page passes 'placeholder-user-id' (not a valid UUID) to a Drizzle query. Postgres throws "invalid input syntax for type uuid" causing unhandled server error.
test: Read combined page source — confirmed hardcoded userId = 'placeholder-user-id' at line 51
expecting: Fix: read real user from auth session in server component, like other pages do
next_action: Fix combined page to use real auth session; verify no other startup crash

## Symptoms

expected: App starts successfully and /shipping/combined page loads
actual: Railway production app crashing with ERROR 1408100838 - service not responding; /shipping/combined shows server error
errors: ERROR 1408100838 - service not responding
reproduction: Deploy to Railway after recent git push
started: After today's commits (excel order import merge, company settings page, Naver adapter fix)

## Eliminated

- hypothesis: Build/compile error causes crash
  evidence: npx next build completes cleanly with 41 routes, no errors
  timestamp: 2026-04-07

- hypothesis: Missing npm dependency (exceljs, zod, bcryptjs) causes startup crash
  evidence: All modules load successfully with node -e require()
  timestamp: 2026-04-07

- hypothesis: proxy.ts middleware causes health check to fail
  evidence: proxy.ts matcher excludes _next/* but NOT /api/health — however this is pre-existing (unchanged since initial commit 3d1de6d), so not related to today's regression
  timestamp: 2026-04-07

- hypothesis: Database connection crashes at module load (DATABASE_URL undefined)
  evidence: postgres() with undefined connectionString does not throw at import time — defers to first query
  timestamp: 2026-04-07

- hypothesis: BullMQ/Redis causes module-load crash via upload route
  evidence: Redis connection is lazy (getConnection() never called at import time)
  timestamp: 2026-04-07

## Evidence

- timestamp: 2026-04-07
  checked: next build output
  found: Build succeeds cleanly, 41 routes, no errors, no warnings
  implication: Not a compile error

- timestamp: 2026-04-07
  checked: src/app/(auth)/shipping/combined/page.tsx line 51
  found: const userId = 'placeholder-user-id' — hardcoded non-UUID string passed to getShipmentGroups()
  implication: Postgres throws "invalid input syntax for type uuid: 'placeholder-user-id'" on every page load, causing 500 server error

- timestamp: 2026-04-07
  checked: git log for proxy.ts
  found: proxy.ts has not changed since commit 3d1de6d — pre-existing, not today's regression
  implication: Health check intercept is pre-existing; not the new breakage

## Resolution

root_cause: combined/page.tsx passes literal string 'placeholder-user-id' (not a UUID) to getShipmentGroups(). Postgres rejects the WHERE clause with "invalid input syntax for type uuid". This is unhandled — Next.js returns a 500 and shows the "server error" message.
fix: Replace hardcoded placeholder with real auth session (createClient + getUser), redirect to /login if unauthenticated — same pattern used in settings/company/page.tsx and other pages.
verification:
files_changed: [src/app/(auth)/shipping/combined/page.tsx]
