# Architecture Research

**Domain:** E-commerce Marketplace Integration Platform (OMS/Channel Manager)
**Researched:** 2026-04-03
**Confidence:** MEDIUM-HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Presentation Layer (Next.js)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Dashboard │  │  Orders  │  │ Products │  │ Settings │            │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘            │
│        └──────────────┴─────────────┴─────────────┘                 │
├─────────────────────────────────────────────────────────────────────┤
│                     Application Layer (API Routes)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Order Service │  │Product Service│  │Shipping Svc  │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         └─────────────────┼─────────────────┘                       │
├───────────────────────────┼─────────────────────────────────────────┤
│                  Marketplace Adapter Layer                            │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ Coupang│ │ Naver  │ │ 11st   │ │ Gmarket│ │  ...   │           │
│  │Adapter │ │Adapter │ │Adapter │ │Adapter │ │(~30)   │           │
│  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘           │
│      └──────────┴──────────┴──────────┴──────────┘                  │
├─────────────────────────────────────────────────────────────────────┤
│                     Job Processing Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │  pg_cron     │  │  pgmq       │  │ Edge Functions│               │
│  │ (Scheduler)  │→ │ (Queue)     │→ │ (Workers)     │               │
│  └─────────────┘  └─────────────┘  └──────────────┘               │
├─────────────────────────────────────────────────────────────────────┤
│                     Data Layer (Supabase/Postgres)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  Orders  │  │ Products │  │Marketplace│  │  Jobs/   │           │
│  │          │  │  & SKUs  │  │  Configs  │  │  Queues  │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Dashboard UI | Unified order/product view, status monitoring | Next.js App Router, Server Components, Tailwind |
| Order Service | CRUD for orders, status transitions, batch operations | Next.js API routes + Supabase queries |
| Product Service | Product/SKU management, marketplace listing sync | Next.js API routes + Supabase queries |
| Shipping Service | Invoice/tracking upload, carrier integration | Next.js API routes calling marketplace adapters |
| Marketplace Adapter Layer | Normalize 30 different APIs into one interface | TypeScript adapter classes per marketplace |
| Job Scheduler | Trigger recurring order collection, sync tasks | pg_cron (Supabase built-in) |
| Message Queue | Decouple API calls, handle retries, rate limiting | pgmq (Supabase Queues) |
| Edge Function Workers | Execute queued jobs (API calls, batch processing) | Supabase Edge Functions (Deno) |
| Excel Pipeline | Import/export orders, invoices, products via Excel | Server-side XLSX parsing + bulk DB operations |

## Recommended Project Structure

```
src/
├── app/                        # Next.js App Router pages
│   ├── (auth)/                 # Auth-gated layout group
│   │   ├── dashboard/          # Main dashboard
│   │   ├── orders/             # Order management pages
│   │   ├── products/           # Product management pages
│   │   ├── shipping/           # Shipping/invoice pages
│   │   └── settings/           # Marketplace configs, user settings
│   ├── api/                    # API routes
│   │   ├── orders/             # Order CRUD endpoints
│   │   ├── products/           # Product endpoints
│   │   ├── shipping/           # Invoice upload endpoints
│   │   ├── marketplace/        # Marketplace connection management
│   │   ├── jobs/               # Job trigger/status endpoints
│   │   └── excel/              # Excel import/export endpoints
│   └── (public)/               # Login, signup
├── lib/                        # Shared business logic
│   ├── marketplace/            # Marketplace adapter layer
│   │   ├── types.ts            # Unified marketplace interface
│   │   ├── registry.ts         # Adapter registry/factory
│   │   ├── adapters/           # Per-marketplace implementations
│   │   │   ├── coupang.ts
│   │   │   ├── naver.ts
│   │   │   ├── elevenst.ts
│   │   │   └── ...
│   │   └── rate-limiter.ts     # Per-marketplace rate limiting
│   ├── orders/                 # Order domain logic
│   │   ├── types.ts
│   │   ├── pipeline.ts         # Order processing state machine
│   │   └── queries.ts          # Supabase query helpers
│   ├── products/               # Product domain logic
│   ├── shipping/               # Shipping/invoice logic
│   ├── excel/                  # Excel parsing/generation
│   │   ├── parser.ts           # XLSX import logic
│   │   └── exporter.ts         # XLSX export logic
│   ├── jobs/                   # Job definitions and queue helpers
│   └── supabase/               # Supabase client, auth helpers
├── components/                 # Reusable UI components
│   ├── ui/                     # Primitives (buttons, inputs, tables)
│   ├── orders/                 # Order-specific components
│   ├── products/               # Product-specific components
│   └── layout/                 # Shell, sidebar, nav
└── hooks/                      # Client-side React hooks
supabase/
├── migrations/                 # Database migrations
├── functions/                  # Edge Functions (Deno workers)
│   ├── order-collector/        # Polls marketplaces for new orders
│   ├── invoice-uploader/       # Uploads tracking numbers to marketplaces
│   ├── inventory-syncer/       # Syncs stock levels across marketplaces
│   └── _shared/                # Shared utilities for Edge Functions
└── seed.sql                    # Test/dev data
```

