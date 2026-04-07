---
phase: quick
plan: 260407-ohi
subsystem: orders
tags: [excel, import, orders]
dependency_graph:
  requires: [orders-schema, exceljs]
  provides: [order-excel-import, order-excel-template]
  affects: [orders-page]
tech_stack:
  added: []
  patterns: [excel-import-with-zod, skip-on-duplicate, drag-drop-upload]
key_files:
  created:
    - src/lib/orders/excel-import.ts
    - src/lib/orders/excel-template.ts
    - src/app/api/orders/import/route.ts
    - src/app/api/orders/import/template/route.ts
    - src/app/(auth)/orders/import/page.tsx
  modified:
    - src/lib/db/schema.ts
    - src/app/(auth)/orders/page.tsx
decisions:
  - Skip-on-duplicate instead of upsert for manual Excel imports
  - Single recipientAddress field instead of address1/address2 split
  - connectionId=null for manual imports (no marketplace connection)
metrics:
  duration: 6min
  completed: 2026-04-07
---

# Quick Task 260407-ohi: Excel Order Import Summary

Excel order import with Korean-header .xlsx parsing, Zod row validation, skip-on-duplicate insert, and drag-and-drop upload page.

## What Was Done

### Task 1: Schema migration + Excel parser + template generator (f047ff0)

- Made `connectionId` nullable in `orders` table schema (removed `.notNull()`) to support manual imports without a marketplace connection
- Rewrote `excel-import.ts` with plan-specified Korean headers (주문번호, 주문자명, 수령자명, 수령자주소, 수령자전화, 우편번호, 주문일시, 상품명, 옵션, 수량, 금액(원), SKU)
- Header auto-detection from row 1 with required header validation
- Zod schema validates each row with Korean error messages
- Rewrote `excel-template.ts` with matching headers, light gray header fill, bold font, and one example row
- Verified template round-trips through parser (1 row parsed, 0 errors)

### Task 2: Upload API routes + import page + orders page link (06bd538)

- `POST /api/orders/import`: Accepts FormData (file + marketplaceId), authenticates via Supabase, parses Excel, groups rows by orderNumber, checks for existing orders (skip duplicates), inserts in a single transaction with `connectionId=null` and `status='confirmed'`
- `GET /api/orders/import/template`: Returns downloadable .xlsx template (no auth required)
- Import page (`/orders/import`): Drag-and-drop file upload zone, marketplace text input, upload button with loading spinner, results display showing inserted/skipped/error counts
- Orders page: Added "엑셀 업로드" link in header next to order count

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing files required rewrite instead of creation**
- **Found during:** Task 1
- **Issue:** All 5 "new" files already existed with a different schema (address1/address2 split, unitPrice instead of totalAmount, upsert instead of skip)
- **Fix:** Rewrote all files to match plan specifications exactly
- **Files modified:** All plan files

**2. [Rule 1 - Bug] Template route Buffer type error**
- **Found during:** Task 2
- **Issue:** `new NextResponse(buffer)` fails TypeScript because Node.js 24 Buffer is not assignable to BodyInit
- **Fix:** Changed to `new Response(new Uint8Array(buffer))` and removed unused NextResponse import
- **Files modified:** src/app/api/orders/import/template/route.ts

## Verification

- Template round-trip: generateOrderTemplate -> parseOrderExcel returns 1 row, 0 errors
- TypeScript check: No errors in plan files (pre-existing errors in unrelated files)
- Response format: `{ inserted, skipped, errors: [{ row, message }] }`

## Known Stubs

None - all data paths are wired end-to-end.
