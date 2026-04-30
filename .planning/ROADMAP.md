# Roadmap: Funtastic SaaS

## Overview

This roadmap delivers a 사방넷 replacement for self-shipping Korean e-commerce sellers. The critical path runs through Foundation (auth + marketplace adapter architecture) to Order Collection (the core daily workflow) to Shipping/Invoice (the switching trigger). Inventory, product management, and marketplace expansion follow once the core order-to-invoice loop is battle-tested with real daily volume on Coupang and Naver.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Marketplace Infrastructure** - Auth, credential management, adapter architecture, and marketplace health monitoring
- [ ] **Phase 2: Order Collection & Dashboard** - Collect orders from Coupang/Naver into a unified dashboard with full order lifecycle management
- [ ] **Phase 3: Shipping & Invoice Processing** - Invoice upload, combined shipping, Excel export -- the 사방넷 switching trigger
- [ ] **Phase 4: Inventory Management** - Central stock tracking with picking locations, Excel bulk upload, and automatic deduction/restoration on order events
- [ ] **Phase 5: Product Management & Data** - Product listing across marketplaces with category mapping and bulk operations
- [x] **Phase 6: Marketplace Expansion** - Add 11번가, 지마켓/옥션, 오늘의집 adapters to complete top-5 coverage (completed 2026-04-03)
- [x] **Phase 7: 추가 마켓플레이스 연동** - Add 18 additional marketplace adapters (Cafe24, CJ온스타일, 현대홈쇼핑, NS홈쇼핑, 도매꾹, 온채널, 오너클랜 등)
- [ ] **Phase 8: 주문관리 UX 개선** - 취소 탭 활성화, 단계별 필터, 클레임 인디케이터 통합, 매핑 상품명 표시, 배송구분/SaaS 배송비 노출
- [ ] **Phase 9: 관리자 계정 관리** - 직원 여러 명을 관리자로 등록/관리할 수 있는 계정 생성/관리 기능

## Phase Details

### Phase 1: Foundation & Marketplace Infrastructure
**Goal**: Admin can log in, register marketplace API credentials securely, and see marketplace connection health -- with a modular adapter architecture ready for all future marketplace integrations
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, MKT-06
**Success Criteria** (what must be TRUE):
  1. Admin can log in with email/password and session persists across browser refresh
  2. Admin can register API credentials for a marketplace and they are stored encrypted (not readable in DB)
  3. Admin can see a dashboard showing each connected marketplace's status (connected/error/expired)
  4. A new marketplace adapter can be added by implementing a TypeScript interface without modifying existing code
**Plans:** 3 plans
Plans:
- [x] 01-01-PLAN.md — Setup deps, Drizzle schema, auth middleware, login page (FOUND-01, FOUND-02)
- [x] 01-02-PLAN.md — Marketplace adapter types, registry, Vault SQL functions, credential API (MKT-06, FOUND-04)
- [x] 01-03-PLAN.md — Sidebar layout, health dashboard, credential management UI (FOUND-03, FOUND-05)
**UI hint**: yes

### Phase 2: Order Collection & Dashboard
**Goal**: Orders from Coupang and Naver are automatically collected on a schedule and displayed in a unified dashboard with filtering, status management, and claims handling
**Depends on**: Phase 1
**Requirements**: ORD-01, ORD-02, ORD-03, ORD-04, ORD-05, ORD-06, ORD-07, MKT-01, MKT-02
**Success Criteria** (what must be TRUE):
  1. Orders from Coupang and Naver appear automatically in the system within 15 minutes of being placed on the marketplace
  2. Admin can view all orders from all connected marketplaces in one table, filtering by marketplace, date, status, product name, order number, and buyer name
  3. Admin can move orders through the status workflow (신규 -> 확인 -> 출고대기 -> 출고완료 -> 배송중 -> 배송완료)
  4. Cancellation/return/exchange claims from marketplaces are automatically collected and visible
  5. Admin can hold a problematic order with a reason and later release it back to normal flow
