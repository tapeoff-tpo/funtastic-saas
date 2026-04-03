# Feature Research: Korean E-Commerce Marketplace Integration SaaS

**Domain:** E-commerce marketplace integration/management platform (쇼핑몰 통합관리 솔루션)
**Researched:** 2026-04-03
**Confidence:** MEDIUM-HIGH (based on competitor analysis of 사방넷, 플레이오토, 셀메이트, 이셀러스, 셀러허브, 셀로, 비젬, 샵링커 and seller community feedback)

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these means sellers will not switch from 사방넷/플레이오토. These are non-negotiable.

#### Order Management

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-marketplace order collection (주문수집) | Core value -- every competitor does this. Sellers need all marketplace orders in one view. | HIGH | Must support scheduled auto-collection (every N minutes). 사방넷 collects multiple times daily. API rate limits vary by marketplace (e.g., Coupang: 10 req/sec). |
| Unified order dashboard (통합주문조회) | Sellers manage 500-2000 orders/day across 30 marketplaces. Without a single view, there's no point. | MEDIUM | Needs filtering by marketplace, date, status, product. Search by order number, buyer name, phone. |
| Order status management (주문상태관리) | Orders flow through states: 신규 -> 확인 -> 출고대기 -> 출고완료 -> 배송중 -> 배송완료. Must track this. | MEDIUM | State transitions must sync back to each marketplace's SCM system. |
| Claims/returns/exchange collection (클레임수집) | Cancel/return/exchange requests come from each marketplace. Missing these = missed refund deadlines and penalties. | HIGH | Each marketplace has different claim APIs and workflows. Must auto-collect alongside orders. |
| Order hold/release (보류/해제) | Sellers need to hold problematic orders (address issues, payment verification, stock problems). | LOW | Simple flag on order with reason field. |

#### Shipping & Invoice

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Invoice number upload via API (송장 API 전송) | Core value per PROJECT.md -- "이것이 되면 사방넷을 끊을 수 있다." Each marketplace needs invoice sent back via its API. | HIGH | Must handle per-marketplace API differences. Bulk upload critical for 500+ daily orders. |
| Excel invoice upload (엑셀 송장 업로드) | Backup method when API fails or for marketplaces without API. Required per PROJECT.md. | MEDIUM | Need configurable Excel column mapping. Support various carrier formats. |
| Shipping label/invoice print (송장출력) | Sellers print shipping labels in bulk. Tightly coupled with carrier integration. | MEDIUM | Integration with major Korean carriers: CJ대한통운, 한진, 롯데, 우체국, 로젠 etc. |
| Combined shipping / merge orders (합포장) | Same buyer, same address, multiple orders = ship together. Critical for cost savings at 500+ orders/day. | HIGH | Auto-detection of mergeable orders. Per-product merge exclusion rules (oversized items). 사방넷/플레이오토 셀러들이 이 기능의 부족함을 가장 많이 불평함. |
| Order splitting (주문분할) | One order with multiple items that must ship separately (e.g., oversized + small). | MEDIUM | Auto-split rules based on product attributes. |
| Shipping Excel export (배송엑셀출력) | Export processed orders to Excel for carrier upload or warehouse use. | LOW | Configurable column templates per carrier. Clean product names (remove unnecessary characters). |

