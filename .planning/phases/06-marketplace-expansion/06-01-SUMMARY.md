---
phase: 06-marketplace-expansion
plan: 01
subsystem: marketplace/adapters/elevenst
tags: [marketplace, 11st, xml-api, adapter]
dependency_graph:
  requires: [marketplace-types, marketplace-errors, carrier-codes]
  provides: [elevenst-adapter, elevenst-client, elevenst-status-map]
  affects: [marketplace-registry, order-collector]
tech_stack:
  added: [fast-xml-parser]
  patterns: [xml-response-parsing, api-key-auth, adapter-pattern]
key_files:
  created:
    - src/lib/marketplace/adapters/elevenst/adapter.ts
    - src/lib/marketplace/adapters/elevenst/client.ts
    - src/lib/marketplace/adapters/elevenst/types.ts
    - src/lib/marketplace/adapters/elevenst/status-map.ts
    - tests/marketplace/elevenst.test.ts
  modified:
    - tests/helpers/msw-handlers.ts
    - package.json
decisions:
  - "XMLParser parseTagValue:false to preserve string status codes like '202', '303'"
  - "ensureArray helper for XML single-item vs array ambiguity"
metrics:
  duration: 4min
  completed: 2026-04-03
---

# Phase 06 Plan 01: 11st Marketplace Adapter Summary

11st adapter with API key auth, XML response parsing via fast-xml-parser, and full MarketplaceAdapter interface implementation.

## What Was Built

### Task 1: 11st Adapter Core Files (d8036ce)

Created the 4-file adapter pattern for 11st:

- **client.ts**: ky HTTP client with `openapikey` header auth and fast-xml-parser XML parsing. Uses `parseTagValue: false` to keep status codes as strings.
- **types.ts**: 11st API response types (ElevenstOrder, ElevenstClaim, ElevenstProduct, ElevenstInvoiceRequest) with XML wrapper types handling single/array ambiguity.
- **status-map.ts**: Order status mapping (202-304), claim type mapping (CNC/RTN/EXC), and claim status mapping (100-400) with console.warn fallbacks.
- **adapter.ts**: ElevenstAdapter class implementing all MarketplaceAdapter methods -- getOrders, getClaimsOrders, uploadInvoice, getProducts, registerProduct, updateProduct. Uses `ensureArray` helper for XML parsing edge cases.

### Task 2: MSW Tests (e20a3d0)

Created comprehensive test suite with MSW-mocked XML responses:

- Added 11st mock data and XML response builders to msw-handlers.ts
- 23 tests covering: XML parsing, all status mappings, order normalization with Korean data, claims normalization, invoice upload, testConnection, authenticate

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] XMLParser parseTagValue option**
- **Found during:** Task 2
- **Issue:** fast-xml-parser converts numeric-looking strings ('202', '303') to numbers by default, breaking status code matching
- **Fix:** Added `parseTagValue: false` to XMLParser options
- **Files modified:** src/lib/marketplace/adapters/elevenst/client.ts
- **Commit:** e20a3d0

## Decisions Made

1. **parseTagValue: false** -- Required to preserve 11st status codes as strings. Without this, '202' becomes 202 and status mapping fails.
2. **ensureArray helper** -- XML parsers return single objects when there's one child element vs arrays for multiple. The helper normalizes both cases.

## Known Stubs

None -- all adapter methods are fully implemented with proper error handling and normalization.

## Verification

- `npx tsc --noEmit` -- no errors in elevenst files
- `npx vitest run tests/marketplace/elevenst.test.ts` -- 23/23 tests pass

## Self-Check: PASSED

All 6 files verified present. Both commits (d8036ce, e20a3d0) verified in git log.
