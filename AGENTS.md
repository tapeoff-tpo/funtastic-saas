<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
## Project Critical Rules

### Order Data Invariants

- Once an order has been collected, marketplace collection must not re-collect, overwrite, downgrade, or otherwise mutate that existing order. Existing `(marketplace_id, marketplace_order_id)` rows are immutable from collection paths; duplicate collection must skip or no-op.
- This duplicate-collection rule applies to every marketplace and every integration path: API, RPA, Excel import, connected-mall adapters, and future adapters. A later collection of the same `(user_id, marketplace_id, marketplace_order_id)` must never create an additional visible order row for the same marketplace order.
- Split/copy rows (`orders.is_copy = true`) are part of the same marketplace order, not a reason to bypass duplicate protection. Re-collection must reuse/update the existing split rows, remove stale extra split rows, and remove all split rows when the refreshed marketplace order has become a single-item order.
- Do not change the `orders_marketplace_unique` partial unique-index behavior or add collection code that bypasses `saveNormalizedOrdersForConnection`, `upsertOrder`, or `ensureSplitOrderCopies` unless the replacement preserves the same all-market dedupe guarantees.
- Marketplace order source data and collected order items are the original record. Do not change collected product name, collected option text, raw marketplace payload, order quantity, or marketplace status as a side effect of later collection.
- Product mapping rules and per-order confirmed item overrides are separate concepts.
- Mapping rules (`mapping_codes`, `mapping_sources`, `mapping_components`) define how future or unmapped marketplace product/option combinations resolve to internal SKU components. Changing an individual order must not create, edit, delete, or infer mapping rules unless the user explicitly asks for mapping changes.
- Per-order confirmed item overrides (`order_items.locked_*`) are manual shipping-confirmation values for one specific order only: confirmed product name, confirmed option name, confirmed quantity, and locked SKU snapshot. They must never propagate to other orders and must never be treated as mapping changes.
- Manual confirmed item overrides may be edited only before shipment is completed: `new`, `confirmed`, `preparing`, and `ready`. From `shipped` onward, confirmed item details are closed for editing.
- Manual confirmed item overrides must preserve the collected source order and marketplace data. They are an internal outbound/shipping decision, not a marketplace order modification.

### Collection Responsibility Policy

- All-market order collection must stay fast. `/orders/collect` is responsible only for collecting new marketplace order source data. It must never move an order into `confirmed`; 확인 is reached only after local mapping is applied and the user confirms the order.
- Marketplace order collection must stay isolated per marketplace and per integration path. Do not make one API/RPA agent collect every mall in a single browser/session/task. Each marketplace should have its own adapter/scraper/worker path so failures, timeouts, logins, and DOM changes do not affect other marketplaces.
- Keep API, RPA, Excel, and connected-mall collection paths independent. Shared orchestration may enqueue or summarize work, but the actual collection logic must run through the marketplace-specific agent.
- Independent RPA marketplaces currently include 도매창고(`domechango`), 바나나B2B(`banana-b2b`), 온채널(`onchannel`), 투비즈온(`tobizon`), 도매의신(`domesin`), and 올웨이즈(`always`). Keep each one on its own scraper path.
- Domechango order collection and invoice upload RPA must remain independent and fixed to the Domechango scraper flow. Do not merge Domechango RPA into a generic all-mall RPA agent or rewrite it into shared browser automation unless the user explicitly asks to redesign that integration.
- Do not add inquiry, claim, return-inspection, or unrelated CS collection work to the all-market order collection path.
- Marketplace inquiries must be collected from the dedicated CS inquiry collection button/page, not as a side effect of order collection.
- Inquiry collection must keep API and RPA paths separate: API inquiries use adapter `getInquiries`, while RPA inquiries use scraper `getInquiries` from marketplace customer inquiry/1:1 boards.
- When adding or changing marketplace integrations, keep `getOrders` / order confirmation logic separate from `getInquiries` / CS claim logic so a slow CS endpoint cannot block daily order collection.

### Admin Account Policy

- Operational data is shared across all admin accounts.
- `admin123` is the canonical workspace owner and the source of truth for shared data.
- Other admin accounts exist only for login identity, permissions, and audit tracking.
- Switching accounts must not change visible business data.
- Orders, marketplace connections, products, inventory, mapping codes, mapping components, carrier templates, company settings, shipping data, and order-management settings must not become account-specific unless the user explicitly requests isolated workspaces.
- When adding queries or mutations for operational data, resolve the workspace owner with `getWorkspaceUserId(user.id)` before reading or writing user-scoped tables.

