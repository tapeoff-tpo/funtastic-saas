# Phase 2: Order Collection & Dashboard - Research

**Researched:** 2026-04-03
**Domain:** BullMQ job processing, marketplace API integration (Coupang/Naver), order dashboard (TanStack Table + nuqs)
**Confidence:** MEDIUM-HIGH

## Summary

Phase 2 is the core value delivery -- automatic order collection from Coupang and Naver on a schedule, displayed in a unified dashboard. This phase transforms the Phase 1 placeholder adapters into real API integrations, adds BullMQ + Redis for background job scheduling, creates the orders/claims database schema, and builds the order management dashboard with TanStack Table v8.

The main technical challenges are: (1) implementing HMAC-SHA256 signing for Coupang and OAuth2 token management for Naver, (2) setting up BullMQ workers as a separate process since Next.js/Vercel cannot run persistent workers, (3) designing the order schema to handle both normalized data and raw marketplace responses, and (4) building server-side paginated tables that sync filter state to URL params via nuqs.

**Primary recommendation:** Build bottom-up: DB schema first, then marketplace adapters with real API calls, then BullMQ worker infrastructure, then dashboard UI. Keep the worker process as a standalone Node.js script (`worker.ts`) that runs alongside Next.js during development.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** BullMQ + Redis for background job processing. Scheduled polling every 5-15 minutes per marketplace.
- **D-02:** Coupang and Naver adapters implement getOrders() and getClaimsOrders() methods from MarketplaceAdapter interface (Phase 1).
- **D-03:** Orders normalized to internal schema on collection. Raw marketplace data preserved for debugging.
- **D-04:** Deduplication via UPSERT on (marketplace_id, marketplace_order_id).
- **D-05:** TanStack Table v8 for the order table -- sorting, filtering, pagination, column visibility, row selection.
- **D-06:** nuqs for URL state management -- table filters sync to URL query params (bookmark-friendly).
- **D-07:** Korean status labels: 신규, 확인, 출고대기, 출고완료, 배송중, 배송완료.
- **D-08:** Filters: marketplace, date range, status, product name, order number, buyer name.
- **D-09:** Claims (cancel/return/exchange) collected alongside orders on same schedule.
- **D-10:** Claims shown in a separate tab or filter view on the order dashboard.
- **D-11:** Hold = flag + reason text. Release = remove flag, return to previous status.

### Claude's Discretion
- BullMQ worker deployment approach (separate process vs inline)
- Specific Coupang/Naver API endpoint selection
- Table column configuration and default visibility
- Pagination strategy (server-side vs client-side)
- Order detail view design

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORD-01 | 연동된 마켓플레이스에서 주문을 자동으로 수집할 수 있다 (스케줄 기반) | BullMQ repeatable jobs with cron pattern `*/5 * * * *` per marketplace. Coupang PO list query + Naver lastChangedStatuses API. |
| ORD-02 | 모든 마켓플레이스의 주문을 하나의 통합 대시보드에서 조회할 수 있다 | TanStack Table v8 with server-side pagination. Drizzle ORM query joining orders + order_items + marketplace_connections. |
| ORD-03 | 주문을 마켓플레이스, 날짜, 상태, 상품명, 주문번호, 구매자명으로 필터링/검색할 수 있다 | nuqs for URL state. Server-side filtering with Drizzle `where()` clauses. TanStack Table column filters with `manualFiltering: true`. |
| ORD-04 | 주문 상태를 관리할 수 있다 (신규->확인->출고대기->출고완료->배송중->배송완료) | Postgres enum for internal status. Status mapping functions per adapter. Server action for status transitions with validation. |
| ORD-05 | 마켓플레이스에서 취소/반품/교환 클레임을 자동 수집할 수 있다 | Coupang: GET /returnRequests endpoint. Naver: lastChangedStatuses with claim types. Separate claims table or claim_type column on orders. |
| ORD-06 | 문제 주문을 보류 처리하고 사유를 기록할 수 있다 | `is_held` boolean + `hold_reason` text + `held_at` timestamp on orders table. Server action for hold with reason. |
| ORD-07 | 보류된 주문을 해제하고 정상 처리 흐름으로 복귀시킬 수 있다 | `previous_status` column to restore on release. Server action clears hold fields and restores status. |
| MKT-01 | 쿠팡 API 연동 (주문수집, 송장업로드, 상품등록) | Phase 2 scope: order collection + claims only. HMAC-SHA256 auth, PO list query endpoint, return request list query. |
| MKT-02 | 네이버 스마트스토어 API 연동 (주문수집, 송장업로드, 상품등록) | Phase 2 scope: order collection + claims only. OAuth2 token management, lastChangedStatuses endpoint, product order details. |
</phase_requirements>