**Plans:** 5 plans
Plans:
- [x] 02-01-PLAN.md — DB schema (orders/claims/job_logs), order types, queries, status/hold business logic (ORD-04, ORD-06, ORD-07)
- [x] 02-02-PLAN.md — Coupang HMAC adapter + Naver OAuth adapter with order/claims collection (MKT-01, MKT-02)
- [x] 02-03-PLAN.md — BullMQ + Redis infrastructure, order collection worker, Docker Compose (ORD-01, ORD-05)
- [x] 02-04-PLAN.md — Order dashboard UI with TanStack Table, nuqs filters, server-side pagination (ORD-02, ORD-03)
- [x] 02-05-PLAN.md — Status management UI, hold/release dialog, claims filter, bulk actions + checkpoint (ORD-04, ORD-05, ORD-06, ORD-07)
**UI hint**: yes

### Phase 3: Shipping & Invoice Processing
**Goal**: Admin can complete the full shipping workflow -- from combined shipping detection through invoice upload to marketplace confirmation -- closing the order-to-delivery loop that replaces 사방넷
**Depends on**: Phase 2
**Requirements**: SHIP-01, SHIP-02, SHIP-03, SHIP-04, SHIP-05, SHIP-06, SHIP-07, SHIP-08, DATA-01
**Success Criteria** (what must be TRUE):
  1. Admin can upload invoice numbers to Coupang and Naver via API and see confirmation that the marketplace accepted them
  2. Admin can upload invoice numbers in bulk via Excel file as a fallback
  3. Admin can see auto-detected combined shipping suggestions and merge/split orders for shipping
  4. Admin can export orders to carrier-specific Excel formats with customizable column templates
  5. Admin can print shipping labels in batch
**Plans:** 7/8 plans executed
Plans:
- [x] 03-01-PLAN.md — Shipping types, carrier codes, Drizzle schema extensions, base queries (SHIP-01, SHIP-04, SHIP-06)
- [x] 03-02-PLAN.md — Coupang/Naver uploadInvoice() implementation, BullMQ invoice worker, server actions (SHIP-01)
- [x] 03-03-PLAN.md — Combined shipping detection algorithm, order splitting, shipment group queries (SHIP-04, SHIP-05, SHIP-06)
- [x] 03-04-PLAN.md — Excel import/export, carrier templates, order list export (SHIP-02, SHIP-07, SHIP-08, DATA-01)
- [x] 03-05-PLAN.md — Shipping UI: dashboard actions, combined shipping page, template mgmt, print labels (all SHIP + DATA-01)
**UI hint**: yes

### Phase 4: Inventory Management
**Goal**: Central inventory is tracked per product with picking location (warehouseZone/sectorCode), Excel bulk upload for incoming stock, and automatic stock adjustments on order and return events
**Depends on**: Phase 2
**Requirements**: INV-01, INV-02, INV-03, INV-04
**Success Criteria** (what must be TRUE):
  1. Admin can view and set inventory quantities for each product in a central inventory view with picking location (창고/피킹위치)
  2. When an order ships, inventory is automatically decremented (atomically, no race conditions)
  3. When an order is cancelled or returned, inventory is automatically restored
  4. Admin can manually adjust stock with a recorded reason (incoming stock, defective, physical count, etc.)
  5. Admin can bulk-register inventory via Excel upload with picking location data
  6. Admin can filter inventory by warehouse zone (창고별 필터)
**Plans:** 3 plans
Plans:
- [ ] 04-01-PLAN.md — Picking location schema (warehouseZone, sectorCode) + migration SQL (INV-01)
- [ ] 04-02-PLAN.md — Inventory CRUD with picking location + Excel bulk upload API (INV-01, INV-04)
- [ ] 04-03-PLAN.md — Inventory UI: picking location columns, warehouse filter, Excel upload dialog (INV-01, INV-04)
**UI hint**: yes

### Phase 5: Product Management & Data
**Goal**: Admin can import existing marketplace products, register new products with options/variants, push to multiple marketplaces with category mapping, and bulk-manage via Excel
**Depends on**: Phase 1
**Requirements**: PROD-01, PROD-02, PROD-03, PROD-04, PROD-05, DATA-02
**Success Criteria** (what must be TRUE):
  1. Admin can import existing products from connected marketplaces into the internal product DB (reverse collection)
  2. Admin can create a product with options/variants (size, color) and publish to Coupang and Naver in one operation
  3. Admin can map internal product categories to marketplace-specific category trees
  4. Admin can edit product info (price, title, description) and push changes to connected marketplaces
  5. Admin can manage per-option inventory (stock tracked at variant level)
  6. Admin can bulk-register or bulk-update products via Excel upload
