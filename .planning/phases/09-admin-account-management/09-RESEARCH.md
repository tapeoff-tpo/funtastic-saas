# Phase 9: 관리자 계정 관리 - Research

**Researched:** 2026-04-29
**Domain:** Admin account management (Supabase Auth + role gating + audit logging) on Next.js 16 App Router
**Confidence:** HIGH

## Summary

Phase 9 is implemented entirely with the **existing project stack** — no new top-level dependencies are required. Supabase Auth (`@supabase/ssr` 0.10.0 for cookie-bound sessions, `@supabase/supabase-js` 2.101.1 for the service-role admin client) covers user creation, password updates, and ban/unban. Drizzle 0.45.2 owns the new `user_profiles` and `audit_logs` tables. RLS policies live in `supabase/migrations/` (handwritten SQL pattern), table DDL is generated from `src/lib/db/schema.ts` via `drizzle-kit generate`. UI follows the existing `(auth)/admin/dev-log/` pattern: a server-rendered `page.tsx` calling `actions.ts`, with thin `'use client'` islands for forms and dialogs. `@base-ui/react` 1.3.0 is already installed, including a `dialog` primitive — but the codebase has not yet adopted it; existing dialogs hand-roll a fixed-position modal. Phase 9 is the right time to introduce a `Dialog` shadcn-style wrapper around `@base-ui/react/dialog`.

Two non-obvious findings drove decisions in this research:

