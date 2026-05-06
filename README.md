# Funtastic SaaS

Funtastic SaaS is an internal ecommerce operations dashboard for order management, product and inventory mapping, marketplace sync, and shipping/export workflows.

## Stack

- Next.js 16
- React 19
- TypeScript
- Supabase
- Drizzle ORM
- Tailwind CSS
- Railway deployment

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build

```bash
npm run build
```

## Production

Production is deployed on Railway from GitHub `main`.

Production URL:

- https://funtastic-saas-production.up.railway.app/dashboard

## Admin Account Policy

- All operational data is shared across admin accounts.
- `admin123` is the canonical workspace owner.
- Other admin accounts are for identity, permissions, and audit tracking only.
- Account switching must not change orders, products, inventory, mappings, marketplace connections, shipping templates, company settings, or shipping/export behavior.
- Use `getWorkspaceUserId(user.id)` for operational data queries and writes.

## Important Docs

- `AGENTS.md`: Codex/agent development rules.
- `CLAUDE.md`: Legacy Claude context.
- `.planning/STATE.md`: Current project state and continuity notes.
