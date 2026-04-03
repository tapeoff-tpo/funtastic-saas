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
- [ ] **Phase 4: Inventory Management** - Central stock tracking with automatic deduction/restoration on order events
- [ ] **Phase 5: Product Management & Data** - Product listing across marketplaces with category mapping and bulk operations
- [ ] **Phase 6: Marketplace Expansion** - Add 11번가, 지마켓/옥션, 오늘의집 adapters to complete top-5 coverage

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
**Plans:** 5 plans
Plans:
- [x] 03-01-PLAN.md — Shipping types, carrier codes, Drizzle schema extensions, base queries (SHIP-01, SHIP-04, SHIP-06)
- [x] 03-02-PLAN.md — Coupang/Naver uploadInvoice() implementation, BullMQ invoice worker, server actions (SHIP-01)
- [x] 03-03-PLAN.md — Combined shipping detection algorithm, order splitting, shipment group queries (SHIP-04, SHIP-05, SHIP-06)
- [x] 03-04-PLAN.md — Excel import/export, carrier templates, order list export (SHIP-02, SHIP-07, SHIP-08, DATA-01)
- [x] 03-05-PLAN.md — Shipping UI: dashboard actions, combined shipping page, template mgmt, print labels (all SHIP + DATA-01)
**UI hint**: yes

### Phase 4: Inventory Management
**Goal**: Central inventory is tracked per product with automatic stock adjustments on order and return events, preventing overselling
**Depends on**: Phase 2
**Requirements**: INV-01, INV-02, INV-03, INV-04
**Success Criteria** (what must be TRUE):
  1. Admin can view and set inventory quantities for each product in a central inventory view
  2. When an order ships, inventory is automatically decremented (atomically, no race conditions)
  3. When an order is cancelled or returned, inventory is automatically restored
  4. Admin can manually adjust stock with a recorded reason (incoming stock, defective, physical count, etc.)
**Plans:** 2 plans
Plans:
- [x] 04-01-PLAN.md — Inventory schema, types, queries, stock adjustment actions, order status hooks (INV-01, INV-02, INV-03, INV-04)
- [x] 04-02-PLAN.md — Inventory management UI: data table, stock set/adjust dialogs, audit history viewer (INV-01, INV-04)
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
**Plans**: TBD
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
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6
Note: Phase 4 and Phase 5 can execute in parallel (Phase 4 depends on Phase 2, Phase 5 depends on Phase 1).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Marketplace Infrastructure | 3/3 | Complete | - |
| 2. Order Collection & Dashboard | 5/5 | Complete | - |
| 3. Shipping & Invoice Processing | 1/5 | Executing | - |
| 4. Inventory Management | 0/2 | Not started | - |
| 5. Product Management & Data | 0/TBD | Not started | - |
| 6. Marketplace Expansion | 0/TBD | Not started | - |