### Structure Rationale

- **`lib/marketplace/`:** The adapter layer is the core differentiator. Isolating it enables independent development/testing of each marketplace connector without touching business logic.
- **`lib/marketplace/adapters/`:** One file per marketplace. Each implements the same interface. New marketplaces are added by creating a new adapter file and registering it.
- **`supabase/functions/`:** Edge Functions run as workers outside the Next.js process. They handle long-running API polling that would exceed HTTP request timeouts.
- **`lib/excel/`:** Separated because Excel import/export is a critical path (many sellers rely on Excel workflows) and has distinct parsing/validation concerns.

## Architectural Patterns

### Pattern 1: Marketplace Adapter (Strategy Pattern)

**What:** Every marketplace implements a common interface. Business logic calls the interface, never the marketplace directly. An adapter registry maps marketplace IDs to their implementations.
**When to use:** Always. This is the foundational pattern for this entire system.
**Trade-offs:** Slight over-engineering for the first 2-3 marketplaces, but pays off massively at 5+ marketplaces. Without it, marketplace-specific logic leaks everywhere.

**Example:**
```typescript
// lib/marketplace/types.ts
interface MarketplaceAdapter {
  readonly id: string;
  readonly name: string;
  readonly rateLimitPerSecond: number;

  // Order operations
  fetchOrders(since: Date): Promise<NormalizedOrder[]>;
  uploadInvoice(orderId: string, invoice: InvoiceData): Promise<void>;

  // Product operations
  fetchProducts(): Promise<NormalizedProduct[]>;
  updateInventory(sku: string, quantity: number): Promise<void>;

  // Connection
  testConnection(): Promise<boolean>;
}

// lib/marketplace/adapters/coupang.ts
class CoupangAdapter implements MarketplaceAdapter {
  readonly id = 'coupang';
  readonly name = '쿠팡';
  readonly rateLimitPerSecond = 10; // Coupang enforces 10 req/s per seller

  async fetchOrders(since: Date): Promise<NormalizedOrder[]> {
    const raw = await this.callApi('/orders', { since });
    return raw.map(this.normalizeOrder);
  }

  private normalizeOrder(raw: CoupangOrder): NormalizedOrder {
    return {
      marketplaceOrderId: raw.orderId,
      marketplace: 'coupang',
      buyerName: raw.receiver.name,
      items: raw.orderItems.map(i => ({
        sku: i.vendorItemId,
        name: i.vendorItemName,
        quantity: i.shippingCount,
        price: i.unitPrice,
      })),
      status: this.mapStatus(raw.status),
      orderedAt: new Date(raw.orderedAt),
    };
  }
}

// lib/marketplace/registry.ts
const adapters = new Map<string, MarketplaceAdapter>();

export function registerAdapter(adapter: MarketplaceAdapter) {
  adapters.set(adapter.id, adapter);
}

export function getAdapter(marketplaceId: string): MarketplaceAdapter {
  const adapter = adapters.get(marketplaceId);
  if (!adapter) throw new Error(`Unknown marketplace: ${marketplaceId}`);
  return adapter;
}
```

