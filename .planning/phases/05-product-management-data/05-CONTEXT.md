# Phase 5: Product Management & Data - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Product registration with options/variants, reverse collection (import from marketplaces), category mapping, product sync to marketplaces, and Excel bulk operations. Enables full product lifecycle management.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Products table with internal SKU, name, description, price, images, category. Options/variants as separate table.
- **D-02:** Reverse collection: call marketplace getProducts() API, map to internal product schema.
- **D-03:** Category mapping: internal category → marketplace category tree. Manual mapping UI per marketplace.
- **D-04:** Product sync: edit product → push changes to connected marketplaces via adapter.
- **D-05:** Options/variants: size, color, etc. Each variant has its own SKU, price delta, inventory tracking.
- **D-06:** Excel bulk: ExcelJS for import/export of products with column mapping.

### Claude's Discretion
- Product form layout and field organization
- Category tree UI component
- Image upload handling

</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` (PROD-01~05, DATA-02)
- `src/lib/marketplace/types.ts` — MarketplaceAdapter interface (getProducts method)
- `src/lib/marketplace/adapters/coupang/adapter.ts`
- `src/lib/marketplace/adapters/naver/adapter.ts`
- `src/lib/db/schema.ts` — Existing schema
- `src/lib/inventory/` — Inventory system (link variants to inventory)
- `src/lib/shipping/excel/` — Excel patterns to reuse

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Excel import/export patterns from Phase 3
- TanStack Table patterns from orders/inventory pages
- Marketplace adapter interface with getProducts() stub
- Inventory system for per-variant stock tracking

### Integration Points
- `src/lib/db/schema.ts` — Add products, product_variants, category_mappings tables
- `src/app/(auth)/` — Add product management pages
- Inventory system — Link product variants to inventory records

</code_context>

<specifics>
## Specific Ideas

- 역수집(reverse collection)은 솔루션 전환의 전제조건
- 옵션별 재고 추적은 Phase 4 inventory와 연결

</specifics>

<deferred>
## Deferred Ideas

- 마켓별 옵션 자동 매칭 (v2 PROD-V2-01)
- 마켓별 상세 필드 커스터마이징 (v2 PROD-V2-02)

</deferred>

---
*Phase: 05-product-management-data*
*Context gathered: 2026-04-03*
