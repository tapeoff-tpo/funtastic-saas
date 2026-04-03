# Project Research Summary

**Project:** Funtastic SaaS — Korean E-Commerce Marketplace Integration Platform
**Domain:** OMS/Channel Manager (주문관리시스템) replacing 사방넷/플레이오토 for self-shipping Korean sellers
**Researched:** 2026-04-03
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a multi-channel order management system (OMS) for Korean e-commerce sellers who ship their own inventory across up to 30 domestic marketplaces (Coupang, Naver SmartStore, 11st, Gmarket/Auction, and others). The core value proposition is unambiguous: collect orders from every marketplace into a single dashboard and push tracking numbers back via API. Sellers who can do those two things have eliminated their dependency on 사방넷 (250,000–520,000 KRW/month + 500,000 setup fee). The recommended approach is a Next.js 16 + Supabase stack with a clean marketplace adapter layer, BullMQ for background job processing, and a tiered marketplace rollout starting with Coupang and Naver. Competitors' core weakness is UX quality and combined-shipping logic — those are the primary differentiators to exploit.

The key architectural decision is treating the marketplace adapter as a first-class abstraction from day one. Each of 30 marketplaces uses a different auth scheme (HMAC-SHA256 per request for Coupang, OAuth2 with token refresh for Naver, API keys for smaller platforms), different order status vocabularies, and different data formats (some return XML or EUC-KR encoded responses). The adapter layer normalizes all of this into a canonical internal model at the ingest boundary. Background jobs (order collection every 5 minutes, invoice uploads, inventory sync) must run outside the Next.js request cycle using BullMQ workers backed by Redis — Vercel serverless cannot host persistent workers, so a split deployment (Vercel for the Next.js app, Railway/Fly.io for workers, Upstash for Redis) is the production deployment model.

The primary risks are operational rather than technical: silent auth token expiry that causes undetected order collection failures, inventory race conditions that cause overselling at peak volume, and invoice upload batches that silently fail. All three risks have clear mitigations (marketplace health dashboard with auth vs. zero-orders distinction, atomic inventory decrements with safety stock buffers, and persistent retry queues with reconciliation views), but they must be designed in from the start, not retrofitted.

## Key Findings

### Recommended Stack

The project already has the core framework (Next.js 16.2.2, React 19, Supabase, TypeScript 5, Tailwind v4). The key additions are BullMQ + Redis for job processing (the undisputed Node.js standard for rate-limited, retry-aware background jobs at this scale), Drizzle ORM for type-safe complex queries across the orders/products/marketplace schema, and ExcelJS for formatted Excel output. Korean workflows are heavily Excel-dependent and SheetJS Community silently drops formatting on write, making ExcelJS the only viable choice.

**Core technologies:**
- **Next.js 16.2.2 + React 19**: Full-stack framework, already installed — Server Actions + API routes handle webhooks and dashboard
- **Supabase (Postgres + Realtime + Auth + Vault)**: Database, live order feed, user auth, and encrypted credential storage — eliminates separate auth/DB infra
- **BullMQ ^5.72 + Redis**: Job queue for marketplace polling, invoice uploads, inventory sync — rate limiting per queue is critical for Korean marketplace API limits
- **Drizzle ORM ^0.39**: Type-safe SQL for complex multi-table joins (orders + items + marketplace + shipping)
- **ExcelJS ^4.4.0**: Formatted Excel read/write — Korean invoice workflows require styled output that SheetJS Community cannot produce
- **TanStack Table v8**: Headless table for the order management dashboard (do NOT use v9 alpha)
- **ky ^1.7 + p-limit**: HTTP client with per-marketplace concurrency control for adapter layer
- **fast-xml-parser + iconv-lite**: Handle XML-based APIs (11st, ESM) and EUC-KR encoded responses from older Korean marketplaces

**Critical version note:** TanStack Table v9 is alpha as of 2026-04-01 — use v8 only.

### Expected Features

