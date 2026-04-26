# Deferred Items — Phase 08

Pre-existing TypeScript errors found during 08-01 execution but unrelated to plan scope.
These existed before Phase 8 and should be addressed in a separate quick task or future phase.

## Pre-existing TypeScript errors (out of scope for 08-01)

| File | Line | Error | Notes |
|------|------|-------|-------|
| src/__tests__/marketplace/registry.test.ts | 7 | Mock adapter missing confirmOrder/registerProduct/updateProduct | Pre-existing test fixture stale |
| src/lib/marketplace/adapters/cafe24/adapter.ts | 312 | variant price could be undefined | Pre-existing typing gap |
| src/lib/marketplace/adapters/coupang/adapter.ts | 25-27, 283 | Missing CoupangSellerProduct exports | Pre-existing — Phase 7 adapter |
| src/lib/products/carrier-excel.ts | 92 | dataValidations missing on Worksheet | ExcelJS typing — pre-existing |
| src/lib/products/reverse-collect.ts | 229, 244 | Insert overload + variants undefined | Pre-existing |
| src/lib/shipping/actions.ts | 67 | string \| null assigned to string | Pre-existing |
| tests/marketplace/elevenst.test.ts | 10 | Missing handlers exports | Pre-existing helper gap |
| tests/marketplace/esm.test.ts | 255 | "G" vs "A" comparison | Pre-existing test typo |
| tests/shipping/invoice-upload.test.ts | 58+ | Tuple length errors | Pre-existing test fixture |
| worker.ts | 8 | connection vs getConnection | Pre-existing import |

## Action

Do NOT attempt to fix in Phase 8. File a separate quick task: `npx tsc --noEmit` cleanup.

Verified my Plan 08-01 changes do not introduce new errors:
- `tsc 2>&1 | grep -iE "shippingType|shippingFee|shippingCost|NormalizedInquiry|getInquiries|inquiries"` returns 0 matches.

## Plan 08-03 follow-up (2026-04-26)

Re-ran `npx tsc --noEmit` after the orders UI refactor. The same pre-existing errors above remain. One additional out-of-scope error:

| File | Line | Error | Notes |
|------|------|-------|-------|
| src/app/(auth)/orders/bulk-mapping-dialog.tsx | 329 | `<ProductSearch initialValue={...} />` — ProductSearch does not accept `initialValue` | Pre-existing — last touched by commit 71114f6 (bundle/세트구성), unrelated to Plan 08-03's column/tab/query refactor. |

Plan-08-03 scope (`src/lib/orders/`, `src/app/(auth)/orders/{page,columns,order-tabs,stage-tabs,claims-filter}.tsx`, `tests/orders/`):
- `npx tsc --noEmit 2>&1 | grep -E "(src/app/\(auth\)/orders/(page|columns|order-tabs|data-table)|src/lib/orders|tests/orders)"` returns 0 matches.
- `npm run build` → ✓ Compiled successfully.

### Bash tool denial — vitest not runnable

The execution environment denied `npx vitest run`, `npm test`, and `npm test --` invocations during Plan 08-03 execution. Test files were authored to spec (RED→GREEN per TDD), but the GREEN run could not be observed in this session.

Manual verification required before merge:
- `npx vitest run tests/orders --reporter=dot`
- Expect: get-orders.test.ts (3), get-order-stats.test.ts (2), order-tabs.test.tsx (4), page-header.test.tsx (1), columns.test.tsx (9) → all pass.

Static evidence covering the same surface:
- `npx tsc --noEmit` (orders scope) → 0 errors.
- `npm run build` → succeeds.
- All grep acceptance criteria from PLAN.md → confirmed (see SUMMARY).