1. **Next.js 16 renamed `middleware.ts` → `proxy.ts`** ([VERIFIED: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`]). The project currently has **no** `proxy.ts` or `middleware.ts` — auth gating is layout-based via `src/app/(auth)/layout.tsx` calling `supabase.auth.getUser()` and `redirect('/login')`. Phase 9 should follow this layout-gating pattern, not introduce a proxy file.

2. **Supabase `ban_duration` does NOT accept `'permanent'`** ([VERIFIED: `node_modules/@supabase/auth-js/dist/main/lib/types.d.ts:446`]). The type is `string | 'none'`; valid units are `ns/us/ms/s/m/h`. CONTEXT.md's example `ban_duration: 'permanent'` is incorrect. Use `'876000h'` (100 years) for de-facto permanent ban, or `'none'` to lift.

**Primary recommendation:** Use `auth.admin.updateUserById(id, { ban_duration: '876000h' })` for deactivation (single source of truth at the auth layer, blocks login at JWT issuance). Mirror the soft-delete state in `user_profiles.deactivated_at` for query convenience (listing active accounts, audit trail). The `(auth)/layout.tsx` gate becomes the second-layer defense: even if `ban_duration` is bypassed, the layout query can refuse a deactivated profile.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Auth provider:** Supabase Auth (no custom auth). Anon key on client; `service_role` only in server actions.
- **Login ID = real email** (Supabase standard). No fake-email conversion. No password-reset email / magic links.
- **Roles:** two only — `super_admin` (owner) and `admin` (staff). Stored in `user_profiles.role` enum. Phase 9 is account model + management UI; per-feature gating is Phase 10+.
- **Account creation:** owner creates from a form (email + role; display_name optional). Initial password is read from env var `INITIAL_USER_PASSWORD` (default `eksrnr2125@`). Supabase call: `auth.admin.createUser({ email, password, email_confirm: true })`. Owner relays credentials to staff out-of-band.
- **First-login password change:** none. Users may self-change via `auth.updateUser({ password })` on a settings page. Owner can force-reset back to `INITIAL_USER_PASSWORD` from the admin list.
- **Schema:**
  - `user_profiles`: `id uuid` (FK + PK to `auth.users.id`), `email text unique`, `role text` enum, `display_name text`, `created_at timestamptz`, `created_by uuid` (FK self), `deactivated_at timestamptz nullable`, `deactivated_by uuid` (FK self).
  - `audit_logs`: `id uuid pk`, `actor_id uuid`, `action text` (one of: `account.create`, `account.role_change`, `account.deactivate`, `account.reactivate`, `account.password_reset`, `password.self_change`), `target_id uuid`, `metadata jsonb`, `created_at timestamptz`.
- **RLS on user_profiles:** own row SELECT/UPDATE allowed; super_admin SELECT/INSERT/UPDATE all rows.
- **Deletion:** soft-only via `deactivated_at`. No hard delete in Phase 9. Deactivated accounts cannot log in.
- **Validation:** server actions verify caller's role is `super_admin` before mutating. Self-deactivate denied. Last-super_admin demote/deactivate denied (count of `role='super_admin' AND deactivated_at IS NULL` must remain ≥ 1).
- **UI:** replace the placeholder at `src/app/(auth)/admin/accounts/page.tsx`. Use TanStack Table + dialogs (existing patterns). Self-service password change page under `/settings` or similar admin route.
- **audit_logs in Phase 9:** write only — viewer UI deferred.
- **Bootstrap super_admin:** SQL seed in `supabase/migrations/` or one-off manual step documented in README.

### Claude's Discretion

- **Dialog library:** between `@base-ui/react` Dialog primitive (already installed at 1.3.0) and the existing hand-rolled fixed-position pattern. Recommend introducing a small `src/components/ui/dialog.tsx` wrapper around `@base-ui/react/dialog` so future dialogs share it. (Existing hand-rolled dialogs continue to work; don't refactor them in this phase.)
- **Form validation library:** Zod 4.3.6 is in scope. No dedicated form library is in use today — devs hand-roll `useActionState` + `formData.get()` (see `src/app/(public)/login/page.tsx`, `src/app/(auth)/admin/dev-log/dev-log-form.tsx`). Stay with that pattern; add `zod` parsing inside the server action only.
- **Deactivation mechanism (Supabase ban vs. middleware/profile check):** Recommend BOTH — `ban_duration` for hard cutoff, `deactivated_at` for query and UI signal. See [Decision: Deactivation Mechanism](#decision-deactivation-mechanism) below.
- **audit_logs visibility:** keep DB-only this phase. No reader UI.

### Deferred Ideas (OUT OF SCOPE)

- audit_logs viewer UI / filters / CSV export
- Per-feature RBAC gating (Phase 10 candidate)
- MFA / TOTP / passkeys
- Password strength / expiry policies (Supabase defaults only)
- SSO (Google / Naver / Kakao)
- Forced logout / session management
- Staff profile detail (avatar / department / contact)
- Approval workflow (owner-creates flow makes this unnecessary)
</user_constraints>

<phase_requirements>
## Phase Requirements

The CONTEXT.md does not yet enumerate canonical `ADMIN-XX` requirement IDs for `.planning/REQUIREMENTS.md`. Suggested IDs the planner can register:

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | super_admin can create admin accounts via form (email + role) using `auth.admin.createUser` with env-sourced initial password | [Existing Project Patterns](#existing-project-patterns), [Supabase Admin API in Server Actions](#supabase-admin-api-in-server-actions) |
| ADMIN-02 | user_profiles + audit_logs schema with Drizzle, RLS for user_profiles, foreign-key cascade with `auth.users` | [Schema & Migration Pattern](#schema--migration-pattern), [Supabase RLS for user_profiles](#supabase-rls-for-user_profiles) |
| ADMIN-03 | Owner can change role, reset password to INITIAL_USER_PASSWORD, deactivate/reactivate accounts; last-super_admin protection enforced | [Last super_admin Protection](#last-super_admin-protection), [Decision: Deactivation Mechanism](#decision-deactivation-mechanism) |
| ADMIN-04 | Authenticated user can self-change password via settings page (`auth.updateUser({ password })`) | [Self-Service Password Change](#self-service-password-change) |
| ADMIN-05 | Deactivated accounts cannot log in; layout gate redirects deactivated profiles to `/login` even if their JWT cookie is still valid | [Decision: Deactivation Mechanism](#decision-deactivation-mechanism) |
| ADMIN-06 | All mutating account actions write a row to `audit_logs` in the same transaction as the auth/profile mutation | [audit_logs Write Pattern](#audit_logs-write-pattern) |

If `.planning/REQUIREMENTS.md` already reserves a different prefix, swap accordingly. The planner owns final ID assignment.
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Next.js 16 breaking changes:** AGENTS.md is one line — read `node_modules/next/dist/docs/` before writing Next.js 16 code. Two changes that hit Phase 9:
  1. **`middleware.ts` is deprecated, renamed to `proxy.ts`** [VERIFIED: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` line 11]. Do NOT create a `middleware.ts`. The project today has no `proxy.ts` or `middleware.ts`; auth gating is purely layout-based.
  2. The function name inside `proxy.ts` must be `proxy`, not `middleware`.
- **Stack lock-in:** TanStack Table v8 (NOT v9 alpha), Drizzle 0.45.2 (NOT Prisma), `@supabase/ssr` for cookies (NOT deprecated `@supabase/auth-helpers-nextjs`), Sonner for toasts.
- **Korean text first-class:** all UI labels in Korean (existing convention — see `accounts/page.tsx` placeholder text "준비 중입니다.", `login/page.tsx` "이메일", "비밀번호").
- **GSD workflow enforcement:** edits gate through `/gsd:execute-phase` etc. Don't bypass.
- **Tailwind v4 + shadcn `base-nova` style** [VERIFIED: `components.json:3`].
- **Korean date pattern (KST):** see `dev-log/page.tsx:15-25` for `formatDateLabel` / KST shift.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| User authentication (signin) | Supabase Auth (managed service) | Frontend Server (cookie set via `@supabase/ssr`) | Already established in `src/app/(public)/login/actions.ts`. Server action calls `signInWithPassword`; cookies set by `createServerClient`. |
| Session verification (per request) | Frontend Server (RSC) | — | `(auth)/layout.tsx` calls `supabase.auth.getUser()` (network-validated) and redirects to `/login`. No client-side session checks. |
| Admin account CRUD | Frontend Server (server actions) | Supabase Auth (Admin API for user state); Database (user_profiles row mirror) | service_role key available only in server actions via `createAdminClient` from `src/lib/supabase/admin.ts`. Browser must never see service_role. |
| Role check on each mutation | Frontend Server (server action) | Database (RLS as defense-in-depth) | Server action queries `user_profiles.role` for the authenticated caller before any mutation. RLS prevents accidental bypass at the DB layer. |
| user_profiles persistence | Database (Postgres + RLS) | — | Drizzle reads/writes; RLS enforces row-level auth. |
| audit_logs persistence | Database (Postgres) | — | No RLS for Phase 9 (server-action-only writes); add later when reader UI lands. |
| Login blocking for deactivated accounts | Supabase Auth (`ban_duration`) | Frontend Server `(auth)/layout.tsx` (defense-in-depth — checks `deactivated_at`) | See [Decision: Deactivation Mechanism](#decision-deactivation-mechanism). |
| Password change (self) | Supabase Auth (`auth.updateUser`) via Frontend Server (server action) | — | Standard Supabase pattern. No password hashing in app code. |
| Password reset (admin-forced) | Supabase Auth (`auth.admin.updateUserById`) via Frontend Server | — | service_role required. |

## Standard Stack (Already Installed — No New Top-Level Deps)

### Core (already installed, verified versions)

| Library | Version | Purpose | Why Standard Here |
|---------|---------|---------|--------------|
| `next` | 16.2.2 | Framework | [VERIFIED: `node_modules/next/package.json`] |
| `react` / `react-dom` | 19.2.4 | UI | [VERIFIED: `package.json`]. `useActionState` is the standard form binding (see `login/page.tsx`). |
| `@supabase/ssr` | 0.10.0 | Cookie-bound Supabase client (server + browser) | [VERIFIED: `package.json`, `src/lib/supabase/{server,client}.ts`] |
| `@supabase/supabase-js` | 2.101.1 | Service-role admin client + types | [VERIFIED: `node_modules/@supabase/supabase-js/package.json`, `src/lib/supabase/admin.ts`] |
| `@supabase/auth-js` | 2.101.1 | Underlying Auth SDK (peer of supabase-js) | [VERIFIED: `node_modules/@supabase/auth-js/package.json`]. Provides `GoTrueAdminApi` types. |
| `drizzle-orm` | 0.45.2 | Query builder | [VERIFIED: `node_modules/drizzle-orm/package.json`]. CLAUDE.md says ^0.39 — actual is 0.45.2. |
| `drizzle-kit` | 0.31.10 | Migration generator | [VERIFIED: `package.json`]. `npm run` not wired; invoke directly: `npx drizzle-kit generate` and `npx drizzle-kit migrate`. |
| `postgres` | 3.4.8 | Postgres driver under Drizzle | [VERIFIED: `package.json`]. Note: `prepare: false` is set for Supabase Transaction-mode pooling — see `src/lib/db/index.ts:8`. |
| `zod` | 4.3.6 | Server-side input validation | [VERIFIED: `package.json`]. Use plain `zod` import (Zod 4 default; not the v3-shimmed `zod/v4` subpath). |
| `@tanstack/react-table` | 8.21.3 | Headless table | [VERIFIED: `package.json`]. Existing pattern: `src/app/(auth)/orders/data-table.tsx`. |
| `@base-ui/react` | 1.3.0 | Headless primitives (Dialog/Select/Input/Button) | [VERIFIED: `node_modules/@base-ui/react/package.json`]. Dialog primitive ships at `@base-ui/react/dialog` with parts: `Root, Backdrop, Portal, Popup, Close, Description, Title, Trigger, Viewport`. Not yet adopted in this codebase. |
| `sonner` | 2.0.7 | Toasts | [VERIFIED: `package.json`]. Toaster mounted in `src/app/layout.tsx:35`. |
| `lucide-react` | 1.7.0 | Icons | [VERIFIED: `package.json`, `components.json:13`]. |

### What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `bcryptjs` (already in deps) | Phase 9 must NOT hash passwords. Supabase Auth owns password storage. The `bcryptjs` dependency exists for unrelated reasons (not auth). | Pass plain password to `auth.admin.createUser({ password })` — Supabase hashes server-side. |
| `react-hook-form` | Not in stack. Codebase uses `useActionState` + `FormData` directly. | `useActionState` (existing pattern). |
| `next-auth` / Auth.js | Project decision: Supabase Auth is the auth provider. Don't introduce a competing layer. | Supabase Auth + `@supabase/ssr`. |
| Custom session store | Supabase already manages JWT in cookies via `@supabase/ssr`. | `createServerClient` in `src/lib/supabase/server.ts`. |
| `middleware.ts` file | **Deprecated in Next.js 16; renamed to `proxy.ts`.** [VERIFIED: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:11`] | Layout-based gate (existing `(auth)/layout.tsx`). |

**Verified versions:** Each above was read directly from `node_modules/<pkg>/package.json` — not training data.

## Existing Project Patterns

### File Structure for Auth Routes

```
src/
├── app/
│   ├── layout.tsx                       # Root, mounts <Toaster/> and <NuqsAdapter/>
│   ├── (public)/                        # Unauthenticated routes
│   │   ├── layout.tsx                   # Centered card layout
│   │   └── login/
│   │       ├── page.tsx                 # 'use client' — useActionState binding
│   │       └── actions.ts               # 'use server' — signInWithPassword + redirect
│   ├── (auth)/                          # Authenticated routes
│   │   ├── layout.tsx                   # Calls getUser(); redirects to /login if absent
│   │   ├── admin/
│   │   │   ├── accounts/page.tsx        # ← Phase 9 replaces this placeholder
│   │   │   └── dev-log/                 # ← Pattern reference
│   │   │       ├── page.tsx             # Server component, calls actions
│   │   │       ├── actions.ts           # 'use server' — list/create/delete
│   │   │       ├── dev-log-form.tsx     # 'use client' — useActionState
│   │   │       └── delete-button.tsx    # 'use client' — useTransition
│   │   ├── settings/page.tsx            # ← Currently placeholder; Phase 9 adds password form
│   │   └── orders/                      # TanStack Table reference
│   │       ├── page.tsx
│   │       ├── data-table.tsx
│   │       ├── columns.tsx
│   │       ├── actions.ts
│   │       └── hold-dialog.tsx          # Hand-rolled modal pattern
│   └── auth/callback/route.ts           # OAuth/PKCE callback (not used in Phase 9 — no email links)
├── components/
│   ├── layout/                          # AppShell, Sidebar, TabBar
│   └── ui/                              # shadcn-style: badge, button, card, input, label,
│                                        #               pagination, select, separator
│                                        # ← No Dialog yet — Phase 9 should add ui/dialog.tsx
├── lib/
│   ├── supabase/
│   │   ├── server.ts                    # createServerClient (cookies)
│   │   ├── client.ts                    # createBrowserClient
│   │   └── admin.ts                     # createAdminClient (service_role)
│   └── db/
│       ├── index.ts                     # postgres-js + drizzle bootstrap
│       ├── schema.ts                    # All Drizzle tables — Phase 9 appends here
│       └── migrations/                  # drizzle-kit generated SQL + meta/_journal.json
└── supabase/migrations/                 # Handwritten SQL — RLS lives here, NOT in Drizzle
```

### Server Client Pattern [VERIFIED: `src/lib/supabase/server.ts`]

```ts
// src/lib/supabase/server.ts — async because cookies() is async in Next 16
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )
}
```

**Why the empty `try/catch`:** in RSC render context, `cookieStore.set` throws — the empty catch swallows that. Cookies still flush correctly because Supabase calls `setAll` again from the server-action context where mutation is allowed. This is the canonical `@supabase/ssr` pattern; do NOT modify.

### Admin Client Pattern [VERIFIED: `src/lib/supabase/admin.ts`]

```ts
// src/lib/supabase/admin.ts — service_role; server-only
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables')
  }
  return createClient(url, key)
}
```

**Phase 9 addition:** add `import 'server-only'` at the top of `admin.ts`. This makes any accidental client-side import error at build time. [CITED: `node_modules/next/dist/docs/01-app/02-guides/data-security.md:85`]

### Auth Gate Pattern [VERIFIED: `src/app/(auth)/layout.tsx`]

```ts
// src/app/(auth)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/app-shell'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <AppShell>{children}</AppShell>
}
```

`getUser()` (NOT `getSession()`) is correct here — `getUser()` calls Supabase Auth to validate the JWT. `getSession()` reads the cookie blindly. [VERIFIED: `node_modules/@supabase/ssr/README.md:34-47`]

### Server Action Pattern [VERIFIED: `src/app/(public)/login/actions.ts`, `(auth)/admin/dev-log/actions.ts`]

```ts
// 'use server' file at the top
// One server action per mutating verb. Two return shapes in this codebase:
//   1. { error?: string }                                — for useActionState forms
//   2. { success: boolean; error?: string }              — for transition-based dialogs
// Phase 9 should pick (2) for dialog-driven mutations and (1) for the create form.

