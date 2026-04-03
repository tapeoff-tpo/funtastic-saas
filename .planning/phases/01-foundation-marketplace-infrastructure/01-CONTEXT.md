# Phase 1: Foundation & Marketplace Infrastructure - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Auth system, encrypted marketplace credential storage, marketplace connection health dashboard, and modular adapter architecture. This is the foundation everything else builds on.

</domain>

<decisions>
## Implementation Decisions

### Authentication
- **D-01:** Supabase Auth with email/password. Internal use only (no social login needed for v1).
- **D-02:** Session management via Supabase SSR cookies (already set up in src/lib/supabase/).

### Credential Storage
- **D-03:** Marketplace API credentials encrypted at application level before storing in Supabase DB. Explore Supabase Vault as primary approach; fall back to app-level AES-256 encryption if Vault+Drizzle compatibility is problematic.
- **D-04:** Credentials table stores: marketplace_id, credential_type (api_key, secret, oauth_token), encrypted_value, expires_at, status.

### Dashboard & Navigation
- **D-05:** Sidebar navigation layout (standard for admin dashboards). Main sections: 대시보드, 주문관리, 배송관리, 상품관리, 재고관리, 마켓연동, 설정.
- **D-06:** Marketplace health dashboard as the primary landing page — shows each connected marketplace's status (connected/error/expired).

### Adapter Architecture
- **D-07:** TypeScript interface pattern for marketplace adapters. Each marketplace = one adapter class implementing a common interface. Central registry maps marketplace IDs to adapter implementations.
- **D-08:** Adapter interface includes: authenticate(), testConnection(), getOrders(), uploadInvoice(), getProducts(), etc. Methods throw typed errors for rate limits, auth failures, etc.

### Infrastructure
- **D-09:** BullMQ + Redis for background jobs. Deployment decision (Vercel+Railway vs Docker) deferred to implementation — researcher should investigate both and recommend.
- **D-10:** Drizzle ORM for database layer. Schema-first approach with migration files.

### Claude's Discretion
- UI component library choice (shadcn/ui recommended in CLAUDE.md)
- Specific folder structure and file organization patterns
- Database migration strategy details
- Error handling patterns

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Project vision, constraints, key decisions
- `.planning/REQUIREMENTS.md` — v1 requirements (FOUND-01~05, MKT-06 for this phase)
- `.planning/research/SUMMARY.md` — Research synthesis with stack recommendations
- `.planning/research/STACK.md` — Detailed technology recommendations
- `.planning/research/ARCHITECTURE.md` — System architecture patterns
- `.planning/research/PITFALLS.md` — Common mistakes to avoid

### Technology References
- `CLAUDE.md` — Full technology stack decisions and library versions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/supabase/client.ts` — Browser-side Supabase client (createBrowserClient)
- `src/lib/supabase/server.ts` — Server-side Supabase client with cookie handling

### Established Patterns
- Supabase SSR cookie-based auth pattern already set up
- Next.js 16 App Router (src/app/ directory)
- Tailwind CSS v4 with theme variables in globals.css

### Integration Points
- `src/app/layout.tsx` — Root layout, needs auth provider wrapping
- `src/app/page.tsx` — Currently default Next.js page, will become login redirect
- Environment variables needed: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User wants to move fast ("이제 만들어줘").

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-marketplace-infrastructure*
*Context gathered: 2026-04-03*
