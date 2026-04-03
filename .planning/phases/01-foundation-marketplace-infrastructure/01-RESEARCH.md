# Phase 1: Foundation & Marketplace Infrastructure - Research

**Researched:** 2026-04-03
**Domain:** Authentication, encrypted credential storage, dashboard UI, marketplace adapter architecture
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundational layers: Supabase Auth with email/password login, encrypted marketplace credential storage using Supabase Vault, a sidebar admin dashboard showing marketplace health, and a modular adapter architecture (TypeScript interface + registry pattern) that allows adding marketplaces without modifying existing code.

The tech stack is already decided (Next.js 16 + Supabase + Drizzle ORM + Tailwind CSS v4) and partially scaffolded (Supabase SSR client files exist). The primary research question was Supabase Vault + Drizzle ORM compatibility for credential storage -- the answer is to use SQL wrapper functions called via Supabase RPC (not Drizzle directly), since Vault operates through `vault.create_secret()` / `vault.decrypted_secrets` which are Postgres extension functions outside Drizzle's schema management. Drizzle handles all other tables (marketplace_connections, etc.) normally.

**Primary recommendation:** Use Supabase Vault with RPC wrapper functions for credential encryption, `getClaims()` in middleware for auth protection, Drizzle ORM for all non-Vault tables, and shadcn/ui for dashboard components.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Supabase Auth with email/password. Internal use only (no social login needed for v1).
- **D-02:** Session management via Supabase SSR cookies (already set up in src/lib/supabase/).
- **D-03:** Marketplace API credentials encrypted at application level before storing in Supabase DB. Explore Supabase Vault as primary approach; fall back to app-level AES-256 encryption if Vault+Drizzle compatibility is problematic.
- **D-04:** Credentials table stores: marketplace_id, credential_type (api_key, secret, oauth_token), encrypted_value, expires_at, status.
- **D-05:** Sidebar navigation layout (standard for admin dashboards). Main sections: 대시보드, 주문관리, 배송관리, 상품관리, 재고관리, 마켓연동, 설정.
- **D-06:** Marketplace health dashboard as the primary landing page -- shows each connected marketplace's status (connected/error/expired).
- **D-07:** TypeScript interface pattern for marketplace adapters. Each marketplace = one adapter class implementing a common interface. Central registry maps marketplace IDs to adapter implementations.
- **D-08:** Adapter interface includes: authenticate(), testConnection(), getOrders(), uploadInvoice(), getProducts(), etc. Methods throw typed errors for rate limits, auth failures, etc.
- **D-09:** BullMQ + Redis for background jobs. Deployment decision (Vercel+Railway vs Docker) deferred to implementation -- researcher should investigate both and recommend.
- **D-10:** Drizzle ORM for database layer. Schema-first approach with migration files.

### Claude's Discretion
- UI component library choice (shadcn/ui recommended in CLAUDE.md)
- Specific folder structure and file organization patterns
- Database migration strategy details
- Error handling patterns

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | 시스템 관리자가 이메일/비밀번호로 로그인할 수 있다 | Supabase Auth email/password with `signInWithPassword()`. Middleware protects routes with `getClaims()`. |
| FOUND-02 | 로그인 세션이 브라우저 새로고침 후에도 유지된다 | Supabase SSR cookie-based sessions (already scaffolded in `src/lib/supabase/`). Middleware refreshes tokens automatically. |
| FOUND-03 | 관리자가 마켓플레이스별 API 인증정보를 등록하고 관리할 수 있다 | Supabase Vault RPC functions + `marketplace_connections` table in Drizzle. CRUD UI with shadcn/ui forms. |
| FOUND-04 | 등록된 API 인증정보가 암호화되어 안전하게 저장된다 | Supabase Vault (`vault.create_secret()`) encrypts at rest. Decryption only via `vault.decrypted_secrets` view through service-role RPC. |
| FOUND-05 | 마켓플레이스 연동 상태를 대시보드에서 확인할 수 있다 | `marketplace_connections` table with `status` and `last_checked_at` columns. Health dashboard UI with status badges. |
| MKT-06 | 추가 마켓플레이스 어댑터를 모듈식으로 확장할 수 있는 구조 | TypeScript `MarketplaceAdapter` interface + `MarketplaceRegistry` map. New adapter = new file implementing interface + register call. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack locked:** Next.js 16.2.2, React 19.2.4, Supabase ^2.101.1, TypeScript ^5, Tailwind CSS v4
- **ORM:** Drizzle ORM ^0.39+ (use drizzle-kit for migrations)
- **UI:** shadcn/ui recommended, TanStack Table v8 for data tables (NOT v9 alpha)
- **Validation:** Zod ^4.3 (import from `zod/v4` or install directly)
- **HTTP client:** ky ^1.7 for marketplace API calls
- **Queue:** BullMQ ^5.72 + Redis (NOT pgmq, NOT Bull, NOT node-cron)
- **Do NOT use:** Prisma, axios, moment.js, Socket.io, SheetJS Community, Bull (EOL)
- **Next.js docs:** Check `node_modules/next/dist/docs/` before writing code (directory does not exist in current install -- use official docs instead)
- **Biome** recommended over ESLint+Prettier (project currently has eslint-config-next)

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Verified |
|---------|---------|---------|----------|
| next | 16.2.2 | Full-stack framework | In package.json |
| react | 19.2.4 | UI framework | In package.json |
| @supabase/supabase-js | ^2.101.1 | Auth, DB client, Realtime | In package.json |
| @supabase/ssr | ^0.10.0 | Cookie-based SSR auth | In package.json |
| tailwindcss | ^4 | Styling | In devDependencies |
| typescript | ^5 | Type safety | In devDependencies |