'use server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'

export async function someAction(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }
  // ... mutate ...
  revalidatePath('/admin/accounts')
  return {}
}
```

### Form Pattern [VERIFIED: `(public)/login/page.tsx`, `(auth)/admin/dev-log/dev-log-form.tsx`]

```tsx
'use client'
import { useActionState } from 'react'
import { someAction } from './actions'

const initialState = { error: '' }

export function SomeForm() {
  const [state, formAction, pending] = useActionState(someAction, initialState)
  return (
    <form action={formAction} className="space-y-4">
      <input name="email" type="email" required />
      <input name="password" type="password" required />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? '처리 중...' : '저장'}</button>
    </form>
  )
}
```

### Dialog Pattern (existing — hand-rolled) [VERIFIED: `(auth)/orders/hold-dialog.tsx`]

The codebase currently uses `fixed inset-0 z-50 flex items-center justify-center bg-black/50` overlays with raw state. **No accessibility wiring** (no focus trap, no escape key, no aria-modal). This works but is not ideal for accounts management where keyboard users matter. Phase 9 should introduce a proper dialog primitive.

### Dialog Pattern (recommended for Phase 9 — `@base-ui/react` 1.3.0)

[VERIFIED: `node_modules/@base-ui/react/dialog/index.parts.d.ts`]

```tsx
'use client'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

// src/components/ui/dialog.tsx — new file in Phase 9
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogPortal = DialogPrimitive.Portal
export const DialogClose = DialogPrimitive.Close

export function DialogBackdrop(props: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return <DialogPrimitive.Backdrop {...props} className="fixed inset-0 z-40 bg-black/50 data-[open]:animate-in data-[closed]:animate-out" />
}
export function DialogPopup(props: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Popup
      {...props}
      className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl outline-none"
    />
  )
}
export const DialogTitle = DialogPrimitive.Title       // mandatory for a11y
export const DialogDescription = DialogPrimitive.Description
```

`DialogPrimitive.Root` props (excerpt): `open`, `defaultOpen`, `modal` (default `true`, can be `'trap-focus'`), `onOpenChange(open, eventDetails)`. Note: `onOpenChange` callback signature is `(open: boolean, eventDetails: ...) => void`, not the Radix-style `(open: boolean) => void`. [VERIFIED: `node_modules/@base-ui/react/dialog/root/DialogRoot.d.ts:40`]

### Transition + Toast Pattern [VERIFIED: `(auth)/orders/hold-dialog.tsx:21-38`]

```tsx
'use client'
import { useTransition } from 'react'
import { toast } from 'sonner'

const [open, setOpen] = useState(false)
const [pending, startTransition] = useTransition()

function handleSubmit() {
  startTransition(async () => {
    const result = await someAction(orderId, reason)
    if (result.success) {
      toast.success('처리되었습니다')
      setOpen(false)
    } else {
      toast.error(result.error ?? '처리 실패')
    }
  })
}
```

## Schema & Migration Pattern

### Drizzle Schema Addition (append to `src/lib/db/schema.ts`)

```ts
// ─── Phase 9: Admin Account Management ─────────────────────────

export const userRoleEnum = pgEnum('user_role', ['super_admin', 'admin'])

export const userProfiles = pgTable(
  'user_profiles',
  {
    // FK + PK to auth.users.id. NO defaultRandom — id comes from Supabase auth.users.
    id: uuid('id').primaryKey(),
    email: text('email').notNull().unique(),
    role: userRoleEnum('role').notNull().default('admin'),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by'),  // self-FK; nullable for the bootstrap super_admin
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivatedBy: uuid('deactivated_by'),
  },
  (table) => [
    index('user_profiles_email_idx').on(table.email),
    index('user_profiles_role_active_idx').on(table.role, table.deactivatedAt),
  ],
)

export const auditActionEnum = pgEnum('audit_action', [
  'account.create',
  'account.role_change',
  'account.deactivate',
  'account.reactivate',
  'account.password_reset',
  'password.self_change',
])

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id').notNull(),
    action: auditActionEnum('action').notNull(),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_actor_created_idx').on(table.actorId, table.createdAt),
    index('audit_logs_target_created_idx').on(table.targetId, table.createdAt),
    index('audit_logs_action_created_idx').on(table.action, table.createdAt),
  ],
)
```

**Cross-schema FK to `auth.users`:** Drizzle does not declare `auth` schema by default. Two options:

1. (Recommended) Skip the Drizzle-level FK declaration; add it via raw SQL migration in `supabase/migrations/`:

   ```sql
   ALTER TABLE public.user_profiles
     ADD CONSTRAINT user_profiles_id_fkey
     FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
   ```

2. Declare the `auth` schema in Drizzle and reference it. More plumbing; not worth it for one FK.

The existing project already mixes Drizzle-generated migrations (`src/lib/db/migrations/`) with handwritten Supabase migrations (`supabase/migrations/`). Phase 9 should follow this split: tables/indexes via `drizzle-kit generate`; cross-schema FKs and RLS via handwritten SQL.

### Migration Workflow

1. Append schema to `src/lib/db/schema.ts`.
2. Run `npx drizzle-kit generate` → generates `src/lib/db/migrations/0001_<name>.sql` + updates `meta/_journal.json`.
3. Review the SQL diff.
4. Create `supabase/migrations/016_admin_account_management.sql` with:
   - The cross-schema FK to `auth.users(id)` with `ON DELETE CASCADE`.
   - `enable row level security` for `user_profiles`.
   - RLS policies (see next section).
   - Optional bootstrap seed for the first super_admin (commented; see [Bootstrap section](#bootstrap-first-super_admin)).
5. Apply: `npx drizzle-kit migrate` (Drizzle's tracked migrations) and run the Supabase migration via Supabase CLI or paste in Studio.

[CITED: drizzle-kit docs at https://orm.drizzle.team/kit-docs/overview — `generate` and `migrate` semantics, MEDIUM confidence (versioned to 0.31.x).]

## Supabase RLS for user_profiles

**Pattern:** Use `auth.uid()` for self-row matching; use a `SECURITY DEFINER` helper function for the super_admin check to avoid policy recursion. The existing project established this pattern in `00001_core_schema.sql` with `public.get_my_seller_id()`.

### Recommended Policies

```sql
-- supabase/migrations/016_admin_account_management.sql (excerpt)