## Standard Stack

### Core (New for Phase 2)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| BullMQ | 5.72.1 | Job queue for scheduled marketplace polling | Locked decision (D-01). Mature rate limiting per queue, repeatable jobs, Redis-backed persistence. |
| ioredis | 5.10.1 | Redis client for BullMQ | Required by BullMQ. Drop-in Redis client. |
| ky | 1.14.3 | HTTP client for marketplace APIs | Lightweight fetch wrapper with retry, timeout, hooks. 3KB vs axios 400KB. |
| p-limit | 7.3.0 | Concurrency control | Rate limit concurrent API calls per marketplace within BullMQ workers. |
| @tanstack/react-table | 8.21.3 | Headless data table | Locked decision (D-05). Server-side pagination, sorting, filtering, row selection. |
| date-fns | 4.1.0 | Date formatting/manipulation | KST timezone handling, date range filters, marketplace API date params. |
| pino | 10.3.1 | Structured logging | Log all marketplace API interactions for debugging. JSON output. |

### Already Installed
| Library | Version | Purpose |
|---------|---------|---------|
| nuqs | 2.8.9 | URL state management for table filters (D-06) |
| drizzle-orm | 0.45.2 | Type-safe SQL for order queries |
| zod | 4.3.6 | Validate marketplace API responses |
| sonner | 2.0.7 | Toast notifications for sync status |

### Installation
```bash
npm install bullmq ioredis ky p-limit @tanstack/react-table date-fns pino
```

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)
```
src/
├── app/(auth)/
│   └── orders/                    # Order management pages
│       ├── page.tsx               # Order list with TanStack Table
│       ├── columns.tsx            # Column definitions
│       ├── data-table.tsx         # Table component (client)
│       ├── filters.tsx            # Filter controls
│       └── actions.ts             # Server actions (status change, hold/release)
├── lib/
│   ├── marketplace/
│   │   ├── adapters/
│   │   │   ├── configs.ts         # Existing (update)
│   │   │   ├── coupang/
│   │   │   │   ├── client.ts      # HMAC-SHA256 signing + ky instance
│   │   │   │   ├── adapter.ts     # CoupangAdapter class
│   │   │   │   ├── types.ts       # Coupang-specific response types
│   │   │   │   └── status-map.ts  # Coupang status -> internal status mapping
│   │   │   └── naver/
│   │   │       ├── client.ts      # OAuth2 token management + ky instance
│   │   │       ├── adapter.ts     # NaverAdapter class
│   │   │       ├── types.ts       # Naver-specific response types
│   │   │       └── status-map.ts  # Naver status -> internal status mapping
│   │   └── types.ts               # Update NormalizedOrder with full fields
│   ├── orders/
│   │   ├── types.ts               # Order domain types, status enum
│   │   ├── queries.ts             # Drizzle queries (list, filter, count)
│   │   └── actions.ts             # Business logic (status transitions, hold/release)
│   ├── jobs/
│   │   ├── queues.ts              # BullMQ queue definitions
│   │   ├── workers/
│   │   │   └── order-collector.ts # Worker that polls marketplaces
│   │   └── connection.ts          # Redis/ioredis connection config
│   └── db/
│       └── schema.ts              # Add orders, order_items, claims tables
└── worker.ts                      # Standalone worker entry point
docker-compose.yml                 # Redis for local dev
```

### Pattern 1: BullMQ Worker as Separate Process