### Purchasing Operations Policy

- The purchasing workflow is an operational workflow, not a marketing or analytics-only feature. Keep purchasing data shared under the canonical workspace owner.
- The active purchasing statuses are: `발주검토`, `발주요청`, `구매완료`, `중국창고도착`, `중국출고요청`, and `중국출고완료`.
- `발주검토` is managed as its own review page. The main `발주` page manages `발주요청` through `중국출고완료` in one place.
- The old purchase/shipping/arrival tab split must not be reintroduced unless the user explicitly asks for it.
- Moving an item from `발주검토` to `발주요청` must set the `발주요청 날짜` automatically to the move date, while still allowing the user to manually edit the date afterward.
- `발주요청` items that remain unpurchased for 7 days from `발주요청 날짜` are delayed and must be visible in the separate `구매/입고지연` page.
- `구매완료` items that remain unarrived for 7 days from purchase date are delayed and must be visible in the separate `구매/입고지연` page.
- Delayed items may be visually highlighted in their source status list, but do not force them to the top of the normal status list. The dedicated `구매/입고지연` page is the primary delay work queue.
- `구매/입고지연` must support filtering by source status so purchasing-request delays and purchase-arrival delays can be reviewed separately.
- Purchase URL data is item master data. Display it compactly in lists, but keep the full URL editable and clickable.
- 1688 URL collection is a temporary operational tool. It may be hidden from the UI after the collection project is complete, but keep the code, Git history, extension package, and already-collected item URLs unless the user explicitly asks to remove them.
- If production deployment is needed while 1688 URL collection is running, pause/stop the collection first, deploy the new version, refresh the item master page, verify the extension connection, and then restart collection from the saved checkpoint.
- 1688 URL collection checkpoints are resumable. A deployment may interrupt the visible collection session, but it must not clear already-collected URLs or force a full restart.

### Item Master Excel Policy

- Item master Excel upload must never be a destructive full replacement.
- `품목코드` is the stable matching key for item Excel upload and download. It must always be included in upload templates and selected downloads.
- Blank cells in uploaded Excel files mean "keep the existing value" unless the user explicitly chooses a destructive clear operation.
- Excel upload must update only the selected/allowed columns. Do not overwrite unrelated existing item data from an uploaded file.
- Excel upload must never delete existing items.
- Default item upload behavior should be: add new items when possible, and update only cost-related fields plus `구매 URL`.
- New item creation from Excel requires at least `품목코드` and `품목명`.
- For existing items, partial Excel files are allowed. A file may contain only `품목코드` plus the fields to update, such as `works 신규 원가` or `구매 URL`.
- Item Excel upload must show a preview before applying changes. The preview should separate new items, changed items, unchanged items, skipped rows, and invalid rows.
- Item Excel download should allow the user to choose which columns to export. It should also provide an upload-template download using the selected columns.

### Sabangnet Review And Purchasing Metrics Policy