-- Cross-schema FK
alter table public.user_profiles
  add constraint user_profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

-- Helper: avoids RLS recursion when policies need to read user_profiles for the caller
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid()
      and role = 'super_admin'
      and deactivated_at is null
  );
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

-- Enable RLS
alter table public.user_profiles enable row level security;

-- 1) Self-read: every authenticated user sees their own row.
create policy "user_profiles: self select"
  on public.user_profiles for select
  using (id = auth.uid());

-- 2) Self-update: a user can edit their own display_name (and only that — column-level
--    enforcement happens in the server action's zod schema; RLS allows the row, the action narrows columns).
create policy "user_profiles: self update"
  on public.user_profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- 3) super_admin: full select.
create policy "user_profiles: super_admin select all"
  on public.user_profiles for select
  using (public.is_super_admin());

-- 4) super_admin: insert (used when service_role isn't available, e.g., future RPC paths).
--    Note: the planned flow uses service_role from server actions, which BYPASSES RLS.
--    These policies are defense-in-depth, not the primary path.
create policy "user_profiles: super_admin insert"
  on public.user_profiles for insert
  with check (public.is_super_admin());

-- 5) super_admin: update any row.
create policy "user_profiles: super_admin update all"
  on public.user_profiles for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- audit_logs: NO RLS in Phase 9. Writes are server-action-only with service_role.
-- Add RLS in the phase that introduces a reader UI.
```

[CITED: Supabase RLS docs https://supabase.com/docs/guides/database/postgres/row-level-security — `auth.uid()`, `security definer` functions, separate `using` vs `with check` clauses. HIGH confidence (matches in-tree pattern from `00001_core_schema.sql`).]

**Important:** server actions create users with the **service_role client**, which bypasses RLS entirely. The policies above primarily protect against:
- Future client-side queries via the anon-key Supabase client (e.g., a dashboard widget showing "your profile").
- The (deferred) RPC-based path if the project ever exposes user_profiles to the browser.

## Decision: Deactivation Mechanism

CONTEXT.md leaves this open: "(a) Supabase `auth.admin.updateUserById(id, { ban_duration: 'permanent' })` vs (b) middleware check on `user_profiles.deactivated_at`."

### Option A: `ban_duration` (Supabase-native)

[VERIFIED: `node_modules/@supabase/auth-js/dist/main/lib/types.d.ts:436-446`]

```ts
ban_duration?: string | 'none';
// Format: decimal + unit suffix. Units: ns, us (or µs), ms, s, m, h.
// Examples: '300ms', '2h45m', '876000h' (~100 years).
// 'none' lifts the ban.
```

**CRITICAL:** the value `'permanent'` mentioned in CONTEXT.md is NOT supported. Use `'876000h'` (the example in `GoTrueAdminApi.d.ts:553` is "Ban a user for 100 years").

Pros:
- Login is rejected at the auth server. No app-side check needed.
- Existing JWT cookies become unusable on next refresh (within the JWT expiry window — typically 1 hour by default).

Cons:
- A logged-in user with a still-valid JWT can keep using the app **until their JWT expires** (default 60 min). They cannot refresh, but cached pages and parallel requests against the JWT keep working in that window.
- Server actions that don't re-validate via `getUser()` won't notice immediately.

### Option B: layout-level `deactivated_at` check

```ts
// src/app/(auth)/layout.tsx — augmented
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/login')
const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, user.id))
if (!profile || profile.deactivatedAt) {
  await supabase.auth.signOut()
  redirect('/login?reason=deactivated')
}
```

Pros:
- Immediate cutoff on next page navigation, regardless of JWT expiry.
- Works even if the auth ban call failed (defense in depth).

Cons:
- Adds one DB query per authenticated request. Negligible at this scale (single index lookup).
- Server actions still need to be checked individually if they don't go through the layout.

### Recommendation: BOTH (defense-in-depth)

```ts
// In the deactivate server action:
async function deactivateAccount(targetId: string) {
  const admin = createAdminClient()
  // 1. Ban at the auth layer
  await admin.auth.admin.updateUserById(targetId, { ban_duration: '876000h' })
  // 2. Mirror in user_profiles for app-side queries + audit
  await db.transaction(async (tx) => {
    await tx.update(userProfiles)
      .set({ deactivatedAt: new Date(), deactivatedBy: actor.id })
      .where(eq(userProfiles.id, targetId))
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      action: 'account.deactivate',
      targetId,
      metadata: { reason: 'admin_action' },
    })
  })
}

// Reactivate: ban_duration: 'none' + clear deactivatedAt
```

And add the `deactivatedAt` check to `(auth)/layout.tsx`:

```ts
// src/app/(auth)/layout.tsx — Phase 9 update
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/login')

const [profile] = await db
  .select({ deactivatedAt: userProfiles.deactivatedAt, role: userProfiles.role })
  .from(userProfiles)
  .where(eq(userProfiles.id, user.id))
  .limit(1)

if (!profile || profile.deactivatedAt) {
  await supabase.auth.signOut()
  redirect('/login?reason=deactivated')
}
```

Rationale: the auth-layer ban handles login, the app-layer check handles the in-flight JWT window, and the redundancy means accidental drift between the two states is recoverable.

## Last super_admin Protection

Enforce in the server action **inside the same transaction** as the role mutation (or deactivate). Race condition example: two super_admins simultaneously demote each other; without locking, both pass the count check and both demotions land.

```ts
async function changeRole(targetId: string, newRole: UserRole) {
  const supabase = await createClient()
  const { data: { user: actor } } = await supabase.auth.getUser()
  if (!actor) return { success: false, error: '인증이 필요합니다.' }

  return db.transaction(async (tx) => {
    // Lock the actor's profile row + the target's row to serialize concurrent demotions.
    const [actorProfile] = await tx
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, actor.id))
      .for('update')                      // FOR UPDATE — Drizzle's row lock
    if (!actorProfile || actorProfile.role !== 'super_admin') {
      return { success: false, error: '권한이 없습니다.' }
    }
    if (actorProfile.deactivatedAt) {
      return { success: false, error: '비활성화된 계정입니다.' }
    }

    const [target] = await tx
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, targetId))
      .for('update')
    if (!target) return { success: false, error: '대상 계정을 찾을 수 없습니다.' }

    // Last-super_admin guard: only when demoting a super_admin to admin.
    if (target.role === 'super_admin' && newRole === 'admin') {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(userProfiles)
        .where(and(
          eq(userProfiles.role, 'super_admin'),
          isNull(userProfiles.deactivatedAt),
        ))
      if (count <= 1) {
        return { success: false, error: '마지막 super_admin은 강등할 수 없습니다.' }
      }
    }

    // Self-demote prevention (per CONTEXT.md): block actor demoting themselves to admin
    // when they're the last super_admin — covered by the count check above when target === actor.

    await tx.update(userProfiles).set({ role: newRole }).where(eq(userProfiles.id, targetId))
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      action: 'account.role_change',
      targetId,
      metadata: { from: target.role, to: newRole },
    })
    return { success: true }
  })
}
```

Same pattern for `deactivate`: count active super_admins before allowing deactivation of one. Self-deactivate is rejected unconditionally (per CONTEXT.md "비활성화 시 본인 비활성화 시도는 거부").

`db.transaction` usage matches existing style [VERIFIED: `src/lib/orders/actions.ts`, `src/lib/inventory/actions.ts`].

## Self-Service Password Change

```ts
// src/app/(auth)/settings/password-actions.ts (new file)
'use server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { auditLogs } from '@/lib/db/schema'
import { z } from 'zod'