**What:** Run BullMQ workers in a standalone Node.js process, not inside Next.js API routes.
**Why:** Next.js serverless functions have execution time limits (10-60s on Vercel). Marketplace polling can take minutes. Workers must be long-running.

**Recommendation (Claude's discretion):** Use a standalone `worker.ts` file at project root. Run with `npx tsx worker.ts` during development. In production, run as a separate Docker container or Railway/Fly.io service.

```typescript
// worker.ts - standalone entry point
import { Worker } from 'bullmq'
import { connection } from './src/lib/jobs/connection'
import { processOrderCollection } from './src/lib/jobs/workers/order-collector'

const worker = new Worker('order-collection', processOrderCollection, {
  connection,
  concurrency: 2, // Process 2 marketplace collections in parallel
  limiter: { max: 1, duration: 1000 }, // Global: max 1 job/sec
})

worker.on('completed', (job) => {
  console.log(`Completed: ${job.id} for ${job.data.marketplaceId}`)
})

worker.on('failed', (job, err) => {
  console.error(`Failed: ${job?.id}`, err.message)
})

console.log('Order collection worker started')
```

### Pattern 2: Per-Marketplace Fan-Out

**What:** Schedule one repeatable job per marketplace, not one job that iterates all marketplaces.
**Why:** If Coupang API is down, it should not block Naver collection. Independent jobs = independent failures.

```typescript
// src/lib/jobs/queues.ts
import { Queue } from 'bullmq'
import { connection } from './connection'

export const orderCollectionQueue = new Queue('order-collection', { connection })

// Schedule collection for each marketplace independently
export async function scheduleOrderCollection(marketplaceId: string) {
  await orderCollectionQueue.add(
    `collect-${marketplaceId}`,
    { marketplaceId },
    {
      repeat: { every: 5 * 60 * 1000 }, // every 5 minutes
      jobId: `collect-${marketplaceId}`, // prevents duplicate scheduling
    }
  )
}
```

### Pattern 3: HMAC-SHA256 Signing for Coupang

**What:** Coupang requires per-request HMAC-SHA256 signatures that include the HTTP method, path, query string, and datetime.
**Why:** Signatures expire in 5 minutes and are request-specific. Cannot reuse.

```typescript
// src/lib/marketplace/adapters/coupang/client.ts
import { createHmac } from 'node:crypto'

function generateCoupangAuth(
  method: string,
  path: string,
  query: string,
  accessKey: string,
  secretKey: string
): string {
  const datetime = formatCoupangDatetime(new Date()) // yyMMddTHHmmssZ format
  const message = [datetime, method, path, query].join('\n')
  const signature = createHmac('sha256', secretKey)
    .update(message)
    .digest('hex')
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`
}
```

### Pattern 4: Server-Side Paginated Table with nuqs

**Recommendation (Claude's discretion):** Use server-side pagination. With 500-2000 orders/day, data accumulates to 10K+ rows within a week. Client-side pagination would require loading all data upfront.

```typescript
// src/app/(auth)/orders/page.tsx (Server Component)
import { parseAsString, parseAsInteger, createSearchParamsCache } from 'nuqs/server'

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(50),
  status: parseAsString,
  marketplace: parseAsString,
  search: parseAsString,
  dateFrom: parseAsString,
  dateTo: parseAsString,
  sort: parseAsString.withDefault('ordered_at'),
  order: parseAsString.withDefault('desc'),
})

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParamsCache.parse(searchParams)
  const { orders, total } = await getOrders(params)

  return <OrderDataTable data={orders} total={total} />
}
```

### Pattern 5: Coupang Order Collection API

**Endpoint:** `GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets`
**Parameters:** `createdAtFrom`, `createdAtTo`, `status`, `maxPerPage`
**Status values:** `ACCEPT` (결제완료), `INSTRUCT` (상품준비중), `DEPARTURE` (배송지시), `DELIVERING` (배송중), `FINAL_DELIVERY` (배송완료)

**Claims endpoint:** `GET /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/returnRequests`
**Parameters:** `searchType=timeFrame`, `createdAtFrom`, `createdAtTo`, `status`

### Pattern 6: Naver Order Collection API

**Endpoint:** `GET /v1/pay-order/seller/product-orders/last-changed-statuses`
**Parameters:** `lastChangedFrom`, `lastChangedTo`, `lastChangedType`
**Flow:** Get changed product order IDs -> batch fetch full details via product order detail API.

**Note:** Naver provides a newer "조건형 상품 주문 상세 내역 조회" API (announced Aug 2024) that allows querying by payment datetime, claim datetime with multiple status values. Check `apicenter.commerce.naver.com` for latest docs.

### Anti-Patterns to Avoid
- **Direct marketplace calls from UI actions:** Always enqueue to BullMQ, never call marketplace APIs from Server Actions. Marketplace APIs are slow (1-5s) and unreliable.
- **Single job for all marketplaces:** Fan out to one job per marketplace. Independent failure isolation.
- **Client-side pagination for order table:** Server-side only. Data grows too fast for client-side.
- **Hardcoded status mappings:** Each adapter owns its status map. Use a typed mapping object, not if/else chains.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job scheduling | Custom setTimeout/setInterval loops | BullMQ repeatable jobs | Persistence, retry, rate limiting, monitoring |
| Rate limiting | Custom token bucket per adapter | BullMQ worker `limiter` + p-limit for API calls | BullMQ's limiter is global across workers, p-limit controls in-worker concurrency |
| HMAC signing | Third-party HMAC library | Node.js built-in `crypto.createHmac` | Zero dependencies, standard Node.js API |
| Table state management | Custom React state for filters/pagination | nuqs `createSearchParamsCache` | URL sync, SSR-compatible, bookmark-friendly |
| Data table rendering | Custom table with sort/filter/select | TanStack Table v8 `useReactTable` | Headless, composable, battle-tested |
| Date formatting for Korean APIs | Manual string formatting | date-fns `format()` with KST timezone | Handles timezone conversion, locale formatting |
| Redis connection management | Raw ioredis in each file | Shared connection module | Single connection reused across queues and workers |

## Common Pitfalls

### Pitfall 1: BullMQ Repeatable Job Duplication
**What goes wrong:** Adding the same repeatable job on every app startup creates duplicate schedules.
**Why it happens:** `queue.add()` with `repeat` creates a new schedule each time unless deduplicated.
**How to avoid:** Use `jobId` option to deduplicate. Same `jobId` = same schedule, not a new one. Or use `queue.getRepeatableJobs()` to check before adding.
**Warning signs:** Orders collected multiple times per interval, duplicate entries in database.

### Pitfall 2: Coupang HMAC Datetime Format
**What goes wrong:** HMAC signature rejected with 401/403 errors.
**Why it happens:** Coupang uses `yyMMddTHHmmssZ` format (2-digit year), not ISO 8601. Many developers use 4-digit year.
**How to avoid:** Use date-fns `format(date, 'yyMMdd\'T\'HHmmss\'Z\'')` or manual formatting. Test against Coupang's sandbox first.
**Warning signs:** All Coupang API calls returning 401 despite correct keys.

### Pitfall 3: Naver OAuth Token Expiry
**What goes wrong:** Token expires and collection silently fails, returning empty results or errors.
**Why it happens:** Naver tokens expire periodically. If refresh fails (e.g., IP whitelist changed), no orders are collected.
**How to avoid:** Store token expiry in DB. Refresh proactively 5 minutes before expiry. Monitor for auth failures separately from "0 orders" state.
**Warning signs:** Naver orders stop appearing while Coupang continues working.

### Pitfall 4: Missing Order Status Mapping
**What goes wrong:** Unknown marketplace status silently mapped to wrong internal status, or orders lost.
**Why it happens:** Coupang/Naver add new status values without notice. Unmapped statuses cause errors or silent data loss.
**How to avoid:** Default unmapped statuses to a safe fallback (e.g., `NEW`) and log a warning. Never throw on unknown status.
**Warning signs:** Orders stuck in wrong state, "Unknown status" warnings in logs.

### Pitfall 5: Server-Side Pagination Off-by-One
**What goes wrong:** Missing rows or duplicate rows when paginating through orders.
**Why it happens:** Using OFFSET/LIMIT with concurrent inserts. New orders shift page boundaries.
**How to avoid:** Use cursor-based pagination (`WHERE ordered_at < :cursor ORDER BY ordered_at DESC LIMIT :pageSize`) for time-sorted data. Or accept OFFSET pagination for dashboard use (acceptable for admin-only tool).
**Warning signs:** Same order appearing on two pages, or orders missing from any page.

### Pitfall 6: Redis Not Available in Development
**What goes wrong:** BullMQ fails to connect, entire worker crashes.
**Why it happens:** No Redis installed locally, no Docker available.
**How to avoid:** Use Docker Compose for local Redis. Provide clear error message when Redis unavailable. Consider Upstash Redis for development if Docker is not an option.
**Warning signs:** `ECONNREFUSED` errors on startup.

## Code Examples

### Drizzle Schema: Orders Table
```typescript
// src/lib/db/schema.ts (additions)
import { pgTable, uuid, text, timestamp, pgEnum, varchar, jsonb, boolean, integer, numeric, uniqueIndex, index } from 'drizzle-orm/pg-core'