### Pattern 2: Queue-Based Job Processing (pg_cron + pgmq + Edge Functions)

**What:** Background operations (order collection, invoice uploads) are scheduled by pg_cron, enqueued via pgmq, and processed by Edge Function workers. This decouples scheduling from execution and provides built-in retry semantics.
**When to use:** For all marketplace API calls that happen outside of direct user interaction.
**Trade-offs:** More moving parts than simple cron-to-function. But pgmq gives you visibility timeout, retry, and dead-letter semantics that are essential when dealing with flaky marketplace APIs.

**Example:**
```sql
-- Schedule order collection every 5 minutes via pg_cron
SELECT cron.schedule(
  'collect-orders',
  '*/5 * * * *',
  $$
  SELECT pgmq.send(
    'order-collection',
    jsonb_build_object(
      'task', 'collect_orders',
      'marketplace_ids', (
        SELECT jsonb_agg(id) FROM marketplace_connections
        WHERE enabled = true AND user_id IS NOT NULL
      )
    )
  )
  $$
);
```

```typescript
// supabase/functions/order-collector/index.ts
// Edge Function: reads from pgmq queue, processes order collection
Deno.serve(async () => {
  const messages = await supabase.rpc('pgmq_read', {
    queue_name: 'order-collection',
    qty: 5,
    visibility_timeout: 120,
  });

  for (const msg of messages) {
    const { marketplace_ids } = msg.message;
    for (const id of marketplace_ids) {
      const adapter = getAdapter(id);
      const orders = await adapter.fetchOrders(lastCollectedAt(id));
      await upsertOrders(orders);
    }
    await supabase.rpc('pgmq_delete', {
      queue_name: 'order-collection',
      msg_id: msg.msg_id,
    });
  }

  return new Response('OK');
});
```

### Pattern 3: Canonical Data Model (Normalize-on-Ingest)

**What:** Every marketplace returns different order/product schemas. Normalize to a canonical internal schema at the adapter boundary. All business logic works with the canonical model only.
**When to use:** Always. Never store raw marketplace data as the primary record.
**Trade-offs:** Lossy -- some marketplace-specific fields may be dropped. Mitigate by storing raw JSON alongside the normalized record for debugging/auditing.

**Example:**
```typescript
// Canonical order -- what the rest of the system works with
interface NormalizedOrder {
  marketplaceOrderId: string;
  marketplace: string;
  buyerName: string;
  buyerPhone: string;
  shippingAddress: Address;
  items: NormalizedOrderItem[];
  status: OrderStatus; // PENDING | CONFIRMED | SHIPPING | DELIVERED | CANCELLED
  orderedAt: Date;
  rawData?: Record<string, unknown>; // Original API response for debugging
}
```

### Pattern 4: Rate Limiter per Marketplace

**What:** Each marketplace has different rate limits (Coupang: 10/s per seller, Naver: token bucket). The adapter layer wraps API calls with a per-marketplace rate limiter that respects these limits and handles 429 responses.
**When to use:** Every external API call must go through the rate limiter. No exceptions.
**Trade-offs:** Adds latency via deliberate delays. But without it, you get blocked by marketplaces -- which is catastrophic for an integration platform.

**Example:**
```typescript
class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number, // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens <= 0) {
      const waitMs = (1 / this.refillRate) * 1000;
      await new Promise(r => setTimeout(r, waitMs));
      this.refill();
    }
    this.tokens--;
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// Usage in adapter
class CoupangAdapter implements MarketplaceAdapter {
  private limiter = new TokenBucketRateLimiter(10, 10); // 10 req/s

  private async callApi(path: string, params: any) {
    await this.limiter.acquire();
    // actual HTTP call
  }
}
```

## Data Flow

### Order Collection Flow (Primary Path)

