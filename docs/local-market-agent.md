# Local Market Agent

This project can run marketplace background work from a staff PC instead of Railway.

## What It Does

- Vercel keeps running the SaaS web app.
- Supabase stores orders, credentials, job logs, and results.
- Redis stores pending API, invoice, and RPA jobs.
- This local agent starts both the API worker and the RPA worker on the local PC.

When a staff member clicks order collection or invoice upload in SaaS, Vercel creates a job and returns quickly. The PC running this agent picks up that job and performs the marketplace work.

The local agent does not create automatic 5-minute collection schedules. It only processes jobs created from SaaS buttons.

## Start

For a visible test run, double-click:

```text
start-market-agent.cmd
```

Keep the terminal window open while using order collection or invoice upload.

For normal use without a terminal window, run this once:

```text
install-local-agent-task.cmd
```

This registers a Windows scheduled task named `FuntasticMarketAgent`.
After that, the local agent starts automatically in the background whenever this Windows user logs in.

To stop the background agent:

```text
stop-local-agent-task.cmd
```

To remove the auto-start task:

```text
uninstall-local-agent-task.cmd
```

Logs are written to:

```text
logs/market-agent.log
```

## Requirements

- Node.js 22 or newer
- `.env.local` in the project root
- `REDIS_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` set in `.env.local`
- Marketplace API/RPA credentials saved in SaaS marketplace settings

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
- The actual marketplace API/RPA work happens from the PC running this agent.
- If this PC sleeps, shuts down, or loses internet, queued marketplace jobs will stop.
- Leave Railway auto deploy disabled while Vercel is the web deployment target.