Research is based on competitive analysis of 사방넷, 플레이오토, 셀메이트, 이셀러스, and seller community feedback. The threshold for sellers to switch is clear: order collection + invoice upload API = can cut 사방넷. Everything else is additive.

**Must have (table stakes — v1):**
- Multi-marketplace order collection with auto-scheduling — core value, no point without it
- Unified order dashboard with filter/search by marketplace, status, date — 500+ orders/day requires a single view
- Invoice number upload via API per marketplace — this is the explicit switching trigger per PROJECT.md
- Excel invoice upload as fallback — for API failures and marketplaces without invoice API
- Claims/returns/exchange collection — missing these causes marketplace penalties and refund deadline misses
- Combined shipping detection and processing (합포장) — biggest daily pain point for high-volume sellers; competitors' implementations are weak
- Basic inventory tracking (deduct on ship, add on return) — prevents overselling without full inventory management complexity
- Marketplace credential management + user auth — foundation for everything

**Should have (competitive differentiators — v1.x after validation):**
- Auto-soldout across marketplaces when stock hits zero — 사방넷's strongest selling point; must match
- Product listing (bulk registration) starting with top 3-5 marketplaces
- Category mapping system (gates product listing — highest-effort prerequisite)
- Inventory sync to marketplaces
- Gift/freebie automation (사은품 자동지급) — high seller satisfaction, competitors' implementations are often buggy
- Set product decomposition (세트상품 분리) for accurate pick lists and inventory
- Barcode scanning verification to reduce packing errors
- Configurable scheduler automation (reduce manual trigger-clicking)

**Defer (v2+):**
- Full WMS — a separate product domain; OMS first
- Multi-tenant SaaS architecture for external sellers
- Funtastic B2B integration (API TBD)
- CS/inquiry management, accounting/settlement, detail page auto-generation, mobile native app

**Anti-features (explicitly do not build):** WMS, CS system, accounting, dropship automation, real-time-everything (API rate limits make true real-time impossible and adds cost).

### Architecture Approach

The system follows a four-layer architecture: Presentation (Next.js App Router), Application (API routes / Server Actions), Marketplace Adapter Layer (one TypeScript class per marketplace, all implementing a common interface), and Job Processing (BullMQ workers for all async work). The adapter layer is the core abstraction — all business logic interacts with the interface, never with a specific marketplace. The canonical data model normalizes at ingest and stores raw marketplace JSON alongside normalized records for debugging. All marketplace API calls happen through a per-marketplace token bucket rate limiter with no exceptions.

**Major components:**
1. **Marketplace Adapter Layer** (`lib/marketplace/`) — Strategy pattern, one file per marketplace, registry for discovery; foundation for the entire system
2. **BullMQ Job Workers** (separate Node.js process) — Order collection polling, invoice upload batches, inventory sync; must be outside Next.js request cycle
3. **Order Management Domain** (`lib/orders/`) — State machine for order lifecycle, canonical schema, idempotent UPSERT on collection
4. **Supabase Realtime** — Live dashboard updates via postgres_changes subscription on orders table; replaces need for polling or Socket.io
5. **Excel Pipeline** (`lib/excel/`) — Server-side parsing with encoding detection, streaming for large files, configurable column templates

**Build order dictated by dependencies:** Database schema → Marketplace adapter interface → Coupang adapter → Order collection pipeline → Order dashboard → Invoice upload. This is the critical path to replacing 사방넷.

### Critical Pitfalls

1. **Silent auth token expiry causing undetected order gaps** — Build a marketplace health dashboard that distinguishes "0 orders found" from "auth failed" from day one. Store token expiry timestamps and proactively refresh. Alert within 5 minutes on auth failures. Must be Phase 1 architecture.

2. **Order status model mismatch across marketplaces** — Each marketplace has a different status vocabulary (Coupang has "직권취소" discretionary cancellation with no equivalent elsewhere). Store raw marketplace status alongside normalized status. Build a status mapping audit that flags unmapped statuses rather than silently coercing them. Schema decision in Phase 1 — retrofitting is extremely painful.

