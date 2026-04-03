---
phase: 01-foundation-marketplace-infrastructure
plan: 02
subsystem: api
tags: [marketplace, adapter-pattern, supabase-vault, drizzle, typescript, credential-storage]

# Dependency graph
requires:
  - phase: 01-foundation-marketplace-infrastructure/01
    provides: DB schema with marketplace_connections table, Drizzle ORM setup, Supabase client
provides:
  - MarketplaceAdapter interface and typed error classes
  - MarketplaceRegistry singleton for adapter lookup
  - Vault SQL RPC functions for encrypted credential storage
  - Admin client with storeCredential/readCredential/deleteCredential
  - Credentials API route (POST/DELETE) with auth
affects: [02-order-collection, 03-shipping-invoice, marketplace-adapters]

# Tech tracking
tech-stack:
  added: []
  patterns: [adapter-pattern-with-registry, vault-rpc-security-definer, service-role-admin-client]

key-files:
  created:
    - src/lib/marketplace/types.ts
    - src/lib/marketplace/errors.ts
    - src/lib/marketplace/registry.ts
    - src/lib/marketplace/adapters/.gitkeep
    - src/lib/supabase/admin.ts
    - supabase/migrations/001_vault_functions.sql
    - src/app/api/marketplace/credentials/route.ts
    - src/__tests__/marketplace/registry.test.ts
  modified: []

key-decisions:
  - "Exported MarketplaceRegistry class alongside singleton for testability (fresh instances in tests)"
  - "Vault SQL functions use SECURITY DEFINER + REVOKE/GRANT to restrict to service_role only"
  - "Credential naming convention: mkt_{userId}_{marketplaceId}_{credentialKey}"

patterns-established:
  - "Adapter pattern: implement MarketplaceAdapter interface, register with marketplaceRegistry"
  - "Vault credential naming: mkt_{userId}_{marketplaceId}_{credentialKey}"
  - "Admin client pattern: createAdminClient() for service_role operations, never in browser"

requirements-completed: [MKT-06, FOUND-04]

# Metrics
duration: 4min
completed: 2026-04-03
---

# Phase 01 Plan 02: Marketplace Adapter Interface & Credential Storage Summary

**MarketplaceAdapter interface with registry pattern, Vault RPC functions for encrypted credentials, and admin client with credential CRUD API route**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-03T03:08:32Z
- **Completed:** 2026-04-03T03:12:06Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- MarketplaceAdapter interface with testConnection, authenticate, getOrders, uploadInvoice, getProducts
- MarketplaceRegistry with register/get/has/listIds/listConfigs and proper error handling
- Three typed error classes: MarketplaceAuthError, MarketplaceRateLimitError, MarketplaceApiError
- Vault SQL functions (store/read/delete/update) restricted to service_role only
- Admin client helpers for credential CRUD via Vault RPC
- Credentials API route with auth verification, validation, and Drizzle DB operations
- 10 unit tests passing for registry and error classes

## Task Commits

Each task was committed atomically:

1. **Task 1: Define marketplace adapter types, errors, and registry with tests** - `d5c7d2d` (test: RED), `ac4def1` (feat: GREEN)
2. **Task 2: Create Vault SQL functions and admin client** - `5efd16c` (feat)

## Files Created/Modified
- `src/lib/marketplace/types.ts` - MarketplaceAdapter interface, MarketplaceConfig, MarketplaceId, and supporting types
- `src/lib/marketplace/errors.ts` - MarketplaceAuthError, MarketplaceRateLimitError, MarketplaceApiError
- `src/lib/marketplace/registry.ts` - MarketplaceRegistry class with singleton export
- `src/lib/marketplace/adapters/.gitkeep` - Directory placeholder for future adapter implementations
- `src/lib/supabase/admin.ts` - Service-role client and Vault credential helpers
- `supabase/migrations/001_vault_functions.sql` - Vault RPC wrapper functions with service_role restriction
- `src/app/api/marketplace/credentials/route.ts` - POST/DELETE API routes for credential management
- `src/__tests__/marketplace/registry.test.ts` - 10 unit tests for registry and error classes

## Decisions Made
- Exported MarketplaceRegistry class alongside singleton to allow fresh instances in unit tests (avoids shared state between tests)
- Vault SQL functions use SECURITY DEFINER + explicit REVOKE/GRANT to ensure only service_role can call them
- Credential naming convention `mkt_{userId}_{marketplaceId}_{credentialKey}` enables predictable lookups without a mapping table
- NormalizedOrder and NormalizedProduct interfaces defined as extensible stubs (Phase 2/5 will expand them)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
- `NormalizedOrder` interface in types.ts is minimal (orderId + marketplaceId + extensible), will be expanded in Phase 2
- `NormalizedProduct` interface in types.ts is minimal, will be expanded in Phase 5
- Phase 2+ methods (authenticate, getOrders, uploadInvoice, getProducts) declared in interface but concrete adapters not yet implemented

## Next Phase Readiness
- Adapter interface and registry ready for Coupang/Naver adapter implementations (Plan 01-03)
- Vault functions ready for migration to Supabase (requires `supabase db push` or migration run)
- Credentials API route ready for frontend integration
- onConflictDoUpdate in credentials route assumes a unique constraint on (userId, marketplaceId) -- verify this exists in DB schema or add in migration

## Self-Check: PASSED

All 8 files verified present. All 3 commits verified in git log.

---
*Phase: 01-foundation-marketplace-infrastructure*
*Completed: 2026-04-03*