### To Install for Phase 1
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| drizzle-orm | ^0.45.2 | Type-safe SQL, schema definition | Locked decision D-10. Latest verified: 0.45.2 |
| drizzle-kit | ^0.31.10 | Migration generation and execution | Companion to drizzle-orm |
| postgres | ^3.4 | PostgreSQL driver for Drizzle | Drizzle needs a driver; `postgres` (porsager/postgres) is recommended for Supabase |
| zod | ^4.3.6 | Runtime validation for forms, API responses | Validate credential input, marketplace API responses |
| shadcn (CLI) | ^4.1.2 | Component scaffolding | Discretionary: recommended in CLAUDE.md, standard for Next.js dashboards |
| sonner | ^2.x | Toast notifications | For auth feedback, credential save confirmation |
| nuqs | ^2.x | URL state management | For dashboard filters (marketplace filter, status filter) |

**Installation command:**
```bash
npm install drizzle-orm postgres zod@^4.3.6 sonner nuqs
npm install -D drizzle-kit
npx shadcn@latest init
```

### Not Needed in Phase 1 (Defer)
| Library | Phase | Reason |
|---------|-------|--------|
| bullmq | Phase 2+ | No background jobs in Phase 1. BullMQ + Redis needed for order collection. |
| ky | Phase 2+ | No external API calls in Phase 1. Adapter interface is defined but not called. |
| exceljs | Phase 3+ | No Excel operations in Phase 1. |
| tanstack/react-table | Phase 2+ | Dashboard in Phase 1 is health status cards, not data tables. |
| p-limit | Phase 2+ | Rate limiting needed when actually calling marketplace APIs. |

## Architecture Patterns

### Recommended Project Structure (Phase 1 Scope)
```
src/
├── app/
│   ├── (auth)/                    # Auth-gated layout group (sidebar + nav)
│   │   ├── layout.tsx             # Sidebar layout with auth check
│   │   ├── dashboard/
│   │   │   └── page.tsx           # Marketplace health dashboard (FOUND-05)
│   │   └── settings/
│   │       └── marketplaces/
│   │           └── page.tsx       # Marketplace credential management (FOUND-03)
│   ├── (public)/                  # Public pages (no auth required)
│   │   ├── login/
│   │   │   └── page.tsx           # Login page (FOUND-01)
│   │   └── layout.tsx             # Minimal layout for public pages
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts           # Auth callback handler
│   ├── api/
│   │   └── marketplace/
│   │       └── credentials/
│   │           └── route.ts       # Credential CRUD (calls Vault RPC)
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Redirect to /dashboard or /login
│   └── globals.css
├── lib/
│   ├── supabase/
│   │   ├── client.ts              # Browser client (exists)
│   │   ├── server.ts              # Server client (exists)
│   │   ├── middleware.ts           # Auth middleware helper (NEW)
│   │   └── admin.ts               # Service-role client for Vault (NEW)
│   ├── marketplace/
│   │   ├── types.ts               # MarketplaceAdapter interface (MKT-06)
│   │   ├── registry.ts            # Adapter registry/factory (MKT-06)
│   │   ├── errors.ts              # Typed marketplace errors
│   │   └── adapters/              # Per-marketplace implementations (empty in Phase 1)
│   │       └── .gitkeep
│   └── db/
│       ├── schema.ts              # Drizzle schema definitions
│       ├── index.ts               # Drizzle client instance
│       └── migrations/            # Generated by drizzle-kit
├── components/
│   ├── ui/                        # shadcn/ui components
│   ├── layout/
│   │   ├── sidebar.tsx            # Sidebar navigation (D-05)
│   │   └── app-shell.tsx          # Main layout shell
│   └── marketplace/
│       ├── health-card.tsx        # Per-marketplace status card
│       ├── credential-form.tsx    # Credential input form
│       └── status-badge.tsx       # Status indicator (connected/error/expired)
└── middleware.ts                   # Next.js middleware entry point
supabase/
├── migrations/
│   └── 001_vault_functions.sql    # Vault RPC wrapper functions
└── seed.sql                       # Marketplace enum data
drizzle.config.ts                   # Drizzle configuration
```

