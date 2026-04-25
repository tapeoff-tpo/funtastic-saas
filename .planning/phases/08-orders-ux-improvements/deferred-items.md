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