const PasswordSchema = z.object({
  newPassword: z.string()
    .min(8, { error: '비밀번호는 8자 이상이어야 합니다.' })
    .max(72, { error: '비밀번호는 72자 이하여야 합니다.' }),  // bcrypt limit
})

export async function changeOwnPassword(_prev: unknown, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const parsed = PasswordSchema.safeParse({ newPassword: formData.get('newPassword') })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '잘못된 입력입니다.' }

  // auth.updateUser uses the user's own JWT — works on the cookie-bound server client.
  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword })
  if (error) return { error: error.message }

  await db.insert(auditLogs).values({
    actorId: user.id,
    action: 'password.self_change',
    targetId: user.id,
    metadata: {},
  })

  return { success: true }
}
```

`auth.updateUser` runs against the cookie-bound server client (anon key), not the admin client. The user's JWT authorizes the update. [VERIFIED: `node_modules/@supabase/auth-js/dist/main/lib/types.d.ts:393-402` — `UserAttributes.password`]

**Page placement:** CONTEXT.md says "본인 설정 페이지 (`/settings` 또는 별도 라우트)". Existing `src/app/(auth)/settings/page.tsx` is a placeholder. Phase 9 should add a section there or a sub-route `(auth)/settings/password/page.tsx` — planner's call.

## Admin Password Reset (super_admin force-reset)

```ts
// In src/app/(auth)/admin/accounts/actions.ts
'use server'
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { userProfiles, auditLogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

function getInitialPassword(): string {
  const pw = process.env.INITIAL_USER_PASSWORD
  if (!pw || pw.length < 8) {
    throw new Error('INITIAL_USER_PASSWORD env var is missing or too short')
  }
  return pw
}

async function assertSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('인증이 필요합니다.')
  const [profile] = await db
    .select({ role: userProfiles.role, deactivatedAt: userProfiles.deactivatedAt })
    .from(userProfiles)
    .where(eq(userProfiles.id, user.id))
    .limit(1)
  if (!profile || profile.role !== 'super_admin' || profile.deactivatedAt) {
    throw new Error('권한이 없습니다.')
  }
  return user
}

export async function resetAccountPassword(targetId: string) {
  const actor = await assertSuperAdmin()
  const admin = createAdminClient()
  const initial = getInitialPassword()

  const { error } = await admin.auth.admin.updateUserById(targetId, { password: initial })
  if (error) return { success: false, error: error.message }

  await db.insert(auditLogs).values({
    actorId: actor.id,
    action: 'account.password_reset',
    targetId,
    metadata: {},
  })
  return { success: true }
}
```

## Account Creation

```ts
export async function createAccount(_prev: unknown, formData: FormData) {
  const actor = await assertSuperAdmin()
  const admin = createAdminClient()

  const Schema = z.object({
    email: z.email({ error: '올바른 이메일을 입력하세요.' }).trim().toLowerCase(),
    role: z.enum(['super_admin', 'admin']),
    displayName: z.string().trim().max(100).optional(),
  })
  const parsed = Schema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
    displayName: formData.get('displayName') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '잘못된 입력입니다.' }

  const initial = getInitialPassword()

  // 1) Create the auth user (this is the source of id).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: initial,
    email_confirm: true,                    // skip confirmation email
  })
  if (createErr || !created.user) {
    return { error: createErr?.message ?? '계정 생성 실패' }
  }

  // 2) Insert profile + audit row in one transaction. If this fails, COMPENSATE by deleting the auth user.
  try {
    await db.transaction(async (tx) => {
      await tx.insert(userProfiles).values({
        id: created.user!.id,
        email: parsed.data.email,
        role: parsed.data.role,
        displayName: parsed.data.displayName,
        createdBy: actor.id,
      })
      await tx.insert(auditLogs).values({
        actorId: actor.id,
        action: 'account.create',
        targetId: created.user!.id,
        metadata: { email: parsed.data.email, role: parsed.data.role },
      })
    })
  } catch (e) {
    // Compensating delete to avoid orphan auth.users row
    await admin.auth.admin.deleteUser(created.user.id)
    return { error: e instanceof Error ? e.message : '프로필 생성 실패' }
  }

  revalidatePath('/admin/accounts')
  return { success: true }
}
```

[VERIFIED: `node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.d.ts:240-315` — `createUser` signature, `email_confirm: true` skips confirmation email.]

## audit_logs Write Pattern

**Decision: write inline in the same Drizzle transaction as the auth/profile mutation, no DB trigger.**

Why not a trigger:
- Triggers can't observe `auth.users` mutations from `service_role` (those happen in the `auth` schema).
- Action metadata (the actor performing the change, the request context) lives in the application layer, not the DB layer.
- Triggers add hidden behavior — debugging an audit miss is harder.

Why same-transaction is right:
- Atomicity: the profile change and the audit row succeed or fail together. Audit history matches reality.
- Performance: one round-trip to Postgres.
- Simplicity: the action code is the single place to find "what gets logged when X happens".

Drizzle pattern (already used in `src/lib/orders/actions.ts`):

```ts
await db.transaction(async (tx) => {
  await tx.update(userProfiles).set({ deactivatedAt: new Date(), deactivatedBy: actor.id })
    .where(eq(userProfiles.id, targetId))
  await tx.insert(auditLogs).values({
    actorId: actor.id,
    action: 'account.deactivate',
    targetId,
    metadata: { reason: 'admin_action' },
  })
})
```

For Supabase Auth mutations (which are external to Postgres), the order is:
1. Call Supabase Admin API (`updateUserById`).
2. On success, run the `db.transaction` for profile update + audit.
3. On Supabase failure: return error, no audit row.
4. On profile-tx failure after Supabase succeeded: log a warning + best-effort compensating call.

The compensating call is best-effort because nesting Supabase + Postgres in one atomic operation is impossible. For Phase 9's scale, this is acceptable.

## Bootstrap First super_admin

CONTEXT.md: "Phase 9 종료 시점에 super_admin은 최소 1명 (현재 오너 본인). 부트스트랩은 SQL seed 또는 수동 1회."

Two approaches, pick one:

### Option 1: SQL seed (recommended)

```sql
-- supabase/migrations/016_admin_account_management.sql (bottom)
-- BOOTSTRAP: insert the owner's user_profile.
-- Prerequisite: the auth.users row already exists (created via Supabase dashboard
-- or `supabase auth signup` once before running this migration).
-- Replace the email below with the owner's actual email.

