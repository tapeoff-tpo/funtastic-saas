# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## railway-crash-startup — /shipping/combined 500: placeholder UUID passed to Postgres
- **Date:** 2026-04-07
- **Error patterns:** service not responding, server error, 1408100838, shipping combined, placeholder-user-id, invalid input syntax for type uuid
- **Root cause:** combined/page.tsx passed the literal string 'placeholder-user-id' (not a valid UUID) as the userId argument to getShipmentGroups(). Postgres rejected the WHERE clause with "invalid input syntax for type uuid", causing an unhandled 500 on every page load.
- **Fix:** Replace hardcoded userId with real auth session: await createClient(), getUser(), redirect to /login if unauthenticated. Same pattern as settings/company/page.tsx.
- **Files changed:** src/app/(auth)/shipping/combined/page.tsx
---

