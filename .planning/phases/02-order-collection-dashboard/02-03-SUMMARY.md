---
phase: 02-order-collection-dashboard
plan: 03
subsystem: infra
tags: [bullmq, redis, ioredis, job-queue, worker, order-collection]

# Dependency graph
requires:
  - phase: 02-order-collection-dashboard/02-01
    provides: "Order schema (orders, orderItems, claims, jobLogs tables), NormalizedOrder/NormalizedClaim types"
provides:
  - "Redis connection for BullMQ (src/lib/jobs/connection.ts)"
  - "Order collection queue with 5-min repeating schedule (src/lib/jobs/queues.ts)"
  - "Order collection worker processor (src/lib/jobs/workers/order-collector.ts)"
  - "Standalone worker entry point (worker.ts)"
  - "Docker Compose for local Redis (docker-compose.yml)"
affects: [02-04-marketplace-adapters, 02-05-dashboard, 03-shipping-invoice]

# Tech tracking
tech-stack:
  added: [bullmq, ioredis, redis]
  patterns: [bullmq-repeatable-jobs, upsert-deduplication, standalone-worker-process]

key-files:
  created:
    - src/lib/jobs/connection.ts
    - src/lib/jobs/queues.ts
    - src/lib/jobs/workers/order-collector.ts
    - worker.ts
    - docker-compose.yml
    - tests/jobs/order-collector.test.ts
    - tests/jobs/claims-collector.test.ts
  modified:
    - .env.example

key-decisions:
  - "Registry-based adapter creation: worker uses marketplaceRegistry.get() instead of direct imports for extensibility"
  - "15-minute overlap window for order polling to prevent missed orders during gaps"
  - "Job log update via UPSERT (insert + onConflictDoUpdate on id) to handle both creation and status updates"

patterns-established:
  - "BullMQ worker pattern: standalone worker.ts entry point, separate from Next.js process"
  - "UPSERT dedup pattern: onConflictDoUpdate on unique constraint for idempotent order/claims collection"
  - "Job scheduling pattern: jobId-based deduplication prevents duplicate repeatable jobs per connection"

requirements-completed: [ORD-01, ORD-05]

# Metrics
duration: 5min
completed: 2026-04-03
---

# Phase 02 Plan 03: BullMQ Job Infrastructure Summary

**BullMQ order collection worker with Redis connection, 5-min repeating schedule, UPSERT deduplication, and claims collection**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-03T04:11:11Z
- **Completed:** 2026-04-03T04:17:09Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Redis connection module with BullMQ-required settings (maxRetriesPerRequest: null)
- Order collection queue with 5-minute repeating schedule and jobId-based dedup to prevent duplicate scheduling
- Worker processor that UPSERTs orders and claims with deduplication per D-04
- Raw marketplace data preserved in rawData column per D-03
- Job execution logged to job_logs table for monitoring
- Standalone worker.ts with graceful shutdown (SIGINT/SIGTERM)
- Docker Compose for local Redis development

## Task Commits

Each task was committed atomically:

1. **Task 1: Redis connection, BullMQ queue definitions, and Docker Compose** - `e389fd4` (feat)
2. **Task 2 RED: Failing tests for order collection worker** - `c43af7e` (test)
3. **Task 2 GREEN: Order collection worker implementation** - `cfb7150` (feat)

## Files Created/Modified
- `src/lib/jobs/connection.ts` - IORedis connection with BullMQ settings, error logging
- `src/lib/jobs/queues.ts` - Queue definitions, scheduleOrderCollection with 5-min repeat, scheduleAllCollections
- `src/lib/jobs/workers/order-collector.ts` - processOrderCollection: fetches orders/claims, UPSERTs with dedup, logs to job_logs
- `worker.ts` - Standalone BullMQ worker entry point with graceful shutdown
- `docker-compose.yml` - Redis 7 Alpine for local development
- `tests/jobs/order-collector.test.ts` - 5 tests: UPSERT, rawData, job logging, error handling, dedup
- `tests/jobs/claims-collector.test.ts` - 3 tests: claims UPSERT, orderId lookup, skip on missing order
- `.env.example` - Added REDIS_URL

## Decisions Made
- Used marketplaceRegistry.get() for adapter creation instead of direct class imports, keeping the worker extensible for any registered marketplace
- Set 15-minute overlap window for order polling (since = 15 min ago) to prevent missed orders during gaps between poll cycles
- Job log updates use UPSERT pattern (insert + onConflictDoUpdate on id) to handle both initial creation and status updates in a single pattern
- Claims that reference non-existent orders are skipped with a warning log, rather than failing the entire job

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Test mocks needed careful structuring to support Drizzle's fluent API chain (.insert().values().onConflictDoUpdate().returning() AND .insert().values().returning()) - resolved by creating a factory function that returns both chains

## User Setup Required

Redis is required for BullMQ. For local development:
- Run `docker compose up -d` to start Redis on port 6379
- Or set `REDIS_URL` in `.env.local` for a remote Redis (e.g., Upstash)

## Known Stubs

None - all code paths are fully implemented. Marketplace adapters are stubs from Phase 1 Plan 02 (configs.ts), but that is out of scope for this plan and will be resolved by Plan 02-02 (marketplace adapters).

## Next Phase Readiness
- Job infrastructure ready for marketplace adapter integration (Plan 02-02 provides real getOrders/getClaimsOrders)
- Dashboard (Plan 02-05) can use jobLogs table for monitoring
- Worker can be started independently with `npx tsx worker.ts`

---
*Phase: 02-order-collection-dashboard*
*Completed: 2026-04-03*
