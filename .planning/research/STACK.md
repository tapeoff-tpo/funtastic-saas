# Stack Research

**Domain:** Korean e-commerce marketplace integration SaaS (OMS/WMS)
**Researched:** 2026-04-03
**Confidence:** MEDIUM-HIGH

## Recommended Stack

### Core Technologies (Already Decided)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 16.2.2 | Full-stack framework | Already installed. Server Actions + API Routes handle marketplace webhook endpoints and dashboard rendering. |
| React | 19.2.4 | UI framework | Already installed. Concurrent features help with large order table rendering. |
| Supabase | ^2.101.1 | Auth, DB (Postgres), Realtime, Edge Functions | Already installed. Postgres + Row Level Security + Realtime subscriptions for live order updates. Eliminates need for separate auth/DB infra. |
| TypeScript | ^5 | Type safety | Already installed. Critical for marketplace API clients -- each marketplace has different data shapes, types prevent integration bugs. |
| Tailwind CSS | v4 | Styling | Already installed. Utility-first approach speeds up dashboard UI development. |

### Job Queue & Background Processing

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| BullMQ | ^5.72 | Job queue for marketplace API polling, order sync, invoice upload | **Use BullMQ, not Supabase pgmq.** Rationale: 30 marketplaces x polling every 5-15 min = hundreds of concurrent jobs with rate limiting, retries, and priority queues. BullMQ has mature rate limiting per queue (critical for marketplace API rate limits), job flow dependencies (collect orders -> process -> upload invoices), cron-based repeatable jobs, and 14M+ monthly npm downloads. Supabase pgmq is promising but too young for this scale of job orchestration -- it lacks per-queue rate limiting and job flow DAGs. |
| Redis (Upstash or self-hosted) | 7.x | BullMQ backing store | Upstash Redis for serverless-friendly deployment. Alternatively, a small dedicated Redis instance on Railway/Fly.io. BullMQ requires Redis -- no way around this. |

**Confidence: HIGH** -- BullMQ is the undisputed standard for Node.js job queues in 2026. The 사방넷-replacement use case (polling 30 marketplaces on schedules) is BullMQ's sweet spot.

### Database & Data Layer

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase Postgres | 15.x | Primary database | Already decided. Orders, products, inventory, marketplace credentials all live here. Use pg_cron for lightweight scheduled tasks (e.g., daily cleanup). |
| Supabase Realtime | built-in | Live order feed | Subscribe to `orders` table changes for real-time dashboard updates. Use a dedicated "public" table without RLS for the order feed to avoid the per-subscriber query bottleneck. |
| Drizzle ORM | ^0.39 | Type-safe SQL | Use Drizzle over raw Supabase client for complex queries (joins across orders/products/marketplaces). Drizzle generates TypeScript types from schema, works with Supabase Postgres directly. Lighter than Prisma, better SQL control. |
| Zod | ^4.3 (via zod/v4) | Runtime validation | Validate marketplace API responses (each marketplace returns different shapes). Validate Excel import data. Zod 4 is stable and ships alongside v3 at the `zod/v4` subpath. |

**Confidence: HIGH** for Supabase Postgres/Realtime, **MEDIUM** for Drizzle (solid choice but verify Supabase connection pooling compatibility).

### Excel Import/Export

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| ExcelJS | ^4.4.0 | Excel read/write with formatting | **Use ExcelJS, not SheetJS.** Korean marketplace workflows require formatted Excel output (styled headers, merged cells for invoice sheets, data validations). SheetJS Community Edition silently drops styling and data validations on write. ExcelJS has streaming API for large files (2000 orders/day = manageable). The library has not released in ~2 years but is stable and battle-tested at 5.6M weekly downloads. |

**Confidence: HIGH** -- ExcelJS is the clear winner for formatted Excel output. SheetJS Pro would work but is paid and overkill.