### Pattern 1: Supabase Auth with Middleware Protection

**What:** Next.js middleware intercepts every request, refreshes auth tokens via `getClaims()`, and redirects unauthenticated users away from protected routes.

**Implementation:**

```typescript
// src/middleware.ts
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session -- getClaims() validates JWT locally (fast)
  // Use getUser() only when you need server-verified session (e.g., sensitive operations)
  const { data: { claims }, error } = await supabase.auth.getClaims()

  // Redirect unauthenticated users to login
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')
  if (!claims && !isAuthRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (claims && isAuthRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Prevent caching of authenticated responses
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
}
```

**Key decisions:**
- Use `getClaims()` in middleware (validates JWT signature locally, fast, no network call to auth server)
- Use `getUser()` only in sensitive server actions (e.g., credential operations) where you need server-verified session
- `getClaims()` was introduced in supabase-js 2.51+ and is available in the installed 2.101.1

### Pattern 2: Supabase Vault for Credential Encryption

**What:** Marketplace API credentials are stored encrypted via Supabase Vault. Application code interacts through SQL wrapper functions called via RPC, never directly accessing `vault.secrets`.

**Why not Drizzle for Vault:** Vault uses Postgres extension functions (`vault.create_secret()`) and a special view (`vault.decrypted_secrets`). These are not Drizzle table schemas. The correct pattern is: Drizzle for regular tables, Supabase RPC for Vault operations.

**SQL wrapper functions (run as Supabase migration):**

```sql
-- supabase/migrations/001_vault_functions.sql

-- Store a marketplace credential
CREATE OR REPLACE FUNCTION store_marketplace_credential(
  p_name TEXT,
  p_secret TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  secret_id UUID;
BEGIN
  SELECT vault.create_secret(p_secret, p_name, p_description) INTO secret_id;
  RETURN secret_id;
END;
$$;

-- Read a marketplace credential (returns decrypted value)
CREATE OR REPLACE FUNCTION read_marketplace_credential(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT decrypted_secret INTO result
  FROM vault.decrypted_secrets
  WHERE name = p_name;
  RETURN result;
END;
$$;

-- Delete a marketplace credential
CREATE OR REPLACE FUNCTION delete_marketplace_credential(p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = p_name;
END;
$$;

-- Restrict to service_role only
REVOKE ALL ON FUNCTION store_marketplace_credential FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_marketplace_credential TO service_role;

REVOKE ALL ON FUNCTION read_marketplace_credential FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_marketplace_credential TO service_role;

REVOKE ALL ON FUNCTION delete_marketplace_credential FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_marketplace_credential TO service_role;
```

**Application code (server-side only):**

```typescript
// src/lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'

// Service-role client -- NEVER expose to browser
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Store credential via Vault
export async function storeCredential(
  marketplaceId: string,
  credentialType: string,
  secret: string
) {
  const admin = createAdminClient()
  const name = `mkt_${marketplaceId}_${credentialType}`
  const { data, error } = await admin.rpc('store_marketplace_credential', {
    p_name: name,
    p_secret: secret,
    p_description: `${marketplaceId} ${credentialType}`,
  })
  if (error) throw error
  return data as string // UUID
}

// Read credential via Vault (server-side only!)
export async function readCredential(
  marketplaceId: string,
  credentialType: string
): Promise<string | null> {
  const admin = createAdminClient()
  const name = `mkt_${marketplaceId}_${credentialType}`
  const { data, error } = await admin.rpc('read_marketplace_credential', {
    p_name: name,
  })
  if (error) throw error
  return data as string | null
}
```

