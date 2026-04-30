# Phase 10: 마켓플레이스 스크래핑 봇 - Context

**Gathered:** 2026-04-29
**Status:** Infrastructure scaffolded — first scraper implementation pending
**Source:** Direct decisions

## Phase Boundary

This phase delivers a Playwright-based scraping system for marketplaces that don't expose a public API (에이블리, 오늘의집, etc.). End state:
- A separate `scrape-worker` service runs Chromium on Railway
- Scrapers log into seller portals using stored credentials
- Orders/claims are scraped on a schedule (or on-demand) and persisted to DB
- Tracking numbers are uploaded back to seller portals via UI automation
- Sessions are persisted across runs to avoid repeated logins

This is the **infrastructure plan** (10-A). Per-marketplace scrapers ship in subsequent plans (10-B+).

## Locked Decisions

### Architecture
- **Separate worker process** — `scrape-worker` is its own Railway service (own Dockerfile), so Chromium memory/CPU doesn't impact the API/invoice workers
- **Dockerfile-based** (not nixpacks) — uses `mcr.microsoft.com/playwright:v1.59.1-jammy` for guaranteed Chromium + system-deps compatibility
- **Local dev**: `npm run scrape-worker:dev` (Playwright bundled Chromium)

### Library
- **Playwright** (not Puppeteer / Selenium) — Microsoft-maintained, modern API, built-in retry, supports network mocking for tests
- Single shared Browser instance; one Context per scrape call (isolated cookies)

### Credentials
- Store seller portal email/password in Supabase Vault (same pattern as existing API credentials, different prefix `scrape_*`)
- `storageState` (cookies + localStorage) persisted after each successful login → next call re-uses session, falls back to re-login on expiry
- Per-user, per-connection credentials (so different stores can have different logins)

### Queue / Scheduling
- New BullMQ queue: `marketplace-scrape`
- Job types: `scrape-orders`, `scrape-claims`, `upload-invoice`
- Concurrency: 1 per worker (Chromium heavy)
- Rate limit: 1 job per 5 seconds (avoid bot detection patterns)
- Initial polling: every 30 minutes per active connection (configurable)

### Out of Scope (Phase 10-A)
- Per-marketplace scraper implementations (those are 10-B+)
- CAPTCHA solving (handle case-by-case in later plans)
- 2FA / OTP flows (later)
- Visual UI for credential entry (use API-credential UI initially)
- Playwright Stealth plugins (add only if detected as bot)

## Files Created (10-A)

```
src/scrapers/
  ├── types.ts          — MarketplaceScraper interface, ScraperCredentials, ScrapeJobData
  ├── browser.ts        — Shared Chromium browser + context factory
  ├── credentials.ts    — Supabase Vault store/read for scraper creds + storageState
  ├── registry.ts       — marketplaceId → scraper instance map
  ├── register.ts       — Side-effect import (empty placeholders for now)
  └── worker.ts         — BullMQ worker entrypoint (npm run scrape-worker)

Dockerfile.scraper      — Container spec for Railway deployment

package.json:
  + scrape-worker:start
  + scrape-worker:dev

src/lib/jobs/queues.ts:
  + getMarketplaceScrapeQueue()
```

## Railway Setup (manual, one-time)

1. Railway dashboard → funtastic-saas project → **+ New Service**
2. **Source**: this repo
3. **Build → Builder**: Dockerfile
4. **Build → Dockerfile path**: `Dockerfile.scraper`
5. **Deploy → Start command**: leave empty
6. **Variables**: copy from existing `worker` service (DATABASE_URL, REDIS_URL, Supabase keys, INITIAL_USER_PASSWORD)
7. Deploy → wait for build (5-10 min, large image)

## Phased Rollout (sub-plans)

| Plan | Marketplace | Estimated effort |
|------|------------|-----------------|
| 10-A | Infrastructure (this) | 0.5 day |
| 10-B | 에이블리 (Ably) — login + orders + invoice | 2-3 days |
| 10-C | 오늘의집 (Ohouse) | 1-2 days |
| 10-D+ | Per-marketplace as needed | 1-2 days each |

## Open Questions / Risks

1. **Bot detection** — first 1-2 scrapers may get blocked. Mitigation: realistic user agent, ko-KR locale, delays between actions
2. **Page structure changes** — selectors break when marketplace updates UI. Mitigation: monitor scrape-worker error rate, alert on spike
3. **CAPTCHA** — some marketplaces (e.g. 네이버 신뢰도 낮을 때) trigger CAPTCHA. Need fallback flow (manual completion?)
4. **Memory usage on Hobby plan** — Chromium peaks at ~700MB. Monitor billing; switch to Pro ($20 fixed) if costs exceed
5. **Concurrent scrapes from multiple users** — current design is single-tenant (one user's marketplaces). Multi-tenant needs queue partitioning later

---

*Phase: 10-marketplace-scraping-bot*
*Infrastructure scaffolded: 2026-04-29*
