# Pitfalls Research

**Domain:** Korean e-commerce marketplace integration SaaS (30 marketplaces, 500-2000 orders/day)
**Researched:** 2026-04-03
**Confidence:** MEDIUM-HIGH (Korean marketplace APIs verified via official docs; general integration patterns well-documented; some marketplace-specific details extrapolated from Coupang/Naver patterns)

## Critical Pitfalls

### Pitfall 1: Marketplace Authentication Diversity and Silent Expiry

**What goes wrong:**
Each Korean marketplace uses a different authentication scheme. Coupang uses HMAC-SHA256 signatures (time-sensitive, expires in 5 minutes per request). Naver Commerce API uses OAuth 2.0 with token refresh. 11st, Gmarket/Auction (eBay Korea) have their own token systems. Some smaller marketplaces (Onerclean, Onchannel) may use simple API keys with fixed expiry dates. When a token or key expires silently, order collection stops for that marketplace -- and the seller may not notice for hours, missing orders and delayed shipments.

**Why it happens:**
Developers build authentication for the first 2-3 marketplaces, assume the pattern generalizes, then discover marketplace #7 uses a completely different auth model. They also fail to build monitoring for auth failures vs. "zero orders" (which looks the same from the outside).

**How to avoid:**
- Design an authentication adapter interface from day one with explicit support for: HMAC per-request signing (Coupang), OAuth 2.0 with refresh tokens (Naver), static API keys with manual rotation, and session-based auth with periodic re-login.
- Build a "marketplace health dashboard" that distinguishes between "0 orders collected" and "auth failed" -- these are different states. Alert on auth failures immediately.
- Store token expiry timestamps and proactively refresh before expiry. For Coupang HMAC, generate signatures fresh per-request (they last only 5 minutes).
- Log every auth failure with marketplace identifier, error code, and timestamp.

**Warning signs:**
- A marketplace that previously had orders suddenly shows zero orders for several hours
- 401/403 errors appearing in logs without anyone noticing
- No automated alerting on marketplace connectivity status

**Phase to address:**
Phase 1 (Core Architecture) -- the adapter pattern and health monitoring must be foundational, not bolted on.

---

### Pitfall 2: Order Status Model Mismatch Across Marketplaces

**What goes wrong:**
Each marketplace defines order lifecycle differently. Coupang uses statuses like "결제완료" (Payment Complete), "상품준비중" (Preparing), delivery statuses. Naver has its own status codes through Commerce API. Some marketplaces have 5 statuses, others have 12. Partial shipments, split orders, combined orders, and marketplace-initiated cancellations all behave differently per platform. Building a "one size fits all" order status model either loses information or creates impossible mapping bugs.

**Why it happens:**
The natural instinct is to create a "universal" order status enum and map everything to it. This works for the first 3 marketplaces, then breaks when marketplace #4 has a status concept that doesn't fit (e.g., Coupang's "직권취소" discretionary cancellation, or a marketplace that allows partial cancellation at item level).

**How to avoid:**
- Store the raw marketplace status alongside your normalized status. Never discard the original.
- Design the internal status model to be a superset: `PENDING_PAYMENT`, `PAID`, `PREPARING`, `SHIPPED`, `DELIVERING`, `DELIVERED`, `CANCELLED`, `PARTIALLY_CANCELLED`, `RETURN_REQUESTED`, `RETURNED`, `EXCHANGE_REQUESTED`. But accept that some marketplaces will have statuses that don't map cleanly.
- Each marketplace adapter must own its status mapping, and the mapping must be explicitly tested per marketplace.
- Build a "status mapping audit" that flags unmapped statuses rather than silently dropping them.

**Warning signs:**
- Orders stuck in unexpected states in the dashboard
- "Unknown status" errors appearing in logs
- Marketplace-specific statuses being silently coerced into wrong normalized states
- Missing orders that exist on the marketplace but not in the system

**Phase to address:**
Phase 1 (Data Model Design) -- the order schema must accommodate this from the start. Retrofitting status models is extremely painful.

---

### Pitfall 3: Invoice/Tracking Number Upload Failures Without Retry and Reconciliation

**What goes wrong:**
After processing an order and getting a tracking number from the carrier, the system must upload that tracking number back to each marketplace. This is the most failure-prone step in the entire pipeline: marketplace APIs go down, rate limits get hit during batch uploads, network timeouts occur, and tracking numbers get rejected for format reasons (different carriers have different formats, and each marketplace validates differently). If an upload fails and there is no retry mechanism, the marketplace shows the order as "not shipped" even though it was -- leading to penalties, bad seller ratings, and customer complaints.