```
pg_cron (every 5min)
    ↓ enqueue
pgmq 'order-collection' queue
    ↓ dequeue
Edge Function (order-collector)
    ↓ for each enabled marketplace
MarketplaceAdapter.fetchOrders()
    ↓ rate-limited API calls
Marketplace API (Coupang, Naver, etc.)
    ↓ raw response
Adapter.normalizeOrder()
    ↓ canonical NormalizedOrder
UPSERT into orders table (deduplicated by marketplace_order_id)
    ↓ Supabase Realtime
Dashboard auto-refreshes with new orders
```

### Invoice Upload Flow

```
User selects orders in Dashboard
    ↓ bulk action: "Upload Invoices"
API Route: POST /api/shipping/upload-invoices
    ↓ for each order
pgmq.send('invoice-upload', { orderId, trackingNumber, marketplace })
    ↓ (returns immediately to user)
Edge Function (invoice-uploader)
    ↓ dequeue, rate-limited
MarketplaceAdapter.uploadInvoice()
    ↓
Marketplace API
    ↓ success/failure
Update order.invoice_status in DB
    ↓ Supabase Realtime
Dashboard shows upload status (success / failed / retrying)
```

### Excel Import Flow

```
User uploads Excel file
    ↓
API Route: POST /api/excel/import
    ↓ parse XLSX (server-side)
Validate rows against expected schema
    ↓ validation errors returned immediately
Bulk UPSERT parsed records into DB
    ↓
If invoice data: enqueue invoice uploads to pgmq
    ↓
Return import summary (N imported, M errors)
```

### Key Data Flows

1. **Order lifecycle:** Marketplace API -> collect -> normalize -> store -> display -> ship -> upload invoice -> marketplace API. Full round-trip.
2. **Inventory sync:** DB stock change -> enqueue sync job -> per-marketplace adapter.updateInventory() -> marketplace API. Triggered by stock change events.
3. **Product listing:** User creates product -> enqueue listing jobs -> per-marketplace adapter.createListing() -> marketplace API. One product, many marketplace listings.

## Database Schema (Conceptual)

```
marketplace_connections
├── id (PK)
├── user_id (FK → auth.users)
├── marketplace_id (e.g., 'coupang', 'naver')
├── credentials (encrypted JSON: API key, secret, seller ID)
├── enabled (boolean)
├── last_synced_at (timestamp)
└── rate_limit_config (JSON)

orders
├── id (PK, UUID)
├── user_id (FK → auth.users)
├── marketplace_id (FK → marketplace_connections)
├── marketplace_order_id (unique per marketplace)
├── status (enum: pending/confirmed/shipping/delivered/cancelled)
├── buyer_name, buyer_phone, shipping_address (JSON)
├── ordered_at (timestamp)
├── invoice_number (nullable)
├── invoice_status (enum: none/uploading/uploaded/failed)
├── raw_data (JSONB -- original API response)
├── created_at, updated_at
└── UNIQUE(marketplace_id, marketplace_order_id)

order_items
├── id (PK)
├── order_id (FK → orders)
├── sku (text)
├── product_name (text)
├── quantity (int)
├── unit_price (numeric)
├── option_text (text -- size/color etc.)
└── marketplace_item_id (text)

products
├── id (PK, UUID)
├── user_id (FK → auth.users)
├── internal_sku (unique per user)
├── name (text)
├── stock_quantity (int)
├── price (numeric)
├── status (enum: active/inactive)
└── created_at, updated_at

product_marketplace_listings
├── id (PK)
├── product_id (FK → products)
├── marketplace_id (FK → marketplace_connections)
├── marketplace_product_id (text)
├── marketplace_sku (text)
├── listing_status (enum: listed/delisted/pending)
└── last_synced_at

job_logs
├── id (PK)
├── job_type (text: order_collection/invoice_upload/inventory_sync)
├── marketplace_id (FK)
├── status (enum: queued/processing/completed/failed)
├── payload (JSONB)
├── error_message (text, nullable)
├── started_at, completed_at
└── created_at
```