- Current-month outgoing quantity for purchasing review must be calculated from files imported through `사방넷 검수`, not from the manually entered item master values.
- Use the Sabangnet review file's `출고완료일자` as the primary date for assigning outgoing quantity to a month. Order date and collection date are fallbacks only when the shipment completion date is unavailable.
- The manually entered three-month average outgoing quantity is authoritative for now and must not be overwritten automatically.
- The manual three-month average is a completed-period baseline through the previous month. Never subtract current-month outgoing quantity from that baseline to reconstruct prior-month demand.
- When a new monthly Sabangnet review file is imported, update the current-month outgoing quantity for matching SKUs from that month's reviewed data.
- For July 2026, the current-month outgoing quantity should come from July Sabangnet review data, while the three-month average remains the user's manually entered average through June 2026.
- From August 2026 onward, the purchasing metric logic may combine the user's manually entered baseline with July Sabangnet review data to calculate rolling averages, but do not switch to automatic overwrite without preserving the user's manual baseline and the agreed calculation rule.
- Purchasing recommendation logic must distinguish abnormal one-off bulk orders from repeatable demand. A single large one-off order should not inflate recommended purchase quantity by itself.
- If large orders recur regularly for the same SKU, treat them as demand and allow them to affect purchasing recommendations.
- If an item had little or no prior sales and suddenly begins selling, flag it for purchasing review and allow the recommendation logic to account for the new demand instead of ignoring it as noise.
- Existing active purchasing rows must not block additional recommendations by SKU. Count requested, purchased, purchase-completed, China-arrived, and outbound-requested quantities as pipeline stock, then recommend only the remaining shortage when current stock plus pipeline quantity is still below target.
- Product MOQ rules apply across all child options for the same product group. For `테피 USB 캔들라이터`, `루멘 철제 사이드 테이블`, and `린블 아기옷 원형 건조대`, the automatic purchasing recommendation must meet at least 200 total units across options when any option is recommended, and recommended option quantities should be rounded to 10-unit increments.
- A won budget must never break a product MOQ rule. Treat each MOQ product group as one atomic budget unit: include every recommended option at its full MOQ-adjusted quantity only when the whole group fits the remaining budget; otherwise exclude the whole group instead of partially allocating it.
- Spike/anomaly handling must be explainable in the recommendation basis so the user can see whether a quantity was reduced, ignored, or included due to demand pattern checks.
- Purchasing workflow matching must use `purchase_management_code + sku` as the primary key when `purchase_management_code` exists.
- If `purchase_management_code` is blank or unreliable, fall back to `supplier_order_number + sku` and keep that fallback match key in `raw_data`.
- When importing or reconciling purchasing Excel files that include both `purchase_management_code` and `supplier_order_number`, cross-check both match keys and report mismatches before assuming the import is clean.
- Do not blindly collapse rows by `supplier_order_number + sku` when `purchase_management_code` exists. Some supplier order cells contain non-order memo values, and a single supplier order can contain multiple purchase management codes for the same SKU.
- Treat `supplier_order_number + sku` as an import fallback only when the supplier order number looks like a real order number and the purchase management code is missing.

### Operations Tools Policy

- `견적서` belongs under the `운영` category.
- `AI 계정공유` belongs under the `운영` category.
- AI account sharing tracks accounts by account name, account ID, current user(s), status, and limits. Status changes such as `사용시작`, `사용종료`, `사용종료(5시간초과)`, and `사용종료(주간초과)` must be logged as memos.
- Multiple current users may use one AI account at the same time, and user start/end events must be independent rather than merged into one shared selection state.
- If all current users end usage, the account status becomes `비어 있음`. If any usage ends due to a 5-hour or weekly limit, the visible status should indicate `한도 초과`.

### Deployment

- Production is deployed on Vercel from the GitHub `main` branch.
- After production fixes, run a production build when practical, commit changes, push to `origin main`, and verify the Vercel production URL responds.
- When production deployment should be delayed, save work to a feature branch instead of pushing to `main`.
- If a feature is saved on a non-production branch and the user later approves production release, merge that branch into `main`, push `origin main`, and verify the Vercel production deployment.

## 자동형 작업 운영

요청이 명확하고 범위가 정해져 있으면 중간 승인을 반복해서 묻지 말고 관련 코드 확인, 구현, 검증, 커밋, `origin main` 푸시, Vercel 운영 배포 및 공개 주소 확인까지 이어서 수행한다.

- 요청과 직접 관련된 파일만 수정하고 커밋한다.
- 필수 검증에 실패하면 푸시하거나 배포하지 않는다.
- 현재 변경 때문에 발생한 실패는 원인을 확인하고 수정한다.
- 기존에 있던 무관한 실패나 사용자 변경사항은 임의로 수정, 삭제, 되돌리거나 현재 커밋에 포함하지 않는다.
- 완료 보고에는 변경 내용, 검증 결과, 커밋 및 배포 상태를 포함한다.

다음 작업은 실행 전에 반드시 사용자 승인을 받는다.

- 운영 데이터를 삭제하거나 되돌리기 어렵게 덮어쓰는 작업
- 파괴적이거나 복구가 어려운 운영 데이터베이스 변경
- 인증 정보나 비밀값을 변경, 노출, 교체 또는 삭제하는 작업
- 보안 또는 접근 제어 장치를 의도적으로 해제하는 작업
- 요청 내용이나 운영 배포 대상이 불분명한 상태에서의 배포