**Why it happens:**
Developers treat tracking upload as a simple POST request. They don't account for: partial batch failures (50 out of 200 succeed, 150 fail), marketplace-specific validation rules for tracking numbers, rate limits during peak hours (Coupang: 10 req/sec, Naver: 2 req/sec), or the need for idempotent retries (uploading the same tracking number twice shouldn't create duplicate records).

**How to avoid:**
- Implement a persistent job queue (not in-memory) for tracking uploads. Each upload is a job with: marketplace, order ID, tracking number, carrier code, attempt count, last error.
- Exponential backoff with jitter for retries. Max 5 retries over 30 minutes, then alert.
- Idempotent uploads: check if tracking was already accepted before retrying.
- Build a reconciliation view: "Orders shipped but tracking not confirmed by marketplace" -- this is the critical dashboard for operations.
- Respect per-marketplace rate limits explicitly. Coupang allows 10 req/sec, Naver allows 2 req/sec. Use per-marketplace rate limiters, not a global one.

**Warning signs:**
- Tracking upload success rate dropping below 99%
- Growing backlog of "shipped but not uploaded" orders
- Seller receiving penalty notices from marketplaces about late shipment confirmation
- Retry queue growing without clearing

**Phase to address:**
Phase 2 (Order Processing + Shipping) -- this is part of the core order workflow, but depends on the queue infrastructure from Phase 1.

---

### Pitfall 4: Inventory Sync Race Conditions Causing Overselling

**What goes wrong:**
When selling the same product on 30 marketplaces, a sale on Coupang must decrement inventory on all other 29 marketplaces. With marketplace API latency (some take 1-3 minutes to process inventory updates), there is a window where the same last item can be sold on multiple marketplaces simultaneously. This is the classic overselling problem, and at 500-2000 orders/day across 30 channels, it will happen regularly.

**Why it happens:**
The "read stock, check if > 0, decrement" pattern has an inherent race condition. Even with a centralized database, the round-trip to update all 30 marketplace APIs creates a window of inconsistency. Some marketplaces (like eBay-derived Korean marketplaces) have 1-3 minute latency for inventory updates.

**How to avoid:**
- Use pessimistic locking or atomic decrements in the central inventory database. Never check-then-update in application code.
- Implement "safety stock" buffers: if you have 5 units, list 3 on marketplaces. The buffer absorbs the race condition window.
- Use marketplace-side inventory reservation if available (some Korean marketplaces support this).
- Prioritize inventory updates to high-volume channels (Coupang, Naver) over low-volume ones.
- Accept that some overselling is inevitable and build a graceful cancellation workflow for when it happens.
- Track "available to promise" (ATP) separately from "physical stock" and "committed stock."

**Warning signs:**
- Orders being placed for items with 0 or negative inventory in the central system
- Increasing rate of seller-initiated cancellations due to stock-outs
- Inventory counts drifting between marketplace listings and central system

**Phase to address:**
Phase 3 (Inventory Management) -- but the database schema for atomic inventory operations should be designed in Phase 1.

---

### Pitfall 5: Treating All 30 Marketplaces as Equal Priority

**What goes wrong:**
Attempting to integrate all 30 marketplaces simultaneously, or in random order, leads to paralysis. Each marketplace has different API quality, documentation quality, and business importance. Some have well-documented REST APIs (Coupang, Naver), others have SOAP APIs or poorly documented endpoints. Some represent 50% of order volume, others represent 0.5%.

**Why it happens:**
The project spec says "30 marketplaces" so the team tries to build a generic system that handles all 30 from day one. This delays shipping anything usable because the abstraction layer becomes overly complex trying to accommodate every edge case.

**How to avoid:**
- Tier the marketplaces by order volume and API maturity:
  - **Tier 1** (integrate first): Coupang, Naver SmartStore -- highest volume, best APIs
  - **Tier 2** (next): 11st, Gmarket/Auction, CJ OnStyle -- significant volume
  - **Tier 3** (then): Remaining marketplaces -- lower volume, variable API quality
- Ship with Tier 1 working end-to-end before starting Tier 2. This validates the adapter pattern with real production traffic.
- Build the adapter interface based on Tier 1 learnings, then refine it when Tier 2 reveals new patterns.
- Some marketplaces may not have APIs at all and require screen scraping or Excel import/export -- identify these early and handle them separately.