**Key schema decisions:**
- `orders.raw_data` JSONB column preserves the original marketplace response for debugging without polluting the normalized schema
- `UNIQUE(marketplace_id, marketplace_order_id)` prevents duplicate order imports (idempotent collection)
- `product_marketplace_listings` is the join table between internal products and their marketplace-specific listings (one product can be listed on many marketplaces with different IDs)
- `job_logs` provides observability into background processing without needing external monitoring

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 500 orders/day (current) | Monolith is fine. pg_cron every 5 min. Single Edge Function per job type. No need for complex infrastructure. |
| 2,000 orders/day (target) | Same architecture. Increase collection frequency to every 2-3 min. Monitor queue depth. May need to parallelize adapter calls within a single Edge Function invocation. |
| 10,000+ orders/day (future SaaS) | Separate workers per marketplace. Consider dedicated job server (Bull + Redis) instead of Edge Functions if hitting timeout limits. Partition orders table by month. Add read replicas for dashboard queries. |

### Scaling Priorities

1. **First bottleneck: Marketplace API rate limits.** At 2000 orders/day across 30 marketplaces, rate limits are not a problem. At SaaS scale (many sellers sharing the same API keys), rate limiting becomes critical. Solution: per-seller rate limiting and queue prioritization.
2. **Second bottleneck: Edge Function timeouts.** Supabase Edge Functions have a 150s timeout (free) / 400s (pro). If a single collection run touches 30 marketplaces, it may timeout. Solution: one queue message per marketplace (fan-out pattern) so each Edge Function invocation handles one marketplace.
3. **Third bottleneck: Dashboard query performance.** With millions of orders, full-table scans slow down. Solution: proper indexes on (user_id, status, ordered_at) and consider partitioning.

## Anti-Patterns

### Anti-Pattern 1: Direct Marketplace Calls from UI

**What people do:** Call marketplace APIs directly from API routes that serve the UI (e.g., "click button -> API route -> coupang API -> return to user").
**Why it's wrong:** Marketplace APIs are slow (1-5s) and unreliable. Users see loading spinners, timeouts, and errors. If 10 users click simultaneously, you hit rate limits.
**Do this instead:** Enqueue the work. Return immediately with "processing" status. Update via Realtime/polling when done.

### Anti-Pattern 2: One Giant Adapter File

**What people do:** Put all marketplace logic in a single file or module with switch statements: `if (marketplace === 'coupang') { ... } else if (marketplace === 'naver') { ... }`.
**Why it's wrong:** At 30 marketplaces, this becomes an unmaintainable 5000+ line file. Every change risks breaking other marketplaces.
**Do this instead:** One adapter file per marketplace, all implementing the same interface. Use a registry pattern for discovery.

### Anti-Pattern 3: Storing Only Normalized Data

**What people do:** Transform marketplace data into canonical format and discard the original.
**Why it's wrong:** When something goes wrong (and it will -- marketplace APIs return weird data), you have no way to debug without the original response. Also, some marketplace-specific fields may be needed later.
**Do this instead:** Store both the normalized record AND the raw JSON response. The raw data column costs a few extra MB but saves hours of debugging.

### Anti-Pattern 4: Synchronous Order Collection

**What people do:** Collect from all 30 marketplaces in a single synchronous loop.
**Why it's wrong:** If marketplace #15 is slow or down, marketplaces #16-30 wait. Total time = sum of all marketplace response times.
**Do this instead:** Fan out: enqueue one message per marketplace. Each processes independently. A slow marketplace only affects itself.

### Anti-Pattern 5: No Deduplication on Order Import