insert into public.user_profiles (id, email, role, display_name, created_by)
select u.id, u.email, 'super_admin', '오너', u.id
from auth.users u
where u.email = 'OWNER_EMAIL_HERE@example.com'
on conflict (id) do nothing;
```

### Option 2: README-documented manual SQL

Document a one-time SQL block to run in Supabase Studio after the first manual sign-up:

```sql
update public.user_profiles set role = 'super_admin' where email = 'OWNER_EMAIL_HERE';
```

This requires the user to first sign up via the login form (which today calls `signInWithPassword` only — there's no signup form). For Phase 9 the cleaner answer is **Option 1**: have the owner create their `auth.users` row via Supabase dashboard once, then the seed migration registers them as super_admin.

Document the chosen bootstrap procedure in `supabase/migrations/016_*.sql` comments and link to it from the project README.

## Common Pitfalls

### Pitfall 1: Leaking service_role to the browser

**What goes wrong:** Importing `@/lib/supabase/admin` into a `'use client'` file or a Server Component that hydrates to the client. Webpack will inline `process.env.SUPABASE_SERVICE_ROLE_KEY` into the client bundle if the import path is reached from a client module.

**Why it happens:** Next.js builds a client graph and a server graph. A single accidental import (`import { createAdminClient } from '@/lib/supabase/admin'` in a `*.tsx` that has `'use client'` at the top) crosses the line.

**How to avoid:**
1. Add `import 'server-only'` as the first line of `src/lib/supabase/admin.ts`. This causes a build error if any client module imports it. [CITED: `node_modules/next/dist/docs/01-app/02-guides/data-security.md:85`]
2. Keep `createAdminClient()` calls inside `'use server'` actions only. Never call it inside a Server Component that renders Client Components and passes data through props (data passes through, not the function — but the import path can still cross).
3. Code review checklist: "Does this file import from `@/lib/supabase/admin`? If yes, does it also have `'use server'` or `'server-only'`?"

**Warning signs:** `npm run build` warning about bundle size unexpectedly increasing; client-side console errors mentioning `SUPABASE_SERVICE_ROLE_KEY`.

### Pitfall 2: `getSession()` instead of `getUser()` for authorization

**What goes wrong:** Using `supabase.auth.getSession()` to check if the user is logged in. The session is read from the cookie without contacting Supabase Auth. A malicious client could craft a cookie with a forged user ID.

**How to avoid:** Always use `getUser()` for authorization. It contacts Supabase Auth and validates the JWT signature server-side. [VERIFIED: `node_modules/@supabase/ssr/README.md:34-47`]

**Existing code is correct:** all `(auth)/...` files use `getUser()`. Maintain this in Phase 9.

### Pitfall 3: `ban_duration: 'permanent'` is invalid

**What goes wrong:** Passing `'permanent'` to `auth.admin.updateUserById(id, { ban_duration: 'permanent' })`. The string isn't a valid Go duration; Supabase responds with a parse error and no ban is applied.

**Why it happens:** The CONTEXT.md example shows `'permanent'`. This is a documentation error — the Supabase TypeScript types accept `string | 'none'` and the underlying server uses Go's `time.ParseDuration`.

**How to avoid:** Use `'876000h'` for ~100-year ban. Document this constant: `const BAN_FOREVER = '876000h' // ~100 years; Go duration string`.

[VERIFIED: `node_modules/@supabase/auth-js/dist/main/lib/types.d.ts:436-446`, `node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.d.ts:549-555`]

### Pitfall 4: middleware.ts in Next.js 16

**What goes wrong:** Creating `middleware.ts` to run auth checks. Next.js 16 deprecated this convention; the file may still work via codemod compatibility, but the framework messaging is to use `proxy.ts`.

**Phase 9 specific:** Don't add `proxy.ts` either. The project's auth gate is layout-based and works fine. Layout gating runs server-side, hits `getUser()` (validated network call), and redirects — no need for proxy.

[VERIFIED: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:11`]

### Pitfall 5: Race condition on last-super_admin demote

**What goes wrong:** Two super_admins click "demote" at the same time. Both server actions run `SELECT count(*) ... = 2`, both pass the guard, both demotes succeed → no super_admins remain.

**How to avoid:** Use `SELECT ... FOR UPDATE` on the relevant rows inside a Drizzle transaction. The lock serializes the two actions. Pattern shown in [Last super_admin Protection](#last-super_admin-protection).

### Pitfall 6: Orphan auth.users row on profile-insert failure

**What goes wrong:** `auth.admin.createUser` succeeds, then the `db.insert(userProfiles)` fails (e.g., unique-email violation if email is duplicated against existing profile). Now there's an `auth.users` row with no profile.

**How to avoid:** Compensating delete (`admin.auth.admin.deleteUser(id)`) in the catch block. Pattern shown in [Account Creation](#account-creation).

### Pitfall 7: `email` index on lowercase

**What goes wrong:** Two profiles with `Foo@x.com` and `foo@x.com` collide at the auth layer (Supabase normalizes to lowercase) but pass the Drizzle unique constraint on `text` column.

**How to avoid:** Lowercase `email` in the Zod schema before insert (`z.email().toLowerCase()` shown above). The auth layer enforces uniqueness on its end; the profile mirror should match.

### Pitfall 8: Cookie-write attempts in RSC contexts

**What goes wrong:** A Server Component calls `supabase.auth.getUser()`, the SDK tries to set refreshed cookies, and Next throws `cookies() expects a mutable context`. The empty `try/catch` in `setAll` swallows this, but if you replace it with logging you'll see noisy errors.

**How to avoid:** Keep the existing `try {} catch {}` in `src/lib/supabase/server.ts`. The cookies will be set on the next server-action invocation. This is the canonical `@supabase/ssr` pattern.

### Pitfall 9: PKCE flow vs. direct password

**What goes wrong:** The auth-callback route at `src/app/auth/callback/route.ts` exists for OAuth/PKCE flows (magic links, OAuth providers). Phase 9 does NOT use these — login is direct password (`signInWithPassword`), and account creation skips email confirmation (`email_confirm: true`).

**Phase 9 specific:** Don't break or duplicate the callback route. Just leave it. If the planner is tempted to use `inviteUserByEmail` (which uses email links), reject — CONTEXT.md says "이메일 발송 인프라 0개 유지".

### Pitfall 10: `.env.local` not loaded by Drizzle CLI

**What goes wrong:** `npx drizzle-kit migrate` reads `process.env.DATABASE_URL` but doesn't auto-load `.env.local`. Migration fails with "DATABASE_URL is required".

**How to avoid:** `drizzle.config.ts` has `import 'dotenv/config'` already [VERIFIED: line 1] — but `dotenv/config` loads `.env`, not `.env.local`. Either rename or add an explicit `dotenv.config({ path: '.env.local' })` to the config. Worth verifying during Phase 9 implementation.

## Code Examples

### Server-only marker [CITED: `node_modules/next/dist/docs/01-app/02-guides/data-security.md:85`]

```ts
// src/lib/supabase/admin.ts (Phase 9 update — add line 1)
import 'server-only'
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() { /* unchanged */ }
```

### Zod 4 import [VERIFIED: `package.json` zod ^4.3.6]

```ts
// Zod 4 default export is the namespace
import { z } from 'zod'

const Schema = z.object({
  email: z.email({ error: '올바른 이메일을 입력하세요.' }),
})
```

Note: in v4 the email validator is `z.email()` (not `z.string().email()`). Either still works, but the v4 idiom is the standalone validator. [VERIFIED: `node_modules/next/dist/docs/01-app/02-guides/authentication.md:113` shows `z.email({ error: '...' })` as the v4 pattern.]

### TanStack Table column for accounts list [VERIFIED: pattern from `(auth)/orders/columns.tsx`]

```tsx
// src/app/(auth)/admin/accounts/columns.tsx
'use client'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'

export type AccountRow = {
  id: string
  email: string
  role: 'super_admin' | 'admin'
  displayName: string | null
  createdAt: Date
  createdByEmail: string | null
  deactivatedAt: Date | null
}

export const columns: ColumnDef<AccountRow>[] = [
  { accessorKey: 'email', header: '이메일' },
  {
    accessorKey: 'role',
    header: '역할',
    cell: ({ row }) => (
      <Badge variant={row.original.role === 'super_admin' ? 'default' : 'secondary'}>
        {row.original.role === 'super_admin' ? '오너' : '관리자'}
      </Badge>
    ),
  },
  { accessorKey: 'displayName', header: '표시명' },
  {
    accessorKey: 'createdAt',
    header: '생성일',
    cell: ({ row }) => row.original.createdAt.toISOString().slice(0, 10),
  },
  { accessorKey: 'createdByEmail', header: '생성자' },
  {
    id: 'status',
    header: '상태',
    cell: ({ row }) => (
      row.original.deactivatedAt
        ? <Badge variant="destructive">비활성</Badge>
        : <Badge variant="outline">활성</Badge>
    ),
  },
  // Action column rendered as a separate component (see (auth)/orders pattern)
]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` 0.10+ | Auth-helpers deprecated mid-2024 | Already migrated in this project. Don't reintroduce auth-helpers. [VERIFIED: `node_modules/@supabase/ssr/README.md:18-23`] |
| `middleware.ts` | `proxy.ts` (Next.js 16) | Next.js 16 (late 2025) | Project doesn't use either — layout gating only. Don't add. [VERIFIED: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:11`] |
| `getSession()` for auth | `getUser()` (validated) for auth, `getSession()` for non-auth contexts | @supabase/ssr docs ~2024 | Codebase already uses `getUser()` in auth gates. [VERIFIED: 18+ call sites in `(auth)/...`] |
| `cookies()` synchronous | `await cookies()` async | Next.js 15 | Already adopted in `src/lib/supabase/server.ts`. |
| Zod 3 import via `zod/v4` | Zod 4 directly via `zod` | When project upgraded to zod ^4 | This project is on zod 4.3.6. Use `import { z } from 'zod'` (no subpath). [VERIFIED: `package.json`] |
| Bull (legacy) | BullMQ ^5 | EOL transition | Not relevant to Phase 9, but listed for completeness. |