export const orderStatusEnum = pgEnum('order_status', [
  'new',        // 신규
  'confirmed',  // 확인
  'preparing',  // 출고대기
  'shipped',    // 출고완료
  'delivering', // 배송중
  'delivered',  // 배송완료
  'cancelled',  // 취소
])

export const claimTypeEnum = pgEnum('claim_type', [
  'cancel',    // 취소
  'return',    // 반품
  'exchange',  // 교환
])

export const claimStatusEnum = pgEnum('claim_status', [
  'requested',  // 요청
  'processing', // 처리중
  'completed',  // 완료
  'rejected',   // 거부
])

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  connectionId: uuid('connection_id').notNull().references(() => marketplaceConnections.id),
  marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
  marketplaceOrderId: varchar('marketplace_order_id', { length: 200 }).notNull(),
  status: orderStatusEnum('status').notNull().default('new'),
  previousStatus: orderStatusEnum('previous_status'),
  buyerName: text('buyer_name'),
  buyerPhone: text('buyer_phone'),
  recipientName: text('recipient_name'),
  recipientPhone: text('recipient_phone'),
  shippingAddress: jsonb('shipping_address').$type<{
    zipCode: string
    address1: string
    address2?: string
  }>(),
  orderedAt: timestamp('ordered_at', { withTimezone: true }).notNull(),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
  isHeld: boolean('is_held').notNull().default(false),
  holdReason: text('hold_reason'),
  heldAt: timestamp('held_at', { withTimezone: true }),
  rawData: jsonb('raw_data').$type<Record<string, unknown>>(),
  marketplaceStatus: varchar('marketplace_status', { length: 100 }),
  collectedAt: timestamp('collected_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('orders_marketplace_unique').on(table.marketplaceId, table.marketplaceOrderId),
  index('orders_user_status_idx').on(table.userId, table.status),
  index('orders_ordered_at_idx').on(table.orderedAt),
])

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  marketplaceItemId: varchar('marketplace_item_id', { length: 200 }),
  productName: text('product_name').notNull(),
  optionText: text('option_text'),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
  sku: varchar('sku', { length: 100 }),
})