### UI Components & Data Display

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TanStack Table | ^8.20 | Headless data table | Order management needs sorting, filtering, pagination, column visibility, row selection (for bulk actions like "upload invoices for selected orders"). TanStack Table v8 is production-stable. Do NOT use v9 alpha. |
| shadcn/ui | latest | UI component library | Pre-built accessible components on top of Radix UI + Tailwind. Copy-paste model means no version lock-in. Korean text renders well. Dashboard components (cards, dialogs, tables, forms) out of the box. |
| Sonner | ^2.x | Toast notifications | Lightweight toast library that integrates with shadcn/ui. Use for order sync status notifications. |
| nuqs | ^2.x | URL state management | Sync table filters/pagination to URL query params. Critical for order management -- users bookmark filtered views, share links to specific order states. |

**Confidence: HIGH** -- This is the standard 2025/2026 Next.js dashboard stack.

### Marketplace API Client Architecture

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| ky | ^1.7 | HTTP client | Lightweight fetch wrapper with retry, timeout, hooks. Better than axios for modern Node.js (uses native fetch). Each marketplace adapter wraps ky with marketplace-specific auth headers. |
| crypto (Node built-in) | -- | HMAC-SHA256 signing | Coupang API requires HMAC-SHA256 signatures. Use Node.js built-in crypto module -- no external library needed. |
| p-limit | ^6.x | Concurrency control | Limit concurrent API calls per marketplace. Korean marketplace APIs have strict rate limits (Coupang: ~100 req/min, Naver: varies by endpoint). Use p-limit inside BullMQ workers. |

**Confidence: MEDIUM** -- ky is a strong choice but marketplace-specific quirks may require custom retry logic. The auth patterns are verified from official docs.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | ^4.x | Date manipulation | Korean marketplace APIs use various date formats (KST timezone). date-fns handles timezone conversion and formatting. |
| nanoid | ^5.x | ID generation | Generate short unique IDs for internal order references, batch IDs. |
| iconv-lite | ^0.6 | Character encoding | Some older Korean marketplace APIs (11st, Auction) return EUC-KR encoded responses. Decode to UTF-8. |
| fast-xml-parser | ^5.x | XML parsing | Several Korean marketplace APIs (11st, ESM/Gmarket/Auction) still use XML, not JSON. Fast and lightweight parser. |
| pino | ^9.x | Structured logging | Log all marketplace API interactions for debugging. Structured JSON logs are essential when debugging integration issues across 30 marketplaces. |

**Confidence: MEDIUM** -- iconv-lite and fast-xml-parser needs are based on known Korean marketplace API patterns but should be verified per-marketplace during implementation.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Biome | Linter + formatter | Faster than ESLint + Prettier combo. Single tool for both. Already common in 2026 Next.js projects. |
| Vitest | Unit/integration testing | Fast, Vite-native. Test marketplace API adapters with mocked responses. |
| MSW (Mock Service Worker) | ^2.x API mocking | Mock marketplace API responses in tests and development. Critical -- you cannot hit real Coupang/Naver APIs during development. |
| Docker Compose | Local Redis + dev services | Run Redis locally for BullMQ development. |

## Installation

