---
phase: 05-product-management-data
plan: 02
subsystem: marketplace
tags: [reverse-collection, coupang, naver, product-import, adapter, normalization]

requires:
  - phase: 05-product-management-data
    provides: products, productVariants, productMarketplaceLinks tables and CRUD actions
provides:
  - NormalizedProduct with full product data (name, price, variants, images)
  - NormalizedProductVariant type for marketplace option handling
  - Coupang getProducts() with nextToken pagination
  - Naver getProducts() with page/size pagination
  - reverseCollectProducts() for importing marketplace products into internal DB
  - getCollectionProgress() for tracking import status
affects: [product-ui, marketplace-sync, inventory-management]

tech-stack:
  added: []
  patterns: [reverse-collection-pattern, adapter-product-normalization, idempotent-import]

key-files:
  created:
    - src/lib/products/reverse-collect.ts
  modified:
    - src/lib/marketplace/types.ts
    - src/lib/marketplace/adapters/coupang/adapter.ts
    - src/lib/marketplace/adapters/coupang/types.ts
    - src/lib/marketplace/adapters/naver/adapter.ts
    - src/lib/marketplace/adapters/naver/types.ts

key-decisions:
  - "Auto-generate internal SKU from marketplace prefix + productId (CPG-12345, NVR-67890)"
  - "Create default variant when marketplace product has no options (SKU-DEF pattern)"
  - "Store marketplace stock quantity in inventory via setStock when available from adapter"
  - "Idempotent import via productMarketplaceLinks unique constraint check before insert"

patterns-established:
  - "Reverse collection pattern: fetch via adapter.getProducts() -> dedup -> transaction(product + variants + link) -> inventory"
  - "Adapter product normalization: each marketplace maps to NormalizedProduct with variants, images, and rawData"

requirements-completed: [PROD-04]

duration: 4min
completed: 2026-04-03
---

# Phase 5 Plan 2: Reverse Collection Summary

**Marketplace product import via adapter getProducts() with Coupang/Naver pagination, normalized variant mapping, and idempotent reverse collection into internal product database**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-03T07:04:12Z
- **Completed:** 2026-04-03T07:07:42Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Expanded NormalizedProduct from stub to full product type with variants, images, category, status
- Implemented Coupang getProducts() with nextToken-based pagination and option/variant normalization
- Implemented Naver getProducts() with page/size pagination and option combination mapping
- Created reverseCollectProducts() that imports marketplace products with deduplication and inventory creation

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand NormalizedProduct and implement adapter getProducts()** - `996f553` (feat)
2. **Task 2: Reverse collection logic** - `baec36d` (feat)

## Files Created/Modified
- `src/lib/marketplace/types.ts` - Expanded NormalizedProduct and added NormalizedProductVariant type
- `src/lib/marketplace/adapters/coupang/adapter.ts` - Implemented getProducts() with pagination and normalization
- `src/lib/marketplace/adapters/coupang/types.ts` - Added CoupangSellerProduct, CoupangSellerProductItem, CoupangSellerProductsResponse
- `src/lib/marketplace/adapters/naver/adapter.ts` - Implemented getProducts() with pagination and normalization
- `src/lib/marketplace/adapters/naver/types.ts` - Added NaverChannelProduct, NaverProductsResponse, NaverProductOptionCombination
- `src/lib/products/reverse-collect.ts` - Reverse collection function with idempotent import and progress tracking

## Decisions Made
- Auto-generate internal SKU from marketplace prefix + productId (e.g., CPG-12345) for traceability
- Create a default variant (SKU-DEF) when marketplace product has no option combinations
- Import marketplace stock quantity into inventory when available; default to 0 otherwise
- Idempotent import: check productMarketplaceLinks before inserting to skip already-imported products
- Each product import runs in its own transaction for isolation; inventory creation outside tx (setStock has own tx)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Reverse collection ready for UI integration (Phase 5 Plan 3+)
- Both Coupang and Naver adapters fully implement getProducts()
- getCollectionProgress() available for polling UI during import

## Self-Check: PASSED

---
*Phase: 05-product-management-data*
*Completed: 2026-04-03*