**Plans:** 5 plans
Plans:
- [x] 05-01-PLAN.md — Product schema, types, queries, CRUD actions with variant-inventory linking (PROD-01, PROD-05)
- [x] 05-02-PLAN.md — Reverse collection: expand NormalizedProduct, implement adapter getProducts(), import logic (PROD-04)
- [x] 05-03-PLAN.md — Category mapping CRUD and product sync to marketplaces via adapter (PROD-02, PROD-03)
- [ ] 05-04-PLAN.md — Excel bulk import/export for products with round-trip compatibility (DATA-02)
- [x] 05-05-PLAN.md — Product management UI: list, create/edit forms, category mapping, import page + checkpoint (all PROD + DATA-02)
**UI hint**: yes

### Phase 6: Marketplace Expansion
**Goal**: 11번가, 지마켓/옥션(ESM), and 오늘의집 adapters are live, giving the system top-5 Korean marketplace coverage for order collection and invoice upload
**Depends on**: Phase 3
**Requirements**: MKT-03, MKT-04, MKT-05
**Success Criteria** (what must be TRUE):
  1. Orders from 11번가 are collected and invoices can be uploaded via API
  2. Orders from 지마켓 and 옥션 (via ESM unified API) are collected and invoices can be uploaded via API
  3. Orders from 오늘의집 are collected and invoices can be uploaded via API
  4. All 5 marketplace adapters show correct health status on the dashboard
**Plans:** 3/3 plans complete
Plans:
- [x] 06-01-PLAN.md — 11번가 adapter: API key auth, XML parsing, order/claims/invoice (MKT-03)
- [x] 06-02-PLAN.md — ESM adapter: unified Gmarket/Auction API, single adapter with site_type (MKT-04)
- [x] 06-03-PLAN.md — 오늘의집 adapter + register all new adapters in configs.ts (MKT-05)

### Phase 7: 추가 마켓플레이스 연동
**Goal**: 18 additional marketplace adapters are created and registered, expanding coverage from 6 to 24 marketplaces -- Tier 1/2 with full implementations, Tier 3 with stub adapters ready for API integration
**Depends on**: Phase 6
**Requirements**: MKT-V2
**Success Criteria** (what must be TRUE):
  1. All 18 new marketplace adapters exist with the standard 4-file pattern (adapter.ts, client.ts, types.ts, status-map.ts)
  2. All 18 are registered in configs.ts and appear in the marketplace registry
  3. MarketplaceId type includes all 24 marketplace IDs
  4. Tier 1/2 adapters (Cafe24, CJ온스타일, 카카오, 도매꾹, 온채널, 오너클랜, 신세계몰, 에이블리) have best-effort API implementations
  5. Tier 3 adapters have stub implementations with TODO markers for future API integration
**Plans:** 5/5 plans complete
Plans:
- [x] 07-01-PLAN.md — Tier 1 adapters: Cafe24 (OAuth2), CJ온스타일, 카카오선물하기, 카카오톡스토어 (MKT-V2)
- [x] 07-02-PLAN.md — Tier 2 adapters: 도매꾹 (XML+JSON), 온채널, 오너클랜, 신세계몰, 에이블리 (MKT-V2)
- [x] 07-03-PLAN.md — Tier 3a stubs: 현대홈쇼핑, NS홈쇼핑, 도매의신, 도매창고, 바나나B2B (MKT-V2)
- [x] 07-04-PLAN.md — Tier 3b stubs: 올웨이즈, 텐바이텐, 토스쇼핑, 투비즈온 (MKT-V2)
- [x] 07-05-PLAN.md — Register all 18 in configs.ts + update MarketplaceId type (MKT-V2)