export const claims = pgTable('claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  userId: uuid('user_id').notNull(),
  marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
  marketplaceClaimId: varchar('marketplace_claim_id', { length: 200 }),
  claimType: claimTypeEnum('claim_type').notNull(),
  claimStatus: claimStatusEnum('claim_status').notNull().default('requested'),
  reason: text('reason'),
  rawData: jsonb('raw_data').$type<Record<string, unknown>>(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('claims_marketplace_unique').on(table.marketplaceId, table.marketplaceClaimId),
  index('claims_order_idx').on(table.orderId),
])

export const jobLogs = pgTable('job_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobType: varchar('job_type', { length: 50 }).notNull(),
  marketplaceId: varchar('marketplace_id', { length: 50 }),
  connectionId: uuid('connection_id'),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  ordersCollected: integer('orders_collected'),
  claimsCollected: integer('claims_collected'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
```

### BullMQ Order Collection Worker
```typescript
// src/lib/jobs/workers/order-collector.ts
import type { Job } from 'bullmq'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { readCredential } from '@/lib/supabase/admin'

interface OrderCollectionJobData {
  marketplaceId: string
  connectionId: string
  userId: string
}

export async function processOrderCollection(job: Job<OrderCollectionJobData>) {
  const { marketplaceId, connectionId, userId } = job.data
  const adapter = marketplaceRegistry.get(marketplaceId)

  // Retrieve credentials from Vault
  const credentials: Record<string, string> = {}
  for (const key of adapter.config.requiredCredentials) {
    const value = await readCredential(marketplaceId, userId, key)
    if (!value) throw new Error(`Missing credential: ${key}`)
    credentials[key] = value
  }

  // Fetch orders since last collection
  const since = new Date(Date.now() - 15 * 60 * 1000) // last 15 minutes
  const normalizedOrders = await adapter.getOrders(since)

  // UPSERT into database (deduplication)
  for (const order of normalizedOrders) {
    await db.insert(orders).values({
      userId,
      connectionId,
      marketplaceId,
      marketplaceOrderId: order.marketplaceOrderId,
      status: order.status,
      buyerName: order.buyerName,
      // ... other fields
      rawData: order.rawData,
      orderedAt: order.orderedAt,
    }).onConflictDoUpdate({
      target: [orders.marketplaceId, orders.marketplaceOrderId],
      set: {
        status: order.status,
        marketplaceStatus: order.marketplaceStatus,
        rawData: order.rawData,
        updatedAt: new Date(),
      },
    })
  }

  return { collected: normalizedOrders.length }
}
```

### NormalizedOrder Full Interface
```typescript
// src/lib/marketplace/types.ts (Phase 2 expansion)
export interface NormalizedOrder {
  marketplaceOrderId: string
  marketplaceId: MarketplaceId
  marketplaceStatus: string  // Raw status from marketplace
  status: OrderStatus        // Mapped internal status
  buyerName: string
  buyerPhone?: string
  recipientName: string
  recipientPhone?: string
  shippingAddress: {
    zipCode: string
    address1: string
    address2?: string
  }
  items: NormalizedOrderItem[]
  orderedAt: Date
  totalAmount: number
  rawData: Record<string, unknown>
}

export interface NormalizedOrderItem {
  marketplaceItemId: string
  productName: string
  optionText?: string
  quantity: number
  unitPrice: number
  sku?: string
}

export interface NormalizedClaim {
  marketplaceClaimId: string
  marketplaceId: MarketplaceId
  marketplaceOrderId: string
  claimType: 'cancel' | 'return' | 'exchange'
  claimStatus: 'requested' | 'processing' | 'completed' | 'rejected'
  reason?: string
  requestedAt: Date
  rawData: Record<string, unknown>
}
```

### Coupang Status Mapping
```typescript
// src/lib/marketplace/adapters/coupang/status-map.ts
import type { OrderStatus } from '@/lib/orders/types'

const COUPANG_STATUS_MAP: Record<string, OrderStatus> = {
  'ACCEPT': 'new',           // 결제완료 -> 신규
  'INSTRUCT': 'preparing',   // 상품준비중 -> 출고대기
  'DEPARTURE': 'shipped',    // 배송지시 -> 출고완료
  'DELIVERING': 'delivering', // 배송중
  'FINAL_DELIVERY': 'delivered', // 배송완료
}

export function mapCoupangStatus(coupangStatus: string): OrderStatus {
  const mapped = COUPANG_STATUS_MAP[coupangStatus]
  if (!mapped) {
    console.warn(`Unknown Coupang status: ${coupangStatus}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BullMQ `QueueScheduler` required | No longer needed (BullMQ 2.0+) | 2023 | Simpler setup, one less component to manage |
| BullMQ `groupKey` rate limiting (OSS) | Removed in BullMQ 3.0+ (Pro only) | 2023 | Use separate queues per marketplace for independent rate limits, or p-limit in worker |
| Naver Commerce API v1 | Naver "조건형" API (Aug 2024) | 2024 | New API allows flexible query by payment/claim datetime with multiple status filters |
| TanStack Table v7 | v8 stable, v9 alpha | 2022 | v8 is production standard. v9 NOT ready for production. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | Yes | v24.14.1 | -- |
| Redis | BullMQ backing store | No | -- | Use Upstash Redis (free tier) or Docker |
| Docker | Local Redis container | No | -- | Use Upstash Redis for development |
| Coupang API sandbox | Adapter testing | Unknown | -- | Use MSW mocks during development |
| Naver API sandbox | Adapter testing | Unknown | -- | Use MSW mocks during development |

**Missing dependencies with no fallback:**
- Redis is required for BullMQ -- must use either Upstash Redis (cloud, free tier available) or install Docker/Redis locally.

**Missing dependencies with fallback:**
- Docker not available -- use Upstash Redis (free tier: 10K commands/day) for development instead of local Redis container.
- Marketplace API sandboxes -- use MSW (Mock Service Worker) to mock API responses during development and testing. Verify against real APIs only when ready.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORD-01 | Order collection from Coupang/Naver on schedule | integration | `npx vitest run tests/jobs/order-collector.test.ts -x` | Wave 0 |
| ORD-02 | Unified order listing query | unit | `npx vitest run tests/orders/queries.test.ts -x` | Wave 0 |
| ORD-03 | Filter/search orders | unit | `npx vitest run tests/orders/queries.test.ts -x` | Wave 0 |
| ORD-04 | Status transitions | unit | `npx vitest run tests/orders/status.test.ts -x` | Wave 0 |
| ORD-05 | Claims collection | integration | `npx vitest run tests/jobs/claims-collector.test.ts -x` | Wave 0 |
| ORD-06 | Hold order with reason | unit | `npx vitest run tests/orders/hold-release.test.ts -x` | Wave 0 |
| ORD-07 | Release held order | unit | `npx vitest run tests/orders/hold-release.test.ts -x` | Wave 0 |
| MKT-01 | Coupang adapter getOrders | unit | `npx vitest run tests/marketplace/coupang.test.ts -x` | Wave 0 |
| MKT-02 | Naver adapter getOrders | unit | `npx vitest run tests/marketplace/naver.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/marketplace/coupang.test.ts` -- Coupang HMAC signing + order normalization (MKT-01)
- [ ] `tests/marketplace/naver.test.ts` -- Naver OAuth + order normalization (MKT-02)
- [ ] `tests/orders/queries.test.ts` -- Order listing, filtering, pagination (ORD-02, ORD-03)
- [ ] `tests/orders/status.test.ts` -- Status transition validation (ORD-04)
- [ ] `tests/orders/hold-release.test.ts` -- Hold/release logic (ORD-06, ORD-07)
- [ ] `tests/jobs/order-collector.test.ts` -- BullMQ job processing with mocked adapters (ORD-01)
- [ ] `tests/jobs/claims-collector.test.ts` -- Claims collection (ORD-05)
- [ ] `tests/helpers/msw-handlers.ts` -- MSW handlers for Coupang/Naver API mocks

## Open Questions

1. **Coupang API sandbox availability**
   - What we know: Coupang has a test guide and sandbox environment
   - What's unclear: Whether our account has sandbox access, and what test data is available
   - Recommendation: Start with MSW mocks based on documented response shapes, validate against sandbox when access confirmed

2. **Naver Commerce API version**
   - What we know: Both v1 lastChangedStatuses API and newer "조건형" API exist
   - What's unclear: Whether the v1 API is deprecated or still recommended for order collection
   - Recommendation: Start with v1 lastChangedStatuses (well-documented in GitHub discussions), migrate to newer API if needed

3. **Redis hosting for production**
   - What we know: Need Redis for BullMQ. Upstash (serverless) or Railway/Fly.io (dedicated) are options
   - What's unclear: Cost and latency tradeoff for daily 500-2000 order volume
   - Recommendation: Start with Upstash free tier. Upgrade if rate limiting or latency becomes an issue.

4. **BullMQ groupKey rate limiting (removed in OSS)**
   - What we know: Per-group rate limiting was removed in BullMQ 3.0+ OSS. Only available in BullMQ Pro.
   - What's unclear: Whether separate queues per marketplace or p-limit in worker is the better pattern
   - Recommendation: Use p-limit inside each adapter's API call methods for per-marketplace rate limiting. BullMQ worker limiter handles global job throughput. This avoids needing BullMQ Pro.

## Project Constraints (from CLAUDE.md)

- **Tech stack locked:** Next.js 16 + Supabase + TypeScript + Tailwind CSS v4
- **BullMQ, not pgmq:** Use BullMQ ^5.72 for job queues, NOT Supabase pgmq
- **Drizzle ORM, not Prisma:** Use Drizzle for complex queries
- **ky, not axios:** Use ky ^1.7 for HTTP client
- **TanStack Table v8, not v9:** v9 is alpha, do NOT use
- **ExcelJS, not SheetJS:** (relevant for Phase 3, not this phase)
- **Zod v4:** Import from `zod` directly (v4.3.6 installed)
- **date-fns, not moment:** Use date-fns for date manipulation
- **No Bull (old):** Use BullMQ only
- **No node-cron:** Use BullMQ repeatable jobs
- **No direct marketplace calls from API routes:** Enqueue to BullMQ for all marketplace API polling
- **Read Next.js docs:** Check `node_modules/next/dist/docs/` before writing Next.js code
- **shadcn/ui for UI components:** Already initialized
- **Sonner for toasts:** Already installed

## Sources

### Primary (HIGH confidence)
- [Coupang PO List Query (paging by day)](https://developers.coupangcorp.com/hc/en-us/articles/360033919573-PO-list-query-paging-by-day) -- Order collection endpoint
- [Coupang Return/Cancellation Request List Query](https://developers.coupangcorp.com/hc/en-us/articles/360033919613-Return-Cancellation-Request-List-Query) -- Claims endpoint
- [Coupang Delivery Status Change History](https://developers.coupangcorp.com/hc/en-us/articles/360033792934-Searching-Delivery-Status-Change-History) -- Status values
- [Naver Commerce API GitHub](https://github.com/commerce-api-naver/commerce-api) -- API support and discussions
- [Naver Commerce API - New Order Collection API](https://github.com/commerce-api-naver/commerce-api/discussions/1877) -- New "조건형" API announcement
- [BullMQ Rate Limiting Docs](https://docs.bullmq.io/guide/rate-limiting) -- Rate limiter configuration
- [BullMQ Repeatable Jobs Docs](https://docs.bullmq.io/guide/jobs/repeatable) -- Scheduled job patterns
- [TanStack Table Pagination Guide](https://tanstack.com/table/v8/docs/guide/pagination) -- Server-side pagination setup

### Secondary (MEDIUM confidence)
- [Naver Commerce API Rate Limiting Discussion](https://github.com/commerce-api-naver/commerce-api/discussions/6) -- Rate limit details
- [Naver Commerce API Order Collection Discussion](https://github.com/commerce-api-naver/commerce-api/discussions/1875) -- Order collection patterns
- [BullMQ Getting Started Tutorial 2025](https://www.dragonflydb.io/guides/bullmq) -- Worker patterns and setup
- [Drizzle ORM PostgreSQL Column Types](https://orm.drizzle.team/docs/column-types/pg) -- Schema definition reference

### Tertiary (LOW confidence)
- Coupang API response field names -- extracted from search snippets, 403'd on direct doc fetch. Verify against actual API responses.
- Naver new "조건형" API endpoint details -- not published in GitHub discussion, only in external docs at apicenter.commerce.naver.com

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages verified against npm registry with current versions
- Architecture: HIGH -- BullMQ separate worker + TanStack Table server-side is well-established pattern
- Marketplace APIs: MEDIUM -- Coupang endpoint paths and status values confirmed from search snippets but could not access full docs (403). Naver patterns confirmed from GitHub discussions.
- Pitfalls: HIGH -- based on documented patterns from project PITFALLS.md research + BullMQ official docs

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable domain, 30 days)
