# Local Market Agent

This project can run RPA marketplaces from a staff PC instead of Railway.

## What It Does

- Vercel keeps running the SaaS web app.
- Supabase stores orders, credentials, job logs, and results.
- Redis stores pending RPA jobs.
- This local agent watches the Redis queue and runs Playwright on the local PC.

When a staff member clicks order collection or invoice upload in SaaS, the SaaS creates a job. The PC running this agent picks up that job and performs the marketplace browser work.

## Start

Double-click:

```text
start-market-agent.cmd
```

Keep the terminal window open while using RPA collection or invoice upload.

## Requirements

- Node.js 22 or newer
- `.env.local` in the project root
- `REDIS_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` set in `.env.local`
- Marketplace RPA credentials saved in SaaS marketplace settings

## Current RPA Marketplaces

- onchannel
- domechango
- tobizon
- banana-b2b
- domesin
- ohouse
- gs-shop
- always

## Operating Rules

- Only one PC should run the same marketplace agent at a time.
- Multiple staff can click SaaS buttons from different PCs.
- The actual marketplace login happens from the PC running this agent.
- If this PC sleeps, shuts down, or loses internet, RPA jobs will stop.
- Leave Railway auto deploy disabled while Vercel is the web deployment target.