### Phase 8: 주문관리 UX 개선
**Goal**: 주문관리 화면이 사방넷 대체에 충분히 직관적 — 클레임 상태가 한눈에 보이고, 매핑된 상품명이 표시되며, 단계별 필터가 명확히 동작하고, 배송구분/배송비가 명확히 보인다
**Depends on**: Phase 3 (출고/송장), Phase 4 (재고/배송비), Phase 5 (상품 매핑)
**Requirements**: post-launch UX feedback (취소 탭 활성화, 엑셀 업로드 제거 + 단계별 필터, CS 컬럼을 클레임 인디케이터로 통합, 매핑된 상품명 표시, 배송구분/SaaS 배송비 노출)
**Success Criteria** (what must be TRUE):
  1. 취소 탭에 정확한 카운트가 표시되고 클릭 시 취소 클레임 주문만 필터링된다
  2. 주문관리 메인 헤더에서 "엑셀 업로드" 진입점이 제거되고, 단계별(출고대기/출고완료/교환 등) 탭/필터로 대체된다
  3. 별도 CS 컬럼 없이 클레임/문의 유무가 좌측 첫 컬럼에 뱃지/아이콘으로 표시된다 (가능한 마켓에서 문의도 수집)
  4. 매핑된 상품의 표시명이 마켓플레이스 원본명이 아닌 SaaS 등록 상품명(displayName)으로 노출된다
  5. 단계별(출고대기/출고완료/교환 등) 필터가 빠짐없이 동작하고 카운트가 정확하다
  6. 주문 행에 배송구분이 표시되고, "수집 배송비"와 "SaaS 배송비(원가)"가 별도 컬럼으로 노출된다 (재고/상품 등록 정보 기반)
  7. 재고관리 화면에서 상품별 배송비(원가)를 입력/수정할 수 있다
**Plans:** 4 plans
Plans:
- [x] 08-01-PLAN.md — 데이터 모델 확장 (orders/products shipping fields, inquiries 테이블) + vitest setup + RED 테스트 stubs (SC-01,05,06,07)
- [x] 08-02-PLAN.md — Coupang adapter normalize 확장 (shippingFee/Type) + getInquiries + BullMQ inquiry-collection worker (SC-06, inquiry)
- [x] 08-03-PLAN.md — 주문관리 UI 리팩터: 9탭 OrderTabs, 엑셀 업로드 제거, stage-tabs 폐기, CS 컬럼 → 인디케이터 통합, displayName, 배송 3컬럼 (SC-01,02,03,04,05,06)
- [x] 08-04-PLAN.md — 재고관리 shipping_cost 인라인 편집 (SC-07)

**Note:** 매출관리(원가/배송비/판매가/수령배송비 기반 수익 계산)는 별도 phase로 분리 예정 — Phase 8은 데이터 노출과 입력 UI까지만 담당.

### Phase 9: 관리자 계정 관리
**Goal**: 오너가 직원 여러 명을 관리자 계정으로 직접 생성/관리할 수 있고, 모든 계정 변경이 audit log로 추적된다 — 이메일 인프라 없이 동작
**Depends on**: Phase 1 (Auth/Foundation)
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06
**Success Criteria** (what must be TRUE):
  1. super_admin이 관리자 페이지에서 이메일+역할 입력만으로 새 admin 계정을 생성할 수 있고, 생성된 계정은 즉시 로그인 가능하다 (초기 비밀번호는 환경변수 `INITIAL_USER_PASSWORD`)
  2. super_admin이 관리자 목록에서 역할 변경, 비밀번호 초기화, 비활성화/재활성화를 할 수 있고, 각 동작은 audit_logs 테이블에 기록된다
  3. 일반 admin 사용자는 관리자 계정관리 페이지 자체에 접근할 수 없다 (서버 측 차단)
  4. 모든 관리자가 본인 설정 페이지에서 self-service 비밀번호 변경을 할 수 있다
  5. 비활성화된 계정은 로그인 시도가 거부된다
  6. 마지막 super_admin을 admin으로 강등하거나 본인을 비활성화하는 시도는 거부된다
  7. user_profiles 테이블의 RLS 정책이 정상 동작한다 (본인 행만 SELECT 가능, super_admin은 전체 가능)