3. **Invoice upload batch failures without retry or reconciliation** — Tracking upload is the most failure-prone step: rate limits, marketplace downtime, format validation, partial failures. Use BullMQ with persistent retry (exponential backoff, 5 retries over 30 minutes). Build a reconciliation view showing "shipped but not confirmed by marketplace." Phase 2 work but depends on Phase 1 queue infrastructure.

4. **Inventory sync race conditions causing overselling** — Concurrent orders from 30 marketplaces with 1-3 minute API latency windows will cause overselling without atomic decrements and safety stock buffers. Use PostgreSQL atomic operations, not application-level check-then-update. Design the schema for this in Phase 1 even though inventory sync is Phase 3.

5. **Credential security** — All 30 marketplace API keys in one database = catastrophic blast radius if breached. Use Supabase Vault from the first marketplace integration. Never store credentials in plaintext columns. Disable statement logging on credential inserts. Phase 1 non-negotiable.

6. **Excel encoding failures (EUC-KR)** — Korean marketplace-exported files frequently use EUC-KR or CP949 encoding. Test with real files, not UTF-8 test data. Auto-detect encoding, show a preview step before import commits. Affects both tracking upload (Phase 2) and product import (Phase 3).

## Implications for Roadmap

Based on the dependency graph in FEATURES.md, the build order from ARCHITECTURE.md, and the phase mapping in PITFALLS.md, the natural phase structure is:

### Phase 1: Foundation and Core Architecture
**Rationale:** Everything depends on the database schema, marketplace adapter interface, and security infrastructure. Getting the schema wrong is the most expensive mistake — order status model, credential storage, and inventory atomicity all need correct design before any feature work. Marketplace prioritization is also a Phase 1 planning decision (not a discovery mid-implementation).
**Delivers:** Working infrastructure with Coupang adapter end-to-end — a single marketplace collecting orders and uploading invoices as a validation of all patterns
**Addresses:** Auth + credential management, marketplace connection setup, database schema, BullMQ worker infrastructure
**Avoids:** Credential security pitfall (Supabase Vault from day one), order status mismatch pitfall (schema stores raw + normalized status), auth expiry pitfall (health monitoring baked in), marketplace prioritization pitfall (Tier 1 = Coupang + Naver, Tier 2 = 11st + Gmarket/Auction)

### Phase 2: Core Order Flow (the "사방넷 끊기" milestone)
**Rationale:** With infrastructure in place, build the complete order loop: collect → display → ship → upload. This is the exact feature set PROJECT.md identifies as sufficient to replace 사방넷. Keep the phase narrow and ship it to production with real daily volume before adding more features.
**Delivers:** Full daily workflow for a 500-2000 order/day seller — order collection, unified dashboard, combined shipping, invoice API upload, Excel invoice fallback, claims collection, order Excel export
**Uses:** BullMQ polling workers, TanStack Table for order grid, Supabase Realtime for live updates, ExcelJS for formatted export, per-marketplace rate limiters
**Implements:** Order collection pipeline (pg_cron + BullMQ + adapter), invoice upload flow with persistent retry queue, combined shipping detection
**Avoids:** Invoice upload failures pitfall (persistent queue with retry from day one), Excel encoding pitfall (EUC-KR detection in import pipeline), dashboard UX pitfalls (per-marketplace health status, error vs. empty state distinction)

### Phase 3: Inventory Management and Auto-Soldout
**Rationale:** Centralized inventory is a parallel foundation per FEATURES.md but must wait until the order flow is proven stable in production — inventory deductions depend on reliable order collection. Auto-soldout is 사방넷's strongest retention feature; matching it cements full replacement.
**Delivers:** Central inventory tracking, atomic stock deduction on order/add on return, auto-soldout when stock hits zero, inventory sync to marketplaces
**Avoids:** Race condition pitfall (atomic decrements + safety stock buffers), inventory drift between marketplaces