**Deprecated/outdated (do not use):**
- `@supabase/auth-helpers-nextjs` (replaced by `@supabase/ssr`)
- `middleware.ts` file convention (replaced by `proxy.ts`; project uses neither)
- `auth.signUp` for admin-creates-user (use `auth.admin.createUser` with `email_confirm: true`)
- `inviteUserByEmail` (forbidden by CONTEXT.md — no email infrastructure)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The owner already has an `auth.users` row created via Supabase dashboard before running migration 016, OR will create one before applying the seed | Bootstrap First super_admin | The seed insert won't match any row; bootstrap fails silently. Mitigated by using `where ... = OWNER_EMAIL` pattern. |
| A2 | The recommended `'876000h'` ban duration is acceptable as "permanent" given the use case (small team, manual reactivation) | Decision: Deactivation Mechanism | If owner expects literal forever, document that this is 100 years, after which the ban auto-lifts. |
| A3 | `db.transaction` rollback on profile-insert failure correctly nullifies the audit row | audit_logs Write Pattern | If for some reason the audit insert succeeded but profile failed, the rollback handles it. Trust postgres-js + Drizzle here — verified pattern in existing actions. |
| A4 | Drizzle's `.for('update')` row lock is sufficient for the last-super_admin race; we don't need a serializable transaction isolation level | Last super_admin Protection | At small scale (≤ 5 super_admins), `FOR UPDATE` with default `READ COMMITTED` is enough. If concurrency grows, escalate to `SERIALIZABLE`. |
| A5 | The Zod 4 idiom `z.email({ error: '...' })` is the correct call signature in 4.3.6 | Code Examples | If incorrect, fall back to `z.string().email({ message: '...' })` (Zod 3-compatible). Verify during implementation by running a quick test. |
| A6 | `service_role` JWT continues to bypass RLS in `@supabase/supabase-js` 2.101.1 | Supabase RLS for user_profiles | This is a long-standing Supabase guarantee. Very low risk. |
| A7 | `supabase.auth.updateUser({ password })` from a server action with the cookie-bound (anon-key) client correctly authorizes via the user's JWT | Self-Service Password Change | Standard Supabase pattern. If broken, fall back to admin client + `updateUserById`, but that loses the "user authenticated themselves" semantic. |
| A8 | The handwritten `dotenv/config` in `drizzle.config.ts` loads `.env` not `.env.local`; needs verification during phase | Pitfall 10 | If `.env.local` is the only file with `DATABASE_URL`, drizzle-kit commands fail until fixed. Quick to detect and fix. |

## Open Questions

1. **Where exactly does the password-change form live?**
   - What we know: CONTEXT.md mentions `/settings` or a separate route. `(auth)/settings/page.tsx` is a placeholder; `(auth)/settings/company/` and `(auth)/settings/marketplaces/` exist.
   - What's unclear: whether to add a `(auth)/settings/account/page.tsx` sub-route or fold it into the existing settings landing.
   - Recommendation: planner picks. Sub-route is cleaner and matches the `settings/company` precedent.

2. **Pagination on the accounts list?**
   - What we know: TanStack Table is in use, but for orders (high cardinality). Account count will likely be < 20.
   - What's unclear: pagination required or just a scrolling table.
   - Recommendation: skip pagination for Phase 9; list all rows. Add later if needed.

3. **Should the bootstrap super_admin email be configurable?**
   - What we know: CONTEXT.md says "현재 오너 본인". The project has one owner.
   - What's unclear: whether the seed should hard-code the email or read from an env var.
   - Recommendation: hard-code in the migration with a comment instructing the reader to update it before running. Migrations are versioned; future ports of this project can edit the file.

4. **Email-change support?**
   - Out of scope per CONTEXT.md. If the owner mistypes an email during create, the only fix is delete-and-recreate (which is hard-delete and also out of scope) or a future phase. Document this expectation in the create dialog.

5. **What happens to in-flight server-action calls when an account is mid-deactivation?**
   - What we know: server actions re-validate via `getUser()`; once `ban_duration` is set, future `getUser()` calls will fail (eventually — within JWT TTL).
   - What's unclear: actions running concurrently with the deactivation. Worst case: a deactivated user fires an order-status change in the same second they're deactivated.
   - Recommendation: acceptable for Phase 9. Per-action super_admin checks aren't required for non-admin features; admin actions explicitly check role + deactivation state.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build, runtime, drizzle-kit | ✓ | ≥ 22.0.0 (engines) | — |
| `next` | Framework | ✓ | 16.2.2 | — |
| `react` / `react-dom` | UI | ✓ | 19.2.4 | — |
| `@supabase/ssr` | Cookie-bound client | ✓ | 0.10.0 | — |
| `@supabase/supabase-js` | Admin client | ✓ | 2.101.1 | — |
| `drizzle-orm` + `drizzle-kit` | Schema + migrations | ✓ | 0.45.2 / 0.31.10 | — |
| `postgres` | DB driver | ✓ | 3.4.8 | — |
| `zod` | Server-side validation | ✓ | 4.3.6 | — |
| `@base-ui/react` | Dialog primitive | ✓ | 1.3.0 | Hand-rolled modal (existing pattern) |
| `@tanstack/react-table` | Account list | ✓ | 8.21.3 | — |
| `sonner` | Toasts | ✓ | 2.0.7 | — |
| `lucide-react` | Icons | ✓ | 1.7.0 | — |
| Supabase project (Postgres + Auth) | Auth/DB | ✓ (assumed; existing project) | — | — |
| `INITIAL_USER_PASSWORD` env var | Account create / reset | ❓ Not yet set | — | Default `eksrnr2125@` per CONTEXT.md, but explicit env preferred |
| `SUPABASE_SERVICE_ROLE_KEY` env var | Admin client | ✓ (already used by `src/lib/supabase/admin.ts`) | — | — |
| `DATABASE_URL` env var | Drizzle | ✓ (already used by `src/lib/db/index.ts`) | — | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- `INITIAL_USER_PASSWORD` env var: planner should add a `assertEnvVar()` helper that throws at startup if the env var is missing or shorter than 8 chars. The default `eksrnr2125@` should NOT be hard-coded in source — load from env exclusively, fail loudly if absent.

**Phase 9 must add:**
- `import 'server-only'` to `src/lib/supabase/admin.ts` (1-line edit).
- `INITIAL_USER_PASSWORD=eksrnr2125@` to `.env.local` (and document in `.env.example` or README).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (jsdom env, globals enabled) |
| Quick run command | `npx vitest run --reporter=basic <file>` |
| Full suite command | `npx vitest run` |