#### Product Management

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-marketplace product listing (상품일괄등록) | Register products across marketplaces from a single interface. | HIGH | Each marketplace has unique category trees, required fields, image specs. Category mapping is the hardest part. |
| Product modification sync (상품수정) | Change price/title/description and push to all marketplaces. | HIGH | Must handle marketplace-specific field constraints. Selective field update (don't overwrite marketplace-specific customizations). |
| Category mapping (카테고리매핑) | Map internal categories to each marketplace's category tree. | HIGH | Each marketplace has its own category hierarchy (쿠팡, 네이버 etc. all different). Needs initial setup per marketplace. |
| Option/variant management (옵션관리) | Manage product options (size, color) across marketplaces. | MEDIUM | Option naming conventions differ by marketplace. Must support option-level pricing, stock, and status. |
| Auto-soldout/restock (자동품절/재판매) | When stock hits 0, mark sold-out across all marketplaces. Reverse when restocked. | HIGH | Must be near-real-time to prevent overselling. 사방넷's strongest selling point. |

#### Inventory Management

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Centralized inventory tracking (통합재고관리) | Single source of truth for stock levels. Deduct on order, add back on return. | HIGH | Must handle concurrent orders from multiple marketplaces. Race condition risk at scale. |
| Inventory sync to marketplaces (재고동기화) | Push stock quantities to each marketplace in near-real-time. | HIGH | Different marketplaces have different stock update APIs. Some have rate limits. |
| Stock adjustment (재고조정) | Manual stock add/subtract with reason tracking (입고, 반품, 불량, 실사). | LOW | Audit trail important for reconciliation. |

#### Excel & Data

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Excel order export (주문 엑셀 출력) | Export orders to Excel with customizable columns. Every Korean business runs on Excel. | LOW | Multiple templates (carrier, warehouse, internal). |
| Excel product import/export (상품 엑셀 입출력) | Bulk product management via Excel upload/download. | MEDIUM | Complex validation needed. Must map Excel columns to marketplace fields. |
| Custom Excel templates (엑셀양식 관리) | Different carriers, warehouses, and internal processes need different Excel formats. | LOW | Template builder with column mapping. |

### Differentiators (Competitive Advantage)

Features where we can beat 사방넷/플레이오토. Focus here for product-market fit.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Modern web-based UX | 사방넷 is clunky legacy UI. 플레이오토 is a PC-installed program. A clean, fast web app is immediately differentiating. | MEDIUM | This is architectural, not a feature. But sellers complain about 사방넷's UI complexity and 플레이오토's PC-only limitation. |
| Smart combined shipping (지능형 합포장) | Competitors struggle here. Auto-detect merge candidates with configurable rules. Visual merge confirmation. | HIGH | Biggest pain point from seller communities. Getting this right = immediate switching motivation. |
| Gift/freebie automation (사은품 자동지급) | Auto-attach gifts based on order amount, quantity, or product rules. Competitors offer this but it's often buggy. | MEDIUM | Rule engine: if order > X won or contains product Y, add gift Z to packing list. |
| Set product decomposition (세트상품 분리) | Automatically split set products into individual items for picking/packing. | MEDIUM | Map set SKU to component SKUs with quantities. Affect inventory at component level. |
| Fast onboarding (빠른 초기설정) | 사방넷 charges 500,000 KRW setup fee and requires professional configuration. Self-service setup is a huge differentiator. | HIGH | Guided marketplace connection wizard. Auto-detect categories. Import existing product data. |
| Competitive pricing | 사방넷: 250,000-520,000/month + 500,000 setup. Significantly lower cost with comparable features wins. | N/A | This is business model, not feature. But critical for switching motivation. |
| Real-time order dashboard | 사방넷 collects orders on schedule. Real-time push notifications for new orders and claims. | MEDIUM | WebSocket or SSE for live updates. Reduces response time to claims. |
| Barcode scanning verification (바코드 검수) | Scan product barcodes during packing to verify correct items. Reduces shipping errors. | MEDIUM | Camera-based or USB scanner. Match scanned barcode to order items. |
| Funtastic B2B integration (펀타스틱B2B 연동) | Direct integration with company's own B2B platform. No competitor can offer this. | MEDIUM | API TBD per PROJECT.md. Unique selling point for internal use. |
| Scheduler automation (자동화 스케줄러) | Auto-run order collection, claim sync, invoice upload, inventory sync on configured schedule. | MEDIUM | Cron-like scheduling with retry logic. 플레이오토 recently launched this as premium feature. |

### Anti-Features (Deliberately NOT Build)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full WMS (창고관리시스템) | 사방넷2.0 added WMS. Sellers ask for it. | Massive scope increase. WMS is a separate product domain (location management, picking routes, bin assignment). Delays core OMS launch by months. | Integrate with existing WMS solutions via API. Focus on OMS first. |
| Built-in CS/chat system (CS관리) | 사방넷 and 셀메이트 collect marketplace Q&A. | Each marketplace has its own CS interface. Duplicating this is low-value, high-maintenance. Sellers already use dedicated CS tools. | Out of scope per PROJECT.md. Link to marketplace CS pages. |
| Accounting/settlement (회계/정산) | 사방넷 offers basic settlement tracking. | Accounting is regulated, complex, and a separate domain. Half-built accounting is worse than none. | Out of scope per PROJECT.md. Export data for external accounting software. |
| Mobile app | 플레이오토2.0 launched mobile app in 2025. | Mobile is consumption, not production. Sellers process 500+ orders on desktop. Mobile adds maintenance burden with minimal value. | Responsive web dashboard for monitoring only. Defer native app to v2+. |
| Detail page auto-generation (상세페이지 자동생성) | AI-powered product page creation is trendy. | Highly seller-specific. Quality varies. Not core to order/shipping workflow. | Out of scope per PROJECT.md. Defer to v2+. |
| Marketplace entry/registration proxy (입점대행) | 셀러허브 offers this. | This is a service business, not a software feature. Requires human labor and marketplace relationships. | Not our business model. |
| Real-time everything | Tempting to make all syncs real-time. | API rate limits from marketplaces make true real-time impossible. Adds infrastructure cost and complexity. | Near-real-time (5-15 min intervals) for stock sync. Scheduled collection for orders. Real-time only for dashboard updates. |
| Dropship/supplier order automation (위탁판매 발주자동화) | Some competitors focus on this. | PROJECT.md specifies self-shipping (자체배송) focus. Dropship workflow is fundamentally different (supplier management, split margins, forwarding orders). | Defer entirely. Self-shipping sellers are the target. |

## Feature Dependencies

```
[Marketplace API Auth (마켓 인증)]
    |
    +--requires--> [Order Collection (주문수집)]
    |                  |
    |                  +--requires--> [Order Dashboard (주문조회)]
    |                  |                  |
    |                  |                  +--requires--> [Combined Shipping (합포장)]
    |                  |                  |
    |                  |                  +--requires--> [Order Excel Export (엑셀출력)]
    |                  |
    |                  +--requires--> [Invoice Upload API (송장전송)]
    |                  |
    |                  +--requires--> [Invoice Upload Excel (엑셀 송장)]
    |                  |
    |                  +--requires--> [Claims Collection (클레임수집)]
    |
    +--requires--> [Product Listing (상품등록)]
    |                  |
    |                  +--requires--> [Category Mapping (카테고리매핑)]
    |                  |
    |                  +--requires--> [Product Sync (상품수정)]
    |
    +--requires--> [Inventory Sync (재고동기화)]

[Centralized Inventory (재고관리)]
    |
    +--enhances--> [Auto Soldout (자동품절)]
    |                  |
    |                  +--requires--> [Inventory Sync]
    |
    +--enhances--> [Order Collection] (stock deduction on order)
    |
    +--requires--> [Stock Adjustment (재고조정)]

[Set Product Decomposition (세트상품분리)]
    +--requires--> [Centralized Inventory]
    +--enhances--> [Combined Shipping]

[Gift Automation (사은품자동지급)]
    +--requires--> [Order Dashboard]
    +--enhances--> [Combined Shipping]

[Barcode Verification (바코드검수)]
    +--requires--> [Order Dashboard]
    +--enhances--> [Combined Shipping]

[Funtastic B2B Integration]
    +--requires--> [Order Collection] (B2B orders flow into same pipeline)
    +--requires--> [Centralized Inventory]
```

### Dependency Notes

- **Marketplace API Auth is the foundation:** Everything depends on successfully authenticating with marketplace APIs. Each of the ~30 marketplaces has different auth methods (OAuth, HMAC, API key). Coupang API keys expire every 180 days.
- **Order Collection before Invoice Upload:** Cannot send invoices without first collecting orders. This is the critical path.
- **Centralized Inventory is a parallel foundation:** Inventory tracking can be built alongside order management but must be in place before auto-soldout and inventory sync features.
- **Combined Shipping requires Order Dashboard:** Merge logic operates on collected, visible orders. Cannot combine what you cannot see.
- **Category Mapping gates Product Listing:** Product registration is useless without proper category mapping per marketplace. This is the highest-effort prerequisite for product management.

## MVP Definition

### Launch With (v1) -- "사방넷 끊기" Milestone

The PROJECT.md is clear: order collection + invoice upload = can replace 사방넷. Be ruthless here.

- [ ] Marketplace API authentication (start with top 5: 쿠팡, 네이버, 11번가, 지마켓/옥션, 스마트스토어) -- gateway to everything
- [ ] Order collection with auto-scheduling -- core value
- [ ] Unified order dashboard with search/filter -- see all orders in one place
- [ ] Invoice number upload via API (per-marketplace) -- core value, this is the switching trigger
- [ ] Excel invoice upload as fallback -- for marketplaces without API or API failures
- [ ] Order Excel export (configurable templates) -- warehouse/carrier integration
- [ ] Basic claims collection (cancel/return/exchange) -- cannot ignore these or face marketplace penalties
- [ ] Combined shipping detection and processing -- biggest daily pain point for 500+ order sellers
- [ ] Basic inventory tracking (deduct on ship, add on return) -- prevent overselling
- [ ] User authentication and marketplace credential management -- multi-user access

### Add After Validation (v1.x) -- "Full Replacement"

Features to add once core order flow is proven stable with real daily volume.

- [ ] Auto-soldout across marketplaces -- when inventory management is proven reliable
- [ ] Product listing (bulk registration) -- start with top 3-5 marketplaces
- [ ] Category mapping system -- required for product listing
- [ ] Inventory sync to marketplaces -- after inventory tracking is battle-tested
- [ ] Gift/freebie automation -- high seller satisfaction, medium complexity
- [ ] Set product decomposition -- needed for accurate inventory
- [ ] Barcode scanning verification -- reduces packing errors
- [ ] Expand to all 30 marketplaces -- incremental after architecture is proven
- [ ] Scheduler automation (configurable auto-run) -- reduce manual clicking

### Future Consideration (v2+) -- "Seller Service Platform"

Features for when the platform is opened to external sellers.

- [ ] Multi-tenant architecture (external seller accounts)
- [ ] Funtastic B2B integration (API TBD)
- [ ] Reporting/analytics dashboard (sales trends, marketplace performance)
- [ ] Settlement tracking (basic revenue reconciliation per marketplace)
- [ ] Product detail page templates
- [ ] Responsive mobile dashboard
- [ ] Marketplace-specific advanced features (쿠팡 로켓그로스, 네이버 스마트스토어 특화)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Order collection (주문수집) | HIGH | HIGH | P1 |
| Order dashboard (주문조회) | HIGH | MEDIUM | P1 |
| Invoice API upload (송장전송) | HIGH | HIGH | P1 |
| Excel invoice upload (엑셀송장) | HIGH | LOW | P1 |
| Claims collection (클레임수집) | HIGH | HIGH | P1 |
| Combined shipping (합포장) | HIGH | HIGH | P1 |
| Order Excel export (엑셀출력) | MEDIUM | LOW | P1 |
| Basic inventory (재고관리) | HIGH | MEDIUM | P1 |
| Auth & credential mgmt | HIGH | MEDIUM | P1 |
| Auto-soldout (자동품절) | HIGH | MEDIUM | P2 |
| Inventory sync (재고동기화) | HIGH | HIGH | P2 |
| Product listing (상품등록) | MEDIUM | HIGH | P2 |
| Category mapping | MEDIUM | HIGH | P2 |
| Gift automation (사은품) | MEDIUM | MEDIUM | P2 |
| Set product split (세트분리) | MEDIUM | MEDIUM | P2 |
| Barcode verification | MEDIUM | MEDIUM | P2 |
| Scheduler automation | MEDIUM | MEDIUM | P2 |
| B2B integration | MEDIUM | MEDIUM | P3 |
| Reporting/analytics | LOW | MEDIUM | P3 |
| Settlement tracking | LOW | HIGH | P3 |
| Multi-tenant (seller SaaS) | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch (replaces 사방넷 for daily operations)
- P2: Should have, add when core is stable (full feature parity)
- P3: Nice to have, future consideration (platform expansion)

## Competitor Feature Analysis

| Feature | 사방넷 | 플레이오토 | 셀메이트 | 이셀러스 | Our Approach |
|---------|--------|-----------|---------|---------|-------------|
| Connected marketplaces | 250+ (market leader) | 100+ | 50+ | 40+ | Start with 5-10 most critical, expand to 30 per PROJECT.md |
| Order collection | Scheduled, multiple daily | Scheduled, fast (PC app) | Scheduled | Scheduled | Scheduled + near-real-time option |
| Invoice upload | API + Excel | API + Excel | API + Excel | API + Excel | API + Excel (same, must match) |
| Combined shipping | Supported but sellers complain about quality | Supported but limited | Basic | Basic | Invest heavily here -- biggest pain point |
| Product listing | Very comprehensive, 140+ malls | Strong, fast bulk upload | Good for fashion | Basic | Start simple, expand. Not v1 priority. |
| Inventory sync | Auto-soldout across malls | Real-time stock deduction | Basic | Basic | Match 사방넷 quality, better UX |
| WMS | Added in 2.0 | No | Launched WMS | No | Explicitly NOT building. OMS only. |
| CS management | Inquiry collection | Basic | Full CS mgmt | No | NOT building |
| Settlement | Basic | No | No | No | NOT building in v1 |
| UI/UX | Legacy, complex | PC-installed program | Web-based, decent | Web-based, basic | Modern web, clean UX -- key differentiator |
| Pricing (monthly) | 250K-520K KRW | 160K-600K KRW | 200K+ KRW | Cheapest tier | Significantly lower -- self-use first, then competitive pricing |
| Setup fee | 500K KRW | 200K KRW | 100K KRW | Low | Zero -- self-service onboarding |
| Mobile | No | App launched 2025 | No | No | Responsive web only |

## Self-Shipping Workflow Specifics

The PROJECT.md emphasizes self-shipping (자체배송). The typical daily workflow for a 500-2000 order seller:

1. **Morning collection** -- Collect all new orders from all marketplaces (auto-scheduled overnight or first thing)
2. **Order review** -- Check for holds (address issues, suspicious orders, stock problems)
3. **Combined shipping** -- Merge orders going to same address/buyer
4. **Set decomposition** -- Break set products into pick-list items
5. **Gift assignment** -- Attach freebies based on rules
6. **Excel export** -- Generate warehouse picking list / carrier shipping list
7. **Packing & shipping** -- Physical packing with optional barcode verification
8. **Invoice entry** -- Enter carrier tracking numbers (via carrier API integration or manual Excel upload)
9. **Invoice upload** -- Push tracking numbers back to each marketplace via API
10. **Claims processing** -- Handle cancel/return/exchange requests that came in during the day
11. **Inventory reconciliation** -- Verify stock levels match physical inventory

Steps 1-3 and 8-9 are the highest-automation-value points. Steps 4-7 are where UX quality matters most.

## Sources

- [사방넷 공식사이트](https://www.sabangnet.co.kr/) - Feature overview, pricing
- [사방넷 기능소개](https://www.sabangnet.co.kr/html/function_important.html) - Detailed feature list
- [플레이오토 공식사이트](https://www.plto.com/) - Service overview
- [플레이오토 서비스소개](https://www.plto.com/introduction/Info/) - Feature details
- [셀메이트](https://sellmate.io/) - Feature overview, WMS launch
- [이셀러스](https://www.esellers.co.kr/) - Pricing, delivery features
- [셀러허브](https://www.sellerhub.co.kr) - Service model comparison
- [바티AI 블로그 - 한국 쇼핑몰 통합관리 솔루션 정리](https://blog.bati.ai/commerce-solution-kr/) - Comprehensive comparison
- [임팩트플로우 솔루션 비교](https://impactflow.kr/products/multi-channel-ecoammerce-software) - 2025 comparison and pricing
- [아이보스 - 플레이오토와 사방넷 비교](https://www.i-boss.co.kr/ab-6141-49053) - Seller community feedback
- [스윕 블로그 - 위탁판매 자동화 솔루션 비교](https://www.sweepingoms.com/blog/sellers-automation-tools-comparison) - Pain points analysis
- [쿠팡 Open API](https://developers.coupangcorp.com/hc/en-us) - API documentation
- [사방넷2.0 테크42 기사](https://www.tech42.co.kr/%EC%82%AC%EB%B0%A9%EB%84%B72-0-%EC%87%BC%ED%95%91%EB%AA%B0%C2%B7%EC%B0%BD%EA%B3%A0%EA%B9%8C%EC%A7%80-%ED%86%B5%ED%95%A9%EA%B4%80%EB%A6%AC%EC%8B%A4%EC%8B%9C%EA%B0%84-%EC%9E%AC%EA%B3%A0/) - 사방넷 2.0 WMS integration

---
*Feature research for: Korean e-commerce marketplace integration SaaS*
*Researched: 2026-04-03*