### Phase 4: Product Management
**Rationale:** Category mapping is the highest-effort prerequisite (each marketplace has its own category tree) and gates bulk product listing. This phase is complex enough to justify dedicated planning. Start with top 3-5 marketplaces for listing before expanding.
**Delivers:** Category mapping system, bulk product registration for top marketplaces, product modification sync, option/variant management
**Implements:** Product marketplace listings join table, per-marketplace category adapter methods

### Phase 5: Advanced Order Features and Remaining Marketplaces
**Rationale:** Once core flow is proven and inventory is stable, add the differentiating features (gift automation, set decomposition, barcode verification, scheduler automation) and expand marketplace coverage beyond the initial tier. Each new marketplace adapter is independent and can be added incrementally.
**Delivers:** Gift/freebie automation, set product decomposition, barcode scanning verification, configurable automation scheduler, remaining marketplace adapters to complete the 30-marketplace target
**Uses:** Rule engine pattern for gift automation, one new adapter file per marketplace following established interface

### Phase 6: Platform Expansion (v2+)
**Rationale:** Only after the core platform is stable and in daily production use. Multi-tenant requires significant auth and data isolation work (RLS at every level, per-seller credential isolation, billing). Funtastic B2B integration depends on API availability (TBD per PROJECT.md).
**Delivers:** Multi-tenant SaaS for external sellers, Funtastic B2B integration, reporting/analytics, settlement tracking

### Phase Ordering Rationale

- Schema and credential security decisions (Phase 1) are the most expensive to retrofit — they must come first regardless of feature priority
- The critical path is Phase 1 → Phase 2, which is the complete 사방넷 replacement. Phases 3-5 expand capability but are not switching blockers for the target user
- Inventory management (Phase 3) is deliberately separated from order management (Phase 2) because order collection must be battle-tested before inventory deductions can be trusted — a collection bug that creates phantom orders would corrupt inventory counts
- Product listing (Phase 4) is independent from the order pipeline and can be developed in parallel with Phase 3 if resourcing allows, but the category mapping effort makes it its own phase
- The combined shipping feature belongs in Phase 2 (not a separate phase) because it is a P1 daily workflow feature that competitors do poorly — it is a switching motivator, not an add-on

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Supabase Vault integration patterns for marketplace credentials — documentation exists but specific integration with drizzle-orm and RLS needs verification during planning
- **Phase 2:** Per-marketplace invoice upload API specifics beyond Coupang/Naver — the top 5 marketplaces each have different tracking number upload endpoints, required fields, and carrier code formats; these need per-marketplace API research before implementation
- **Phase 4:** Category mapping data model — each Korean marketplace has a unique category tree with thousands of nodes; the mapping schema and sync strategy needs dedicated research
- **Phase 5:** Remaining marketplaces (Tier 3) — some may have no API and require Excel-based integration or screen scraping (last resort); API availability needs verification per marketplace

