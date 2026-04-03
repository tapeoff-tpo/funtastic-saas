# Phase 6: Marketplace Expansion - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Add 11번가, 지마켓/옥션(ESM), 오늘의집 adapters to complete top-5 Korean marketplace coverage. Each adapter implements the full MarketplaceAdapter interface.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** 11번가: API key auth, REST/XML endpoints. Use fast-xml-parser for responses.
- **D-02:** 지마켓/옥션: Unified ESM Trading API at etapi.ebaykorea.com. Single adapter serves both.
- **D-03:** 오늘의집: API details TBD — implement getOrders + uploadInvoice at minimum.
- **D-04:** Each adapter registers in marketplace registry with config in configs.ts.
- **D-05:** Use iconv-lite for EUC-KR encoding if needed (11번가, ESM).

### Claude's Discretion
- Exact API endpoint paths (research during implementation)
- Error handling specifics per marketplace
- Test mock data formats

</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` (MKT-03~05)
- `src/lib/marketplace/types.ts` — MarketplaceAdapter interface
- `src/lib/marketplace/registry.ts` — Adapter registry
- `src/lib/marketplace/adapters/coupang/` — Reference adapter implementation
- `src/lib/marketplace/adapters/naver/` — Reference adapter implementation
- `src/lib/marketplace/adapters/configs.ts` — Marketplace configurations

</canonical_refs>

<code_context>
## Existing Code Insights

### Pattern to Follow
- Coupang adapter: HMAC auth + JSON API
- Naver adapter: OAuth2 + JSON API
- Each adapter has: adapter.ts, client.ts, types.ts, status-map.ts

### Integration Points
- `src/lib/marketplace/adapters/configs.ts` — Add 3 new marketplace configs
- `src/lib/marketplace/registry.ts` — Register new adapters
- Tests follow existing pattern in tests/marketplace/

</code_context>

<specifics>
## Specific Ideas

None — follow existing adapter patterns.

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>

---
*Phase: 06-marketplace-expansion*
*Context gathered: 2026-04-03*