**Warning signs:**
- No marketplace integration is fully working 3 months into development
- The "generic marketplace adapter" keeps getting refactored
- Equal development time being spent on a marketplace with 2 orders/day vs. one with 500 orders/day

**Phase to address:**
Phase 1 planning -- marketplace prioritization should be a planning decision, not an implementation discovery.

---

### Pitfall 6: Excel File Handling Disasters (Encoding, Size, Format)

**What goes wrong:**
Korean e-commerce heavily relies on Excel files for bulk operations (tracking uploads, product registration, order exports). Korean Excel files frequently use EUC-KR encoding instead of UTF-8. Files may contain mixed encodings. Large files (10,000+ rows) cause browser timeouts or memory issues. Different marketplaces export slightly different Excel formats even for the same data. Some use .xls (BIFF), others .xlsx (OOXML), others .csv with varying delimiters.

**Why it happens:**
About 3.8% of Korean web pages still use EUC-KR encoding, and many Korean enterprise systems export in EUC-KR. Developers test with small UTF-8 files and deploy to production where sellers upload 50MB EUC-KR Excel files with 20,000 rows. The system either crashes, produces mojibake (garbled text), or silently corrupts data.

**How to avoid:**
- Always detect encoding before parsing. Use a library like `jschardet` or `chardet` to detect EUC-KR vs UTF-8 vs CP949.
- Support .xls, .xlsx, and .csv formats. Use `xlsx`/`exceljs` for parsing, not custom parsers.
- Process large files server-side with streaming, not in the browser. Show upload progress.
- Validate parsed data before import: check that Korean characters rendered correctly, that required fields are present, that tracking number formats match expected patterns.
- Provide a preview step: show the first 10 rows after parsing so the user can verify encoding is correct before committing the import.
- Set explicit file size limits (e.g., 50MB) and row limits (e.g., 50,000 rows) with clear error messages.

**Warning signs:**
- Korean text appearing as "????" or garbled characters after import
- Browser hanging or tab crashing during Excel upload
- Users reporting that "some rows were skipped" without explanation
- Tracking numbers silently truncated or reformatted

**Phase to address:**
Phase 2 (Invoice/Tracking Upload) for tracking Excel uploads, Phase 3 (Product Management) for product Excel imports.

---

### Pitfall 7: No Graceful Degradation When a Marketplace API Goes Down

**What goes wrong:**
Korean marketplace APIs experience downtime, especially during sale events (e.g., Coupang's mega-sale days, Naver's shopping festivals). When one marketplace API is down, the entire order collection pipeline freezes because the system processes marketplaces sequentially, or a single marketplace failure crashes the batch process.

**Why it happens:**
Developers build a `collectAllOrders()` function that loops through marketplaces sequentially. When one throws an error, the entire function fails. Or they use a single database transaction for all marketplace syncs, so one failure rolls back everything.

**How to avoid:**
- Process each marketplace independently. A failure on Coupang should not affect Naver order collection.
- Implement circuit breaker pattern per marketplace: after N consecutive failures, stop trying for M minutes, then retry. This prevents hammering a down API and wasting rate limit budget.
- Track per-marketplace health status: `HEALTHY`, `DEGRADED` (high error rate), `DOWN` (circuit open).
- Display marketplace health prominently on the dashboard so the operator knows which channels are affected.
- Queue missed collection windows for retry: if Coupang was down at 10:00 AM collection, retry at 10:05 AM.

**Warning signs:**
- One marketplace failure causing all marketplace syncs to stop
- No visibility into which marketplaces are currently responsive
- Orders being missed during marketplace downtime windows

**Phase to address:**
Phase 1 (Core Architecture) -- circuit breakers and independent processing must be architectural decisions.

---

### Pitfall 8: Storing Marketplace API Credentials Insecurely

**What goes wrong:**
The system stores API keys, OAuth tokens, and HMAC secrets for 30 marketplaces. If these credentials are stored in plaintext in the database, a single SQL injection or database breach exposes all seller accounts on all marketplaces. An attacker could place fraudulent orders, change pricing, or steal customer data across every connected marketplace.

**Why it happens:**
During rapid development, credentials get stored as plain text columns in the database. "We'll encrypt them later" never happens. The blast radius is enormous: one breach compromises 30 marketplace accounts simultaneously.