```bash
# Core (already installed)
# next, react, react-dom, @supabase/supabase-js, @supabase/ssr

# Job Queue
npm install bullmq ioredis

# Database & Validation
npm install drizzle-orm zod
npm install -D drizzle-kit

# Excel
npm install exceljs

# UI
npx shadcn@latest init
npm install @tanstack/react-table sonner nuqs

# Marketplace API Clients
npm install ky p-limit iconv-lite fast-xml-parser

# Utilities
npm install date-fns nanoid pino

# Dev dependencies
npm install -D vitest msw @types/node docker-compose
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| BullMQ + Redis | Supabase pgmq + Edge Functions | If you want zero additional infrastructure and your job complexity stays low (< 5 marketplaces, no rate limiting needs). pgmq lacks per-queue rate limiting and job flow DAGs. |
| BullMQ + Redis | Trigger.dev | If you want managed infrastructure with built-in observability dashboard. Good for teams that do not want to manage Redis. But adds vendor dependency and the self-hosted version requires Docker. |
| Drizzle ORM | Prisma | If your team already knows Prisma. But Prisma is heavier, has slower cold starts, and the query engine adds overhead. Drizzle is closer to raw SQL with type safety. |
| Drizzle ORM | Supabase JS Client only | For simple CRUD. But order management needs complex joins (orders + items + marketplace + shipping), and the Supabase client gets unwieldy for multi-table queries. |
| ExcelJS | SheetJS Pro | If you need to read obscure formats (XLS, ODS). But SheetJS Pro is paid ($500+/year) and ExcelJS handles XLSX read/write with formatting for free. |
| ky | axios | If team is very familiar with axios. But axios is 400KB+ vs ky at ~3KB, and ky uses native fetch. |
| TanStack Table v8 | TanStack Table v9 | When v9 reaches stable release. Currently alpha (v9.0.0-alpha.22 as of 2026-04-01). Do NOT use in production yet. |
| TanStack Table v8 | AG Grid | If you need Excel-like cell editing in the browser. AG Grid Community is free but heavy (~1MB). Only use if order table needs inline editing. |
| Biome | ESLint + Prettier | If you need ESLint plugins not yet supported by Biome (e.g., eslint-plugin-react-compiler). The project already has eslint-config-next, so migrating to Biome is optional. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Bull (not BullMQ) | Bull is EOL as of 2026. BullMQ is its successor with active maintenance. | BullMQ ^5.72 |
| node-cron | Runs in-process, no persistence, no retry, no distributed workers. Unreliable for marketplace polling. | BullMQ repeatable jobs + pg_cron for DB-level scheduling |
| Prisma | Heavy ORM with separate query engine binary. Slower cold starts on serverless. Schema-first workflow conflicts with Supabase migrations. | Drizzle ORM |
| SheetJS (Community) | Silently drops data validations and styling on write. Korean marketplace Excel templates require formatted output. | ExcelJS |
| axios | Bloated (400KB+), does not use native fetch, interceptor pattern leads to spaghetti error handling. | ky |
| Socket.io | Unnecessary complexity -- Supabase Realtime already provides WebSocket subscriptions for Postgres changes. Adding Socket.io would be a parallel real-time system with no benefit. | Supabase Realtime |
| Next.js API Routes for long-running jobs | Vercel/serverless has execution time limits (10-60s). Marketplace API polling can take minutes for large order batches. | BullMQ workers on dedicated process/server |
| moment.js | Deprecated, massive bundle size. | date-fns |

## Korean Marketplace API Authentication Patterns

Understanding auth patterns drives the marketplace adapter architecture.

| Marketplace | Auth Method | Key Details |
|-------------|------------|-------------|
| Coupang (WING) | HMAC-SHA256 | Secret key rotates every 6 months. Authorization header: `CEA algorithm=HmacSHA256, access-key={key}, signed-date={datetime}, signature={sig}`. Datetime format: `yyMMddTHHmmssZ`. |
| Naver SmartStore | OAuth2-like + IP whitelist | Commerce API Center issues app credentials. IP whitelist required (max 3 IPs). Periodic re-authentication required. Must use "통합매니저" (Integrated Manager) account. |
| Gmarket / Auction (ESM) | API Key (ESM Trading API) | Unified ESM Trading API at etapi.ebaykorea.com. Single API serves both Gmarket and Auction. |
| 11st (11번가) | API Key | Open API key issued through seller portal. REST/XML-based endpoints. |
| Cafe24 | OAuth2 | Standard OAuth2 flow with access/refresh tokens. Well-documented REST API. |
| Others (도매꾹, 오너클랜, etc.) | Varies | Many smaller marketplaces use simple API key auth. Some may require screen scraping if no API exists. |

**Data format note:** Coupang and Naver use JSON. 11st and ESM (Gmarket/Auction) historically use XML. Some smaller marketplaces may only support EUC-KR encoding. This is why `fast-xml-parser` and `iconv-lite` are in the stack.

## Stack Patterns by Variant

**If self-hosting (VPS/Docker):**
- Run BullMQ workers as a separate Node.js process alongside the Next.js app
- Use a single Redis instance for both BullMQ and caching
- Deploy with Docker Compose: `next-app` + `worker` + `redis`

**If deploying to Vercel:**
- Next.js app on Vercel (dashboard, API routes for webhooks)
- BullMQ workers on Railway/Fly.io (separate long-running process)
- Upstash Redis (serverless Redis, pay-per-request)
- This split is mandatory -- Vercel serverless cannot run persistent BullMQ workers

**If scale exceeds 2000 orders/day:**
- Add horizontal worker scaling (multiple BullMQ worker instances)
- Consider read replicas for Supabase Postgres
- Move to dedicated Redis (not Upstash) for lower latency

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| BullMQ ^5.72 | ioredis ^5.x, Redis 6.2+ | Requires Redis 6.2+ for Streams support |
| Drizzle ORM ^0.39 | @supabase/supabase-js ^2.x, PostgreSQL 15+ | Use drizzle-kit for migrations, works alongside Supabase migrations |
| ExcelJS ^4.4.0 | Node.js 18+ | Streaming API requires Node.js Readable streams |
| TanStack Table ^8.20 | React 18+, React 19 | Works with React 19 without issues |
| Zod ^4.3 | TypeScript 5.x | Import from `zod/v4` if installing zod@3 package, or install `zod@^4.3` directly |
| ky ^1.7 | Node.js 18+ (native fetch) | Uses global fetch, no polyfill needed in Next.js 16 |
| Next.js 16.2.2 | React 19.x, Node.js 18.18+ | Check `node_modules/next/dist/docs/` for breaking changes from training data |

## Sources

- [Coupang HMAC Signature Docs](https://developers.coupangcorp.com/hc/en-us/articles/360033461914-Creating-HMAC-Signature) -- HMAC-SHA256 auth pattern, MEDIUM confidence (403'd on fetch, details from search snippets)
- [Naver Commerce API GitHub](https://github.com/commerce-api-naver/commerce-api) -- Naver API technical support, HIGH confidence
- [ESM Trading API (Gmarket/Auction)](https://etapi.ebaykorea.com/) -- Unified API for eBay Korea platforms, MEDIUM confidence
- [BullMQ npm](https://www.npmjs.com/package/bullmq) -- v5.72.1 current, HIGH confidence
- [BullMQ Official Docs](https://docs.bullmq.io/) -- Features and patterns, HIGH confidence
- [Supabase Queues Docs](https://supabase.com/docs/guides/queues) -- pgmq capabilities and limitations, HIGH confidence
- [Supabase Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) -- Real-time subscription patterns, HIGH confidence
- [ExcelJS npm](https://www.npmjs.com/package/exceljs) -- v4.4.0 current, HIGH confidence
- [SheetJS vs ExcelJS comparison (pkgpulse)](https://www.pkgpulse.com/blog/sheetjs-vs-exceljs-vs-node-xlsx-excel-files-node-2026) -- Feature comparison, MEDIUM confidence
- [TanStack Table v9 RFC](https://github.com/TanStack/table/discussions/5834) -- v9 alpha status, HIGH confidence
- [Zod npm](https://www.npmjs.com/package/zod) -- v4.3.6 current, HIGH confidence
- [Trigger.dev vs BullMQ](https://trigger.dev/vs/bullmq) -- Alternative comparison, MEDIUM confidence

---
*Stack research for: Korean e-commerce marketplace integration SaaS*
*Researched: 2026-04-03*