### Pattern 3: Marketplace Adapter Interface (MKT-06)

**What:** TypeScript interface that all marketplace adapters implement. A registry maps marketplace IDs to adapter instances. Adding a new marketplace = implementing the interface + registering it.

```typescript
// src/lib/marketplace/types.ts

export type MarketplaceId =
  | 'coupang'
  | 'naver'
  | 'elevenst'
  | 'gmarket'
  | 'auction'
  | string // extensible for future marketplaces

export type ConnectionStatus = 'connected' | 'error' | 'expired' | 'disconnected'

export type AuthType = 'hmac' | 'oauth2' | 'api_key' | 'session'

export interface MarketplaceConfig {
  readonly id: MarketplaceId
  readonly name: string           // Display name (e.g., '쿠팡')
  readonly authType: AuthType
  readonly rateLimitPerSecond: number
  readonly requiredCredentials: string[]  // e.g., ['access_key', 'secret_key', 'vendor_id']
}

export interface MarketplaceCredentials {
  [key: string]: string  // key-value pairs matching requiredCredentials
}

// Typed errors for specific failure modes
export class MarketplaceAuthError extends Error {
  constructor(
    public readonly marketplaceId: MarketplaceId,
    message: string,
    public readonly isExpired: boolean = false,
  ) {
    super(message)
    this.name = 'MarketplaceAuthError'
  }
}

export class MarketplaceRateLimitError extends Error {
  constructor(
    public readonly marketplaceId: MarketplaceId,
    public readonly retryAfterMs: number,
  ) {
    super(`Rate limited on ${marketplaceId}, retry after ${retryAfterMs}ms`)
    this.name = 'MarketplaceRateLimitError'
  }
}

export interface MarketplaceAdapter {
  readonly config: MarketplaceConfig

  // Connection management
  testConnection(credentials: MarketplaceCredentials): Promise<{
    success: boolean
    error?: string
    expiresAt?: Date
  }>

  // Phase 2+ methods -- defined here, implemented later
  // getOrders(since: Date): Promise<NormalizedOrder[]>
  // uploadInvoice(orderId: string, invoice: InvoiceData): Promise<void>
  // getProducts(): Promise<NormalizedProduct[]>
}
```

```typescript
// src/lib/marketplace/registry.ts

import type { MarketplaceAdapter, MarketplaceConfig, MarketplaceId } from './types'

class MarketplaceRegistry {
  private adapters = new Map<MarketplaceId, MarketplaceAdapter>()

  register(adapter: MarketplaceAdapter): void {
    if (this.adapters.has(adapter.config.id)) {
      throw new Error(`Adapter already registered: ${adapter.config.id}`)
    }
    this.adapters.set(adapter.config.id, adapter)
  }

  get(id: MarketplaceId): MarketplaceAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      throw new Error(`Unknown marketplace: ${id}. Available: ${this.listIds().join(', ')}`)
    }
    return adapter
  }

  has(id: MarketplaceId): boolean {
    return this.adapters.has(id)
  }

  listIds(): MarketplaceId[] {
    return Array.from(this.adapters.keys())
  }

  listConfigs(): MarketplaceConfig[] {
    return Array.from(this.adapters.values()).map(a => a.config)
  }
}

// Singleton registry
export const marketplaceRegistry = new MarketplaceRegistry()
```

### Pattern 4: Drizzle ORM Schema + Database Setup

**What:** Drizzle schema-first approach. Define tables in TypeScript, generate SQL migrations with drizzle-kit.