**How to avoid:**
- Use Supabase Vault (built on libsodium AEAD encryption) for storing all marketplace credentials. Vault encrypts at rest and signs data to prevent forgery.
- Never expose decrypted credentials to the client/browser. All marketplace API calls must happen server-side.
- Implement per-marketplace credential isolation: each marketplace's credentials are stored separately, accessed via RPC functions, never via direct table access.
- Disable Supabase statement logging when inserting secrets (INSERT statements get logged by default, which would log plaintext credentials).
- Rotate credentials on a schedule and track last-rotation dates.
- Use Row Level Security (RLS) to ensure sellers can only access their own marketplace credentials.

**Warning signs:**
- Marketplace credentials visible in any log output
- Credentials stored in plaintext columns alongside other order data
- No audit trail for credential access
- Service role key exposed in frontend code

**Phase to address:**
Phase 1 (Foundation) -- credential storage architecture must be secure from the first marketplace integration.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Polling instead of webhooks for order collection | Simpler to implement, works with all marketplaces | Higher API usage, delayed order visibility, rate limit pressure | Always for MVP -- most Korean marketplaces don't reliably support webhooks anyway |
| Single-threaded marketplace sync (sequential) | Simpler error handling, no concurrency issues | 30 marketplaces x 5 sec each = 2.5 min collection cycle | Only during Phase 1 with 2-3 marketplaces. Must parallelize by Tier 2 |
| Hardcoded marketplace-specific logic in adapters | Faster initial development for first few marketplaces | Maintenance nightmare at 10+ marketplaces, duplicated logic | Only for the first 2 integrations to discover patterns before abstracting |
| Storing raw marketplace responses as JSON blobs | Preserves all data, no schema migration needed | Hard to query, no indexes, growing storage costs | Good practice for audit trail. Bad if used as primary data source |
| Skipping marketplace API sandbox/test environments | Faster iteration against real APIs | Risk of creating real orders/shipments during testing, getting accounts flagged | Never -- always use sandbox first where available (Coupang and Naver have sandboxes) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Coupang WING API | Reusing HMAC signatures across requests. Signatures expire in 5 minutes and are request-specific (include method + path + query) | Generate fresh HMAC signature per request. Include datetime, method, path, and query string in the message |
| Coupang rate limits | Ignoring the 10 req/sec per vendor ID limit, especially during batch operations | Implement token bucket rate limiter per marketplace. Queue requests and process within limits |
| Naver Commerce API | Not handling the 2 req/sec rate limit. Burst Max borrows from next second's budget but cannot be used continuously | Use strict rate limiting with 2/sec baseline. Implement backoff when receiving 429 responses |
| Naver Commerce API | OAuth tokens expiring without proactive refresh | Store token expiry time, refresh 5 minutes before expiry. Handle refresh failures gracefully |
| Naver Commerce API | Dormant API access (API goes dormant after period of non-use, requiring manual reactivation) | Implement keep-alive pings or document the reactivation process for operations team |
| Korean marketplaces generally | Assuming all return JSON. Some older Korean marketplace APIs return XML or even HTML | Build response parsing into the adapter layer, support JSON and XML deserialization |
| Excel import/export | Assuming UTF-8 encoding. Korean systems frequently export EUC-KR or CP949 | Auto-detect encoding with chardet. Convert to UTF-8 before processing. Show preview for verification |
| Multiple ERP/tools accessing same marketplace | Duplicate order collection when both Funtastic and another tool (e.g., 사방넷 during migration) hit the same API | Use order deduplication by marketplace order ID. During migration, disable old tool before enabling new one per marketplace |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous order collection across all marketplaces | Dashboard shows "syncing..." for minutes. Timeouts on slow marketplaces block fast ones | Parallel async collection per marketplace with independent timeouts (30 sec per marketplace) | At 10+ marketplaces (sequential takes 5+ minutes) |
| Loading all orders into memory for dashboard | Browser becomes sluggish, high memory usage, slow page loads | Server-side pagination. Load only visible page. Use cursor-based pagination for APIs | At 2,000+ orders/day (within first week of accumulated data) |
| N+1 queries when loading orders with marketplace details | Slow dashboard rendering, high database CPU | Eager load marketplace info with orders. Use database views or materialized views | At 5,000+ total orders in the system |
| Unbounded Excel file parsing in browser | Tab crashes, browser becomes unresponsive | Server-side processing with streaming. Web Worker for parsing if client-side needed | At 5,000+ row Excel files (common for product lists) |
| Single database connection pool for all marketplace syncs | Connection pool exhaustion during peak collection. 30 simultaneous marketplace syncs competing for connections | Separate connection pools or queue marketplace syncs to limit concurrency (e.g., max 5 simultaneous) | At 15+ active marketplace connections |
| Storing every API response without cleanup | Database bloat, slow backups, increased Supabase costs | Retain raw responses for 30 days for audit, then archive/delete. Keep normalized data permanently | At 1,000+ orders/day after 3 months (~100K+ raw response records) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Marketplace credentials in plaintext database columns | Full account takeover on all 30 marketplaces if DB is breached | Use Supabase Vault for encryption at rest. Access only via server-side RPC functions |
| Logging marketplace API responses containing customer PII (names, addresses, phone numbers) | PIPA (Korean Personal Information Protection Act) violation, fines | Redact PII from logs. Store customer data only in encrypted, access-controlled tables |
| Exposing Supabase service role key in frontend | Full database access including all seller data and credentials | Service role key only in server-side environment variables. Frontend uses only anon key with RLS |
| No per-seller data isolation (missing RLS) | Seller A can see Seller B's orders, credentials, and inventory | Implement Supabase RLS from day one. Every table touching seller data must have RLS policies |
| INSERT statements logging credentials to Supabase logs | Credentials visible in Supabase dashboard logs | Disable statement logging when inserting vault secrets. Use parameterized queries |
| Using marketplace API keys with excessive permissions | Compromised key can modify products, pricing, cancel orders | Request minimum necessary API scopes per marketplace. Separate read-only and write keys where supported |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visual indication of per-marketplace sync status | Seller doesn't know if a marketplace failed to sync. Trusts dashboard that is missing orders | Show per-marketplace last-sync time and status (green/yellow/red) prominently on dashboard |
| Showing "0 orders" when API is actually failing | Seller thinks business is slow; actually orders are piling up on marketplace unprocessed | Distinguish "0 orders found" from "sync error" with clear messaging and alerts |
| Requiring page refresh to see new orders | Seller repeatedly refreshes page, misses time-sensitive orders | Implement polling-based auto-refresh (every 30-60 sec) or real-time updates via Supabase Realtime |
| Bulk tracking upload with no progress indication | Seller uploads 500 tracking numbers, sees nothing for 2 minutes, thinks it failed, re-uploads | Show progress bar with per-item status. Enable partial success (show which succeeded, which failed) |
| Generic error messages for marketplace API failures | Seller sees "Upload failed" with no idea what to fix | Show marketplace-specific error messages. "Coupang rejected tracking number 1234 -- invalid carrier code" |
| Forcing single-marketplace workflow for multi-marketplace operations | Seller has to click into each marketplace separately to do the same operation | Provide unified views (all orders across marketplaces) with marketplace filter, plus bulk operations |