**Plans:** 4 plans
Plans:
- [ ] 09-01-PLAN.md — DB schema + migration + RLS + backfill of 10 pre-existing auth.users (ADMIN-01, ADMIN-02, ADMIN-05, ADMIN-06)
- [ ] 09-02-PLAN.md — Server actions + helpers + tests (createAccount, changeRole, resetPassword, deactivate, reactivate, selfChangePassword) (ADMIN-01, ADMIN-02, ADMIN-04, ADMIN-06)
- [ ] 09-03-PLAN.md — UI: Dialog primitive, /admin/accounts page (TanStack Table + add dialog + row actions), /settings/account password form (ADMIN-01, ADMIN-02, ADMIN-04)
- [ ] 09-04-PLAN.md — Auth gating: deactivated-user redirect, super_admin layout gate, audit trail E2E verification, BOOTSTRAP.md (ADMIN-03, ADMIN-05, ADMIN-06)

## Backlog

### Phase 999.1: OAuth2 마켓플레이스 인앱 연동 (BACKLOG)

**Goal:** 셀러가 API 키 복붙 대신 "연동하기" 버튼 클릭으로 마켓플레이스 연결. 네이버/Cafe24 등 OAuth2 지원 마켓에 인앱 연동 플로우 구현.
**Requirements:** TBD
**Plans:** 0 plans
**When:** 셀러 서비스화 단계에서 진행 (자체 사용 안정화 이후)

**Scope:**
- 네이버 커머스API 파트너 등록 + OAuth2 콜백 플로우
- Cafe24 OAuth2 연동
- 토큰 자동 갱신 로직
- API 키 방식 마켓은 현행 유지 (복붙)

**네이버 스마트스토어 "API 대행사" 등재 절차 (2026-04 조사):**
판매자 화면(스마트스토어센터 > API관리)의 대행사 드롭다운에 funtastic이 노출되려면 네이버 측 사전 심사 통과 필요.
1. 네이버 커머스 솔루션 파트너 신청 (https://solution.smartstore.naver.com/)
   - 사업자등록증, 솔루션 소개서, 보안 검토자료 제출
   - **법인 사업자 필수** (개인사업자 불가)
2. API 사용 신청서 + 보안 약정서 제출 → 클라이언트 ID/Secret 발급 (https://apicenter.commerce.naver.com)
   - 위탁개인정보처리방침, 보안 점검 통과 필요
3. 솔루션 마켓 입점 심사 (4~8주)
   - 통과 시 네이버 측에서 "대행사" 풀에 등록 → 다른 판매자 화면 드롭다운에 노출
4. 통과 후 OAuth2 콜백 URL 등록 + 토큰 발급/갱신 흐름 구현

**전제조건:**
- ~~법인 설립 (개인사업자 → 법인 전환 필요)~~ ✅ 완료 (2026-04)
- 솔루션 소개서 / 보안검토 자료 작성
- 자체 사용 단계에서 안정성/보안 검증 완료 후 진행

**진행 트랙 (병행):**
- **트랙 A (즉시):** 자체 솔루션으로 본인 스토어 연동 → 안정성 검증 (Phase 8 이후 진행)
- **트랙 B (장기):** 솔루션 파트너 신청 + 심사 (병렬 진행 가능, 4~8주 소요)
  - 신청 자료 준비: 솔루션 소개서, 보안검토 문서, 위탁개인정보처리방침
  - 심사 통과 후 → 본 phase promote → OAuth2 콜백 + 토큰 관리 구현

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8
Note: Phase 4 and Phase 5 can execute in parallel (Phase 4 depends on Phase 2, Phase 5 depends on Phase 1).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Marketplace Infrastructure | 3/3 | Complete | - |
| 2. Order Collection & Dashboard | 5/5 | Complete | - |
| 3. Shipping & Invoice Processing | 7/8 | In Progress|  |
| 4. Inventory Management | 0/3 | Replanned | - |
| 5. Product Management & Data | 0/5 | Not started | - |
| 6. Marketplace Expansion | 3/3 | Complete   | 2026-04-03 |
| 7. 추가 마켓플레이스 연동 | 5/5 | Complete   | 2026-04-03 |
| 8. 주문관리 UX 개선 | 0/0 | Not planned | - |
| 9. 관리자 계정 관리 | 0/4 | Planned | - |