```typescript
// src/lib/db/schema.ts
import { pgTable, uuid, text, timestamp, pgEnum, varchar, jsonb } from 'drizzle-orm/pg-core'

export const connectionStatusEnum = pgEnum('connection_status', [
  'connected', 'error', 'expired', 'disconnected'
])

export const authTypeEnum = pgEnum('auth_type', [
  'hmac', 'oauth2', 'api_key', 'session'
])

export const marketplaceConnections = pgTable('marketplace_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),  // references auth.users
  marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
  displayName: text('display_name').notNull(),
  authType: authTypeEnum('auth_type').notNull(),
  status: connectionStatusEnum('status').notNull().default('disconnected'),
  vaultSecretNames: jsonb('vault_secret_names').$type<string[]>().notNull(), // references to vault.secrets names
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastErrorMessage: text('last_error_message'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
```

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './src/lib/db/migrations',
  schema: './src/lib/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // When using Supabase connection pooling with Transaction mode:
  // entities: { prepare: false }
})
```

**Migration workflow:**
```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Apply migration (push to database)
npx drizzle-kit push

# Or apply via migrate() in code
npx drizzle-kit migrate
```

### Anti-Patterns to Avoid

- **Storing credentials in Drizzle-managed columns:** Never store API keys/secrets as plaintext text columns. Always use Vault.
- **Exposing service-role client to browser:** The admin client (service_role key) must ONLY be used in server-side code (API routes, Server Actions). Never import `createAdminClient` in client components.
- **Using `getSession()` in middleware:** Always use `getClaims()` (local JWT validation) or `getUser()` (server verification). `getSession()` is not guaranteed to revalidate.
- **One giant marketplace file:** Each marketplace gets its own adapter file. No switch statements on marketplace ID in business logic.
- **Putting Vault operations in Drizzle migrations:** Vault SQL functions should be in Supabase migrations (supabase/migrations/), not Drizzle migrations, since Drizzle manages application tables only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Credential encryption | Custom AES-256 with key management | Supabase Vault | Vault handles key management, rotation, and encryption. Custom crypto is error-prone (key storage, IV management, padding). |
| Authentication + sessions | Custom JWT generation and cookie management | Supabase Auth + @supabase/ssr | Battle-tested, handles token refresh, cookie security, CSRF protection. |
| Form components | Custom input/select/dialog components | shadcn/ui | Accessible, styled, keyboard-navigable. Building from scratch wastes days. |
| Migration management | Manual SQL file tracking | drizzle-kit | Generates type-safe migrations from schema diffs, handles ordering and rollback. |
| Toast notifications | Custom notification system | Sonner | Handles stacking, dismissal, auto-hide, accessibility. |

## Common Pitfalls

### Pitfall 1: Supabase Vault + Drizzle Schema Confusion
**What goes wrong:** Developers try to define vault.secrets as a Drizzle table or call vault.create_secret() through Drizzle's query builder. This fails because Vault is a Postgres extension with its own schema.
**Why it happens:** Natural instinct to manage all database operations through the ORM.
**How to avoid:** Clear separation: Drizzle manages application tables (marketplace_connections, orders, etc.). Vault is accessed via Supabase RPC through the admin client. The `marketplace_connections` table stores vault secret names (references), not the secrets themselves.
**Warning signs:** Type errors when trying to import vault tables in Drizzle schema; "relation vault.secrets does not exist" errors from Drizzle.

### Pitfall 2: Middleware Auth Token Not Refreshing
**What goes wrong:** Authenticated sessions expire after 1 hour and users get logged out on page refresh.
**Why it happens:** Middleware calls `getClaims()` but doesn't properly propagate the refreshed cookies back to the response.
**How to avoid:** The middleware MUST set cookies on both the request (for downstream Server Components) AND the response (for the browser). The `setAll` callback in the Supabase client config must handle both.
**Warning signs:** Users reporting random logouts; "JWT expired" errors in server logs.

### Pitfall 3: Service Role Key Leaking to Client
**What goes wrong:** The SUPABASE_SERVICE_ROLE_KEY ends up in client-side JavaScript, giving full database access to anyone.
**Why it happens:** Importing the admin client in a client component, or prefixing the env var with NEXT_PUBLIC_.
**How to avoid:** Service role key env var must NOT have NEXT_PUBLIC_ prefix. The `createAdminClient()` function must ONLY be imported in files that run server-side (API routes, Server Actions, middleware). Add a comment or eslint rule to enforce this.
**Warning signs:** Environment variable visible in browser DevTools; anyone can access all database rows.

### Pitfall 4: Connection Pooling + Prepared Statements
**What goes wrong:** Drizzle queries fail intermittently with "prepared statement already exists" errors.
**Why it happens:** Supabase connection pooling in Transaction mode does not support prepared statements. Drizzle uses prepared statements by default.
**How to avoid:** When using Supabase connection pooling (Supavisor), connect via the pooler URL (port 6543) with `prepare: false` in the postgres driver config. For direct connections (port 5432), prepared statements work fine.
**Warning signs:** Intermittent query failures that are hard to reproduce; errors mentioning "prepared statement."

### Pitfall 5: Vault Functions Not Restricted to Service Role
**What goes wrong:** Anyone with a Supabase anon key can call vault RPC functions and read/write encrypted secrets.
**Why it happens:** Forgetting to REVOKE permissions and GRANT only to service_role after creating the SQL functions.
**How to avoid:** Every vault wrapper function must have explicit REVOKE/GRANT statements. Test by calling the RPC with the anon key -- it should fail with a permission error.
**Warning signs:** Vault functions callable from client-side code; no permission denied errors when testing.

## Code Examples

### Login Page (Server Action Pattern)

```typescript
// src/app/(public)/login/actions.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })
  if (error) {
    return { error: error.message }
  }
  redirect('/dashboard')
}
```

### Drizzle Client Setup

```typescript
// src/lib/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