## "Looks Done But Isn't" Checklist

- [ ] **Order collection:** Often missing handling for marketplace-initiated cancellations/refunds that happen after order was already collected -- verify that status updates are re-synced, not just initial collection
- [ ] **Tracking upload:** Often missing idempotent retry logic -- verify that re-uploading the same tracking number doesn't create duplicate shipment records on the marketplace
- [ ] **Marketplace auth:** Often missing proactive token refresh -- verify tokens are refreshed before expiry, not only when a 401 is received
- [ ] **Inventory sync:** Often missing atomic decrement -- verify that concurrent orders don't both read the same stock count (test with parallel requests)
- [ ] **Excel import:** Often missing encoding detection -- verify with a real EUC-KR encoded file from a Korean marketplace, not just UTF-8 test files
- [ ] **Dashboard:** Often missing empty state vs. error state distinction -- verify that "no orders" and "API error" show different UI states
- [ ] **Rate limiting:** Often missing per-marketplace limits -- verify that Naver's 2/sec limit and Coupang's 10/sec limit are independently enforced, not a global shared limit
- [ ] **Error handling:** Often missing partial failure handling -- verify that if tracking upload fails for order #50 out of 200, orders #51-200 still get processed
- [ ] **Data model:** Often missing raw marketplace data preservation -- verify that the original marketplace response is stored, not just the normalized version
- [ ] **Migration from Sabangnet:** Often missing parallel-run period -- verify that both systems can operate simultaneously during transition without duplicate order processing

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Auth token expired, orders missed for hours | LOW | Re-authenticate, trigger immediate order collection for missed time window, reconcile with marketplace order list |
| Tracking upload batch failure (500 uploads failed) | MEDIUM | Query marketplace for current tracking status, diff against local records, re-upload only missing ones. May need manual intervention for orders past SLA |
| Overselling due to inventory race condition | HIGH | Cancel oversold orders on marketplace (hurts seller rating), refund customers, implement safety stock buffer, fix atomic inventory logic |
| Wrong order status mapping causing incorrect workflow | HIGH | Audit all orders in incorrect state, manually correct on both marketplace and internal system, fix mapping, re-process affected orders |
| Credential breach (plaintext credentials stolen) | CRITICAL | Immediately rotate ALL marketplace API keys, audit marketplace accounts for unauthorized changes, implement Vault encryption, notify affected sellers |
| EUC-KR mojibake corrupted product data | MEDIUM | Re-import from original files with correct encoding detection, diff against marketplace data to identify corrupted records, fix encoding pipeline |
| Database bloat from unarchived API responses | LOW | Implement archival policy, migrate old records to cold storage, add TTL-based cleanup job |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Authentication diversity and silent expiry | Phase 1 (Architecture) | Auth adapter interface supports all 4 auth patterns. Health monitoring alerts on auth failures within 5 minutes |
| Order status model mismatch | Phase 1 (Data Model) | Schema stores raw + normalized status. Unmapped statuses are flagged, not silently dropped |
| Tracking upload failures | Phase 2 (Shipping) | Persistent job queue with retry. Reconciliation dashboard shows "shipped but unconfirmed" orders. Success rate > 99% |
| Inventory sync race conditions | Phase 3 (Inventory) | Atomic inventory decrements verified with concurrent load test. Safety stock buffer configurable per product |
| Marketplace prioritization | Phase 1 (Planning) | Tier 1 (Coupang + Naver) fully working before any Tier 2 development begins |
| Excel encoding issues | Phase 2 (Tracking Upload) | Tested with real EUC-KR files. Auto-detect works. Preview step shows Korean text correctly |
| Marketplace downtime handling | Phase 1 (Architecture) | Circuit breaker per marketplace. Independent processing verified (one marketplace down, others continue) |
| Credential security | Phase 1 (Foundation) | Supabase Vault used from first credential storage. RLS on all seller-scoped tables. No credentials in logs |
| Dashboard UX (error vs. empty state) | Phase 2 (Dashboard) | Per-marketplace health status visible. "No orders" vs. "sync error" are distinct UI states |
| Migration from Sabangnet | Phase 2 (Go-live) | Parallel-run checklist. Deduplication by marketplace order ID. Cutover plan per marketplace, not all-at-once |

