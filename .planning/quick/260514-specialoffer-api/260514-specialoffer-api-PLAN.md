---
phase: quick
plan: 260514-specialoffer-api
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/marketplace/adapters/specialoffer/client.ts
  - src/lib/marketplace/adapters/specialoffer/types.ts
  - src/lib/marketplace/adapters/specialoffer/adapter.ts
  - src/lib/marketplace/adapters/configs.ts
  - src/lib/marketplace/types.ts
  - src/lib/marketplace/collect-options.ts
  - src/lib/jobs/workers/order-collector.ts
  - src/app/(auth)/settings/marketplaces/actions.ts
  - src/lib/products/reverse-collect.ts
  - tests/marketplace/specialoffer.test.ts
autonomous: true
requirements: [MKT-SPECIALOFFER]
must_haves:
  truths:
    - "스페셜오퍼가 설정 > 마켓플레이스 인증정보에 api_key 방식으로 노출된다"
    - "인증 테스트는 /api/points 호출로 수행하되 WAF/네트워크 오류를 사용자에게 그대로 반환한다"
    - "상품목록 조회는 /api/goods 응답을 NormalizedProduct로 변환한다"
    - "주문수집 워커는 스페셜오퍼 구매자 주문내역을 판매 주문으로 오수집하지 않는다"
    - "API 인증키는 코드/문서에 하드코딩하지 않고 Vault 입력값으로만 사용한다"
  artifacts:
    - path: "src/lib/marketplace/adapters/specialoffer/adapter.ts"
      provides: "SpecialofferAdapter with testConnection, getProducts, and buyer-side order helper methods"
    - path: "src/lib/marketplace/adapters/specialoffer/client.ts"
      provides: "Bearer-auth ky client for specialoffer.kr Open API v2"
    - path: "tests/marketplace/specialoffer.test.ts"
      provides: "Normalization and order-collection guard tests"
---

<objective>
Add Specialoffer Open API v2 integration using the existing marketplace adapter pattern.

Purpose: connect the supplied Specialoffer API key through the app's credential workflow, support product DB reverse collection, and expose safe helper methods for buyer-side Specialoffer order operations without misclassifying those purchase orders as sales-channel orders.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@CLAUDE.md
@src/lib/marketplace/adapters/domesin/adapter.ts
@src/lib/marketplace/adapters/funtastic-b2b/adapter.ts
@src/lib/jobs/workers/order-collector.ts
@src/app/(auth)/settings/marketplaces/actions.ts
@/Users/chowol/Downloads/api_goods.v2.xlsx
@https://specialoffer.kr/shop/open_api_v2.php
</context>

<api_notes>
- Auth header: `Authorization: Bearer {api_key}`.
- Connection check: `GET https://specialoffer.kr/api/points`.
- Product list: `GET https://specialoffer.kr/api/goods` with pagination and filters.
- Product detail: `GET https://specialoffer.kr/api/goods/{goodsNo}`.
- Buyer order create/list/detail/cancel: `/api/v2/orders`.
- Supplier shipment update exists under `/api/v2/seller/orders/{order_id}`, but this account integration is buyer-side unless supplier credentials/role are confirmed.
- Product create/update endpoints are supplier-only; expose clear unsupported errors through MarketplaceAdapter register/update methods.
</api_notes>

<tasks>
1. Add `specialoffer` adapter folder with client/types/adapter.
2. Register `specialoffer` in marketplace type union, registry configs, collect/display options, credential testing, worker factory, and reverse product collection.
3. Keep sales order collection disabled by returning an empty array from `getOrders`.
4. Add focused tests for product normalization, connection-check path, and empty sales collection behavior.
5. Run targeted tests and TypeScript where practical; document any pre-existing project baseline failures separately.
</tasks>