// Use connection pooling URL for serverless, direct for long-running
const client = postgres(connectionString, {
  prepare: false, // Required for Supabase connection pooling (Transaction mode)
})

export const db = drizzle(client, { schema })
```

### Marketplace Credential CRUD (Server Action)

```typescript
// src/app/(auth)/settings/marketplaces/actions.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { marketplaceRegistry } from '@/lib/marketplace/registry'

export async function registerMarketplace(formData: FormData) {
  // Verify auth with getUser() for this sensitive operation
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Unauthorized')

  const marketplaceId = formData.get('marketplace_id') as string
  const config = marketplaceRegistry.get(marketplaceId).config

  // Store each credential in Vault
  const admin = createAdminClient()
  const vaultNames: string[] = []
  for (const credKey of config.requiredCredentials) {
    const value = formData.get(credKey) as string
    const name = `mkt_${user.id}_${marketplaceId}_${credKey}`
    await admin.rpc('store_marketplace_credential', {
      p_name: name,
      p_secret: value,
      p_description: `${marketplaceId} ${credKey} for user ${user.id}`,
    })
    vaultNames.push(name)
  }

  // Store connection metadata in Drizzle-managed table
  await db.insert(marketplaceConnections).values({
    userId: user.id,
    marketplaceId,
    displayName: config.name,
    authType: config.authType,
    status: 'disconnected',
    vaultSecretNames: vaultNames,
  })
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `getSession()` in middleware | `getClaims()` for JWT validation | supabase-js 2.51 (2025) | Faster, more secure -- validates JWT locally via JWKS |
| Auth helpers package | @supabase/ssr | 2024 | Auth helpers deprecated, SSR package is replacement |
| tailwind.config.js | CSS-first config (Tailwind v4) | 2025 | Config in globals.css via @theme directive |
| drizzle-orm 0.39 | 0.45.2 | 2026 | Minor API changes, check migration guide |
| pgsodium direct usage | Supabase Vault (uses pgsodium internally) | 2024 | Vault provides higher-level API; pgsodium pending deprecation |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | None -- needs Wave 0 setup |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | Login with email/password | integration | `npx vitest run src/__tests__/auth/login.test.ts -t "login"` | No -- Wave 0 |
| FOUND-02 | Session persists across refresh | integration | `npx vitest run src/__tests__/auth/session.test.ts` | No -- Wave 0 |
| FOUND-03 | Register marketplace credentials | unit + integration | `npx vitest run src/__tests__/marketplace/credentials.test.ts` | No -- Wave 0 |
| FOUND-04 | Credentials stored encrypted | unit | `npx vitest run src/__tests__/marketplace/vault.test.ts` | No -- Wave 0 |
| FOUND-05 | Dashboard shows marketplace status | unit | `npx vitest run src/__tests__/marketplace/health.test.ts` | No -- Wave 0 |
| MKT-06 | Adapter interface extensibility | unit | `npx vitest run src/__tests__/marketplace/registry.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- Vitest configuration with path aliases
- [ ] `src/__tests__/marketplace/registry.test.ts` -- Adapter registry CRUD tests
- [ ] `src/__tests__/marketplace/credentials.test.ts` -- Credential storage/retrieval tests (mock Vault RPC)
- [ ] `src/__tests__/marketplace/health.test.ts` -- Connection status logic tests
- [ ] `src/__tests__/auth/login.test.ts` -- Auth flow tests (mock Supabase Auth)
- [ ] Framework install: `npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react`

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | Yes | v24.14.1 | -- |
| Supabase CLI | Migrations, Vault setup | Yes | 2.84.7 | -- |
| Supabase Project (remote) | Auth, DB, Vault | Unknown | -- | Local Supabase via `supabase start` |
| Docker | Local Supabase dev | No | -- | Use remote Supabase project directly |
| Redis | BullMQ (Phase 2+) | No | -- | Not needed in Phase 1 |
| Vitest | Testing | Yes (global) | 4.1.2 | -- |

**Missing dependencies with no fallback:**
- None for Phase 1. Docker absence means local Supabase dev stack (`supabase start`) won't work, but a remote Supabase project is sufficient.

**Missing dependencies with fallback:**
- Docker not installed -- use remote Supabase project for development. Can install Docker later for local dev.

## Open Questions

1. **Supabase Vault availability on project plan**
   - What we know: Vault is a Postgres extension available on all Supabase projects (free and paid). Enabled via `CREATE EXTENSION IF NOT EXISTS vault WITH SCHEMA vault`.
   - What's unclear: Whether the user's Supabase project already has Vault enabled.
   - Recommendation: Add a Wave 0 task to verify Vault is enabled. If not, enable it via SQL or Supabase Dashboard (Database > Extensions).

2. **getClaims() availability in installed @supabase/supabase-js**
   - What we know: `getClaims()` was introduced in supabase-js 2.51. Installed version is 2.101.1. However, grep of node_modules did not find `getClaims` in type definitions.
   - What's unclear: Whether `getClaims()` is available in the installed version's runtime or needs a different import.
   - Recommendation: First task should verify `getClaims()` works. Fallback: use `getUser()` in middleware (slower but proven). Check if supabase-js needs updating.

3. **Database connection strategy**
   - What we know: Supabase offers direct (port 5432) and pooled (port 6543, via Supavisor) connections. Drizzle with postgres.js works with both.
   - What's unclear: Which connection URL the user will configure in DATABASE_URL.
   - Recommendation: Document both options. Default to pooled connection with `prepare: false` for serverless-compatible setup.

## Sources

### Primary (HIGH confidence)
- [Supabase Vault Documentation](https://supabase.com/docs/guides/database/vault) -- Vault API, create_secret, decrypted_secrets view
- [Supabase Vault Tutorial (MakerKit)](https://makerkit.dev/blog/tutorials/supabase-vault) -- RPC wrapper pattern, service_role restriction
- [Supabase SSR Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs) -- Middleware setup, getClaims/getUser
- [Drizzle ORM with Supabase](https://orm.drizzle.team/docs/tutorials/drizzle-with-supabase) -- Connection setup, schema definition
- [Drizzle ORM SQL operator](https://orm.drizzle.team/docs/sql) -- Raw SQL execution for Vault operations
- [shadcn/ui Next.js Installation](https://ui.shadcn.com/docs/installation/next) -- Tailwind v4 + Next.js setup
- [shadcn/ui Tailwind v4 Guide](https://ui.shadcn.com/docs/tailwind-v4) -- CSS-first configuration

### Secondary (MEDIUM confidence)
- [Supabase getClaims() vs getUser()](https://github.com/supabase/supabase/issues/40985) -- Clarification on when to use each
- [Supabase Auth Asymmetric Keys](https://github.com/orgs/supabase/discussions/29289) -- getClaims introduction timeline
- [Drizzle Migration Strategy with Supabase](https://zenn.dev/azuma317/articles/drizzle-migration-supabase-production?locale=en) -- Production migration patterns
- [pgsodium Pending Deprecation](https://supabase.com/docs/guides/database/extensions/pgsodium) -- Vault unaffected but pgsodium will be deprecated

### Tertiary (LOW confidence)
- getClaims() runtime availability in supabase-js 2.101.1 -- could not verify via node_modules grep, needs runtime testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified via npm registry, versions confirmed
- Architecture: HIGH -- patterns well-documented in official sources, Vault+RPC pattern confirmed by multiple sources
- Auth flow: MEDIUM-HIGH -- getClaims() documented but runtime availability in installed version unconfirmed
- Pitfalls: HIGH -- sourced from project research PITFALLS.md and official docs

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable stack, 30-day validity)
