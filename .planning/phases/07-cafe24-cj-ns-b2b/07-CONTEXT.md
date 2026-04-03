# Phase 7: 추가 마켓플레이스 연동 - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Add 18 marketplace adapters following the established 4-file pattern (adapter.ts, client.ts, types.ts, status-map.ts). Register all in configs.ts. Each adapter implements MarketplaceAdapter interface for order collection, invoice upload, and product operations where available.

Marketplaces: 도매꾹, 온채널, 오너클랜, Cafe24, CJ온스타일, 현대홈쇼핑, NS홈쇼핑, 도매의신, 도매창고, 바나나B2B, 신세계몰, 에이블리, 올웨이즈, 카카오선물하기, 카카오톡스토어, 텐바이텐, 토스쇼핑, 투비즈온

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Follow exact same 4-file adapter pattern from Phase 6 (elevenst, esm, ohouse).
- **D-02:** Group adapters into waves by API similarity for parallel execution.
- **D-03:** Adapters with unknown/limited APIs get best-effort implementations with TODO markers.
- **D-04:** All adapters register in configs.ts with requiredCredentials for the credential management UI.
- **D-05:** Use ky for HTTP, fast-xml-parser for XML APIs, iconv-lite for EUC-KR if needed.

### Tier Grouping (by API maturity)
- **Tier 1 (well-documented):** Cafe24 (OAuth2, REST), CJ온스타일, 카카오선물하기, 카카오톡스토어
- **Tier 2 (API available):** 도매꾹 (OpenAPI), 온채널, 오너클랜, 신세계몰, 에이블리
- **Tier 3 (limited/unknown API):** 현대홈쇼핑, NS홈쇼핑, 도매의신, 도매창고, 바나나B2B, 올웨이즈, 텐바이텐, 토스쇼핑, 투비즈온

### Claude's Discretion
- Exact API endpoint paths per marketplace
- Auth method details per marketplace
- Which methods to stub vs implement

</decisions>

<canonical_refs>
## Canonical References

- `src/lib/marketplace/types.ts` — MarketplaceAdapter interface
- `src/lib/marketplace/registry.ts` — Adapter registry
- `src/lib/marketplace/adapters/coupang/` — Reference pattern (HMAC)
- `src/lib/marketplace/adapters/naver/` — Reference pattern (OAuth2)
- `src/lib/marketplace/adapters/elevenst/` — Reference pattern (API key + XML)
- `src/lib/marketplace/adapters/esm/` — Reference pattern (unified dual-marketplace)
- `src/lib/marketplace/adapters/configs.ts` — Registration configs

</canonical_refs>

<code_context>
## Existing Code Insights

### Pattern
Each adapter = 4 files:
- `adapter.ts` — implements MarketplaceAdapter
- `client.ts` — HTTP client with auth
- `types.ts` — API response types
- `status-map.ts` — marketplace status → internal OrderStatus

### Integration
- Register in `configs.ts` with id, name, requiredCredentials
- Tests in `tests/marketplace/{name}.test.ts` with MSW mocks

</code_context>

<specifics>
## Specific Ideas

- 18개 어댑터를 한 번에 만들면 너무 크므로 3-4개 웨이브로 분할
- API가 불확실한 마켓은 스텁 구현으로 시작

</specifics>

<deferred>
## Deferred Ideas

None

</deferred>

---
*Phase: 07-cafe24-cj-ns-b2b*
*Context gathered: 2026-04-03*