Phases with standard patterns (skip or minimize research-phase):
- **Phase 2 (order dashboard):** TanStack Table + Supabase Realtime dashboard pattern is well-documented with many production examples
- **Phase 2 (BullMQ workers):** BullMQ patterns for rate-limited API polling are thoroughly documented; the adapter interface drives the implementation
- **Phase 3 (inventory tracking):** PostgreSQL atomic decrement patterns are well-established; complexity is in business rules, not infrastructure

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core stack already installed and proven; BullMQ, ExcelJS, Drizzle, TanStack Table all verified via official docs and npm metrics |
| Features | HIGH | Competitor feature analysis is thorough (8+ competitors reviewed); seller community pain points well-documented; PROJECT.md intent is unambiguous |
| Architecture | MEDIUM-HIGH | Adapter pattern and queue-based processing are well-established; Supabase Edge Function vs. BullMQ worker decision resolves clearly toward BullMQ at target scale; some marketplace-specific API behavior needs implementation verification |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls (auth expiry, race conditions, invoice retries) are well-documented with specific mitigations; some Korean marketplace-specific gotchas extrapolated from Coupang/Naver patterns and may vary per marketplace |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Specific invoice upload API formats for each marketplace beyond Coupang/Naver**: Tracking number formats, carrier code mappings, and upload endpoint behavior need per-marketplace research before Phase 2 implementation. Recommend building Coupang + Naver invoice upload in Phase 2 and researching remaining marketplaces just-in-time.
- **Naver Commerce API version status**: Research notes the API is "transitioning versions" — deprecation notices should be checked before starting the Naver adapter to avoid building against a deprecated endpoint.
- **BullMQ deployment split (Vercel vs. self-hosted)**: The production deployment model (Vercel + Railway/Upstash vs. full VPS) affects infrastructure cost and ops complexity. This is a deployment decision that should be confirmed before Phase 1 ends.
- **Supabase Vault + Drizzle ORM compatibility**: Vault is accessed via RPC functions, not standard table queries. The integration pattern with Drizzle needs a small proof-of-concept before committing the credential storage schema.
- **Some Tier 3 marketplace API availability**: It is unclear which of the remaining ~25 marketplaces beyond the top 5 have functional public APIs vs. requiring Excel-based integration or scraping. A marketplace audit should be done before Phase 5 scope is set.

## Sources

### Primary (HIGH confidence)
- [Coupang Open API Docs](https://developers.coupangcorp.com) — HMAC auth, rate limits (10 req/sec per vendor), invoice upload patterns
- [Naver Commerce API GitHub](https://github.com/commerce-api-naver/commerce-api) — OAuth patterns, rate limits (2 req/sec), deprecation tracking
- [Supabase Docs — Queues, Realtime, Vault, Cron](https://supabase.com/docs) — pgmq capabilities, Edge Function timeout limits (150s free / 400s pro), Vault encryption
- [BullMQ npm + Official Docs](https://docs.bullmq.io) — v5.72.1 current, rate limiting, job flows, repeatable jobs
- [TanStack Table v9 RFC](https://github.com/TanStack/table/discussions/5834) — v9 alpha status confirmed, v8 is production standard
- [Zod npm](https://www.npmjs.com/package/zod) — v4.3.6 stable, `zod/v4` subpath import

### Secondary (MEDIUM confidence)
- [사방넷, 플레이오토, 셀메이트, 이셀러스 official sites](https://www.sabangnet.co.kr, https://www.plto.com, https://sellmate.io, https://www.esellers.co.kr) — competitor feature and pricing analysis
- [바티AI 블로그](https://blog.bati.ai/commerce-solution-kr/) — comprehensive Korean OMS comparison, seller pain points
- [임팩트플로우](https://impactflow.kr/products/multi-channel-ecoammerce-software) — 2025 pricing and feature comparison
- [SheetJS vs ExcelJS comparison](https://www.pkgpulse.com/blog/sheetjs-vs-exceljs-vs-node-xlsx-excel-files-node-2026) — formatting capabilities, styling behavior
- [Multi-channel inventory sync pitfalls](https://syncauction.com/blog/multi-channel-inventory-sync-preventing-overselling) — overselling patterns and mitigations
- [EUC-KR encoding prevalence](https://mojoarch.com/compare-character-encoding/euc-kr-vs-utf-8) — 3.8% of Korean web still uses EUC-KR

### Tertiary (LOW confidence, needs implementation validation)
- ESM Trading API (Gmarket/Auction at etapi.ebaykorea.com) — unified API for eBay Korea platforms, details from search snippets (403 on direct fetch)
- 11st API rate limits — undocumented, extrapolated from Coupang patterns; start conservative at 5 req/sec
- Tier 3 marketplace API availability — not verified; several smaller Korean marketplaces may have no API

---
*Research completed: 2026-04-03*
*Ready for roadmap: yes*