[VERIFIED: `package.json`, `vitest.config.ts`, `tests/` directory listing]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | createAccount happy path: zod parse, admin.createUser, profile insert, audit insert | unit (mocked Supabase admin + db) | `npx vitest run tests/admin/accounts.test.ts` | ❌ Wave 0 |
| ADMIN-01 | createAccount failure path: profile insert fails → admin.deleteUser called | unit | same file | ❌ Wave 0 |
| ADMIN-02 | user_profiles + audit_logs schema applied; FK to auth.users in place | integration (drizzle introspect or migration assert) | manual via `npx drizzle-kit migrate` + SQL check | ❌ Wave 0 (manual) |
| ADMIN-03 | Last super_admin demote refused | unit (transaction with seeded super_admin count = 1) | `npx vitest run tests/admin/role-change.test.ts` | ❌ Wave 0 |
| ADMIN-03 | Self-deactivate refused | unit | `npx vitest run tests/admin/deactivate.test.ts` | ❌ Wave 0 |
| ADMIN-03 | Reset password calls admin.updateUserById with INITIAL_USER_PASSWORD | unit | `npx vitest run tests/admin/password-reset.test.ts` | ❌ Wave 0 |
| ADMIN-04 | Self password change calls auth.updateUser, audit row inserted | unit | `npx vitest run tests/admin/self-password.test.ts` | ❌ Wave 0 |
| ADMIN-05 | Layout redirects deactivated profile to /login | integration (RSC test or smoke E2E) | manual smoke OR `npx vitest run tests/auth/deactivated-redirect.test.tsx` | ❌ Wave 0 (manual smoke acceptable) |
| ADMIN-06 | Each mutating action writes one audit_logs row | unit | covered in tests above | — |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/admin/<file-touched>` (~5s).
- **Per wave merge:** `npx vitest run tests/admin/` (~30s).
- **Phase gate:** `npx vitest run` full suite green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `tests/admin/` directory — does not exist; create.
- [ ] `tests/admin/accounts.test.ts` — covers ADMIN-01.
- [ ] `tests/admin/role-change.test.ts` — covers ADMIN-03 last-super_admin guard.
- [ ] `tests/admin/deactivate.test.ts` — covers ADMIN-03 self-deactivate guard + ban_duration value.
- [ ] `tests/admin/password-reset.test.ts` — covers ADMIN-03 reset path.
- [ ] `tests/admin/self-password.test.ts` — covers ADMIN-04.
- [ ] `tests/admin/conftest`-equivalent — shared mock factory for `createAdminClient` and `db.transaction` (look at `tests/helpers/` first; reuse if a similar mock exists).
- [ ] No new framework install needed — Vitest 4.1.2 already installed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (managed). No custom password hashing. `email_confirm: true` documents the conscious decision to skip email verification (matches owner-creates-account flow). |
| V3 Session Management | yes | `@supabase/ssr` cookies (HttpOnly, Secure, SameSite per Supabase defaults). JWT TTL is Supabase project setting; default 1 hour. Refresh tokens single-use. [VERIFIED: `node_modules/@supabase/ssr/README.md:51-56`] |
| V4 Access Control | yes | Server-action role check via `assertSuperAdmin()`. RLS on `user_profiles` as defense-in-depth. Layout gate on `/auth` routes. |
| V5 Input Validation | yes | Zod 4.3.6 server-side parse before any DB / Auth call. Email lowercased + trimmed. Display name length-capped. |
| V6 Cryptography | partial | Bcrypt password hashing happens inside Supabase Auth — never in app code. Note: bcrypt has a 72-byte limit; cap password input at 72 chars in Zod schema. |
| V7 Error Handling & Logging | yes | `audit_logs` table records every privileged action with actor, target, action, metadata. Server actions return generic Korean error messages to UI; detailed errors stay server-side. |
| V8 Data Protection | yes | Service-role key gated by `'server-only'` import marker. `INITIAL_USER_PASSWORD` env var lives outside source control. |

### Known Threat Patterns for Next.js 16 + Supabase + Drizzle

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Service-role key leaking to client bundle | Information Disclosure | `import 'server-only'` in admin client; never import from `'use client'` files. |
| Forged session cookie | Spoofing | Use `getUser()` (validates JWT) not `getSession()` (cookie-only). |
| Privilege escalation via bypassed role check | Elevation of Privilege | Centralize via `assertSuperAdmin()`; defense-in-depth via RLS `is_super_admin()` policy. |
| Race condition on last-super_admin demote | Tampering | `SELECT ... FOR UPDATE` inside Drizzle transaction. |
| Audit log tampering | Repudiation / Tampering | audit_logs writes inline in same transaction as state change. No reader UI in Phase 9 means no privileged update vector. Add RLS later. |
| Brute-force login | Denial of Service / Spoofing | Supabase Auth rate-limits sign-in attempts at the auth server. No app-side mitigation needed. Document Supabase rate-limit settings in project README. |
| SQL injection via Drizzle | Tampering | Drizzle parameterizes all queries; `sql` template tag is the only raw escape — and it's a tagged template, also parameterized. |
| Cross-tenant data leakage on user_profiles | Information Disclosure | RLS self-row-only for non-super_admin. Service-role bypass only inside server actions. |
| Email confirmation bypass | Spoofing | Owner-creates-account flow inherently requires owner trust of staff; `email_confirm: true` is the documented design choice. |

## Sources

### Primary (HIGH confidence)

- **In-tree code (read directly):**
  - `src/lib/supabase/{server,client,admin}.ts`
  - `src/lib/db/{index,schema}.ts`
  - `src/app/(auth)/layout.tsx`
  - `src/app/(public)/login/{page,actions}.tsx`
  - `src/app/(auth)/admin/dev-log/{page,actions,dev-log-form,delete-button}.tsx`
  - `src/app/(auth)/orders/{page,actions,hold-dialog,data-table,columns}.tsx`
  - `src/app/(auth)/admin/accounts/page.tsx`
  - `src/app/auth/callback/route.ts`
  - `src/components/ui/{select,input}.tsx`
  - `src/lib/orders/actions.ts`, `src/lib/inventory/actions.ts` (for `db.transaction` patterns)
  - `supabase/migrations/00001_core_schema.sql`, `015_add_dev_log_entries.sql`
  - `drizzle.config.ts`, `vitest.config.ts`, `components.json`, `package.json`
- **Vendor docs (read directly):**
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` — `proxy.ts` rename
  - `node_modules/next/dist/docs/01-app/02-guides/authentication.md` — Auth pattern (Server Actions + Zod + getCurrentUser DAL)
  - `node_modules/next/dist/docs/01-app/02-guides/data-security.md` — `server-only` marker, DAL pattern
  - `node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.d.ts` — Admin API signatures + JSDoc examples
  - `node_modules/@supabase/auth-js/dist/main/lib/types.d.ts` — `AdminUserAttributes.ban_duration` typing
  - `node_modules/@supabase/ssr/README.md` — `getUser()` vs `getSession()` vs `getClaims()`, refresh-token semantics
  - `node_modules/@base-ui/react/dialog/index.parts.d.ts`, `dialog/root/DialogRoot.d.ts` — Dialog API surface

### Secondary (MEDIUM confidence)

- Supabase RLS docs (https://supabase.com/docs/guides/database/postgres/row-level-security) — pattern of `auth.uid()` + security definer helper. Cross-verified against existing migrations in this project.
- drizzle-kit docs (https://orm.drizzle.team/kit-docs/overview) — `generate` and `migrate` semantics. Cross-verified against existing `_journal.json`.

### Tertiary (LOW confidence)

- None. All claims in this research are backed by direct code inspection or vendor documentation in `node_modules/`.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified via `node_modules/<pkg>/package.json`.
- Architecture: HIGH — patterns extracted from in-tree code; nothing inferred.
- Pitfalls: HIGH for items #1, #2, #3, #4, #5, #6, #7, #8, #9 (vendor docs or codebase verification). MEDIUM for #10 (need to verify `dotenv/config` behavior during implementation).
- Schema/migration plan: HIGH — matches existing project pattern.
- RLS policy SQL: HIGH — pattern lifted from `00001_core_schema.sql` + Supabase canonical patterns.

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (30 days; stable area). Sooner if Next.js 16 minor releases introduce auth-flow changes — check `node_modules/next/dist/docs/01-app/02-guides/authentication.md` modification time before re-researching.