## Sources

- [Coupang HMAC Signature Documentation](https://developers.coupangcorp.com/hc/en-us/articles/360033461914-Creating-HMAC-Signature) -- HIGH confidence
- [Coupang Rate Limit Policy](https://developers.coupangcorp.com/hc/en-us/articles/20414599556889-Introduction-of-Open-API-rate-limit-policy) -- HIGH confidence
- [Coupang Rate Limit Strengthening Notice (Oct 2023)](https://developers.coupangcorp.com/hc/en-us/articles/23902034110617-Notice-on-strengthening-OpenAPI-speed-limit-policy-October-12-2023) -- HIGH confidence
- [Naver Commerce API GitHub (rate limits discussion)](https://github.com/commerce-api-naver/commerce-api/discussions/6) -- HIGH confidence
- [Naver Commerce API GitHub (official)](https://github.com/commerce-api-naver/commerce-api) -- HIGH confidence
- [Supabase Vault Documentation](https://supabase.com/docs/guides/database/vault) -- HIGH confidence
- [Supabase Vault Feature Page](https://supabase.com/features/vault) -- HIGH confidence
- [EUC-KR vs UTF-8 in Korean Systems](https://mojoauth.com/compare-character-encoding/euc-kr-vs-utf-8) -- MEDIUM confidence
- [Multi-Channel Inventory Sync: Preventing Overselling](https://syncauction.com/blog/multi-channel-inventory-sync-preventing-overselling) -- MEDIUM confidence
- [Multichannel Data Sync Gaps (Webgility)](https://www.webgility.com/blog/data-sync-gap-in-multichannel-ecommerce) -- MEDIUM confidence
- [Marketplace Integration Challenges (Mirakl)](https://www.mirakl.com/blog/common-marketplace-integration-challenges-how-to-avoid) -- MEDIUM confidence
- [ERP-eCommerce Sync Failures (AppseConnect)](https://www.appseconnect.com/the-fastest-way-for-us-retailers-to-fix-erp-ecommerce-sync-failures/) -- MEDIUM confidence

---
*Pitfalls research for: Korean e-commerce marketplace integration SaaS*
*Researched: 2026-04-03*
