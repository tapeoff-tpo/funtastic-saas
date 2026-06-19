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

### Deployment

- Production is deployed on Railway from the GitHub `main` branch.
- After production fixes, run a production build when practical, commit changes, push to `origin main`, and verify the Railway URL responds.

## 자동형 작업 운영

요청이 명확하고 범위가 정해져 있으면 중간 승인을 반복해서 묻지 말고 관련 코드 확인, 구현, 검증, 커밋, `origin main` 푸시, Railway 운영 배포 및 공개 주소 확인까지 이어서 수행한다.

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