**What people do:** Insert orders without checking if they already exist.
**Why it's wrong:** Order collection runs every few minutes. The same order will be fetched multiple times before it ships. Without deduplication, you get duplicate rows.
**Do this instead:** UPSERT with `ON CONFLICT (marketplace_id, marketplace_order_id) DO UPDATE`. Make collection idempotent.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Coupang Open API | REST, HMAC auth, 10 req/s per seller | Most critical marketplace. Well-documented API. |
| Naver Commerce API | REST, OAuth + token bucket rate limit | Transitioning API versions -- check for deprecation notices. |
| 11st API | REST, API key auth | Rate limits undocumented; start conservative (5 req/s). |
| Cafe24 API | REST, OAuth | Has webhook support for order updates -- use it instead of polling when available. |
| Other marketplaces | Varies (REST/SOAP/scraping) | Some smaller marketplaces have no API; may need Excel-based integration or screen scraping (last resort). |
| Delivery carriers (CJ/Hanjin/etc.) | REST API for tracking | Needed for auto-tracking lookup, but secondary to core flow. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Next.js app <-> Supabase | Supabase JS client (direct DB + auth) | Use server-side client in API routes, client-side for Realtime |
| Next.js app <-> Edge Functions | Supabase `functions.invoke()` or pg_cron trigger | Edge Functions are fire-and-forget workers, not request-response |
| Edge Functions <-> Marketplace APIs | HTTP via adapter layer | Always rate-limited, always with retry |
| Dashboard <-> Background jobs | Supabase Realtime (postgres_changes) | Subscribe to order/job status changes for live UI updates |

## Suggested Build Order

Based on dependencies between components:

1. **Database schema + Supabase setup** -- Everything depends on the data model. Get this right first.
2. **Marketplace adapter interface + first adapter (Coupang)** -- Define the contract, prove it with the highest-volume marketplace.
3. **Order collection pipeline (pg_cron + pgmq + Edge Function)** -- The core value proposition. Needs schema + adapter.
4. **Order management dashboard** -- Needs orders in the database to display.
5. **Invoice upload flow** -- Needs orders + adapter. Second half of the core value loop.
6. **Excel import/export** -- Parallel to invoice upload. Independent concern but critical for daily operations.
7. **Second marketplace adapter (Naver)** -- Validates that the adapter pattern works across different APIs.
8. **Remaining marketplace adapters** -- Incremental, one at a time. Each is independent.
9. **Product management + inventory sync** -- Depends on adapter layer but not on order pipeline.
10. **Multi-user/SaaS features** -- Only after core flow is stable for self-use.

**Critical path:** Schema -> Adapter interface -> Coupang adapter -> Order collection -> Dashboard -> Invoice upload. This is the minimum path to replacing 사방넷.

## Sources

- [Adapter Design Pattern for Multiple Third-Party Integrations](https://medium.com/@olorondu_emeka/adapter-design-pattern-a-guide-to-manage-multiple-third-party-integrations-dc342f435daf)
- [Managing Multiple APIs Using an Adapter Pattern](https://dzone.com/articles/b2b-integrations)
- [Adapter Pattern in Microservice Architectures](https://medium.com/@jescrich_57703/harnessing-the-adapter-pattern-in-microservice-architectures-for-vendor-agnosticism-debc21d2fe21)
- [Supabase Queues Documentation](https://supabase.com/docs/guides/queues)
- [Consuming Queue Messages with Edge Functions](https://supabase.com/docs/guides/queues/consuming-messages-with-edge-functions)
- [Processing Large Jobs with Edge Functions, Cron, and Queues](https://supabase.com/blog/processing-large-jobs-with-edge-functions)
- [Supabase Cron Documentation](https://supabase.com/docs/guides/cron)
- [Build Queue Worker using Supabase Cron, Queue and Edge Function](https://dev.to/suciptoid/build-queue-worker-using-supabase-cron-queue-and-edge-function-19di)
- [Coupang Open API Rate Limit Policy](https://developers.coupangcorp.com/hc/en-us/articles/20414599556889-Introduction-of-Open-API-rate-limit-policy)
- [Naver Commerce API Rate Limiting Discussion](https://github.com/commerce-api-naver/commerce-api/discussions/6)
- [Korean E-commerce Integration Solutions Overview](https://blog.bati.ai/commerce-solution-kr/)
- [Korean Marketplace API Integration Guide](https://blog.bati.ai/commerce-api/)
- [E-Commerce Architecture Best Practices 2025](https://virtocommerce.com/blog/ecommerce-architecture)
- [E-commerce Database Design Schema Example](https://skemato.com/blog/ecommerce-database-design-example)

---
*Architecture research for: Korean E-commerce Marketplace Integration Platform*
*Researched: 2026-04-03*
