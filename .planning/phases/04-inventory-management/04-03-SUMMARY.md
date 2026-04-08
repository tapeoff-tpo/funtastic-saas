---
phase: 04-inventory-management
plan: 03
subsystem: ui
tags: [inventory, picking-location, warehouse-filter, excel-upload, nuqs]

requires:
  - phase: 04-inventory-management/01
    provides: inventory schema, types, queries, actions
  - phase: 04-inventory-management/02
    provides: inventory page, table, dialogs
provides:
  - warehouseZone and sectorCode columns in inventory table
  - Warehouse zone filter dropdown via nuqs URL state
  - Picking location fields in stock registration form
  - Excel bulk upload dialog with result display
affects: [04-inventory-management]

tech-stack:
  added: []
  patterns: [warehouse zone filter via nuqs, excel upload dialog with FormData POST]

key-files:
  created:
    - src/app/(auth)/inventory/excel-upload-dialog.tsx
  modified:
    - src/lib/db/schema.ts
    - src/lib/inventory/types.ts
    - src/lib/inventory/queries.ts
    - src/lib/inventory/actions.ts
    - src/app/(auth)/inventory/actions.ts
    - src/app/(auth)/inventory/page.tsx
    - src/app/(auth)/inventory/inventory-table.tsx
    - src/app/(auth)/inventory/adjust-stock-dialog.tsx

key-decisions:
  - "warehouseZone and sectorCode added as nullable varchar(100) columns to inventory table"
  - "Warehouse zone filter uses nuqs parseAsString for URL state persistence"
  - "Excel upload dialog POSTs FormData to /api/inventory/bulk-upload endpoint"

patterns-established:
  - "Distinct warehouse zone query for filter dropdown population"
  - "Excel upload dialog pattern: file input, upload with result summary, done with router.refresh()"

requirements-completed: [INV-01, INV-04]

duration: 4min
completed: 2026-04-08
---

# Phase 04 Plan 03: Inventory UI Enhancements Summary

**Picking location columns (warehouseZone/sectorCode) in inventory table, warehouse zone filter dropdown, location fields in registration form, and Excel bulk upload dialog**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-08T14:59:03Z
- **Completed:** 2026-04-08T15:03:24Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added warehouseZone and sectorCode columns to inventory DB schema, types, queries, and actions
- Inventory table now shows picking location columns (창고, 피킹위치) with sort buttons
- Warehouse zone filter dropdown populates from distinct warehouse zones in the database
- Stock registration form includes 창고 and 피킹위치 input fields in set mode only
- Excel upload dialog handles file selection (.xlsx/.xls), uploads via FormData POST, and displays success/failure results
- setStock action now accepts and persists warehouseZone and sectorCode parameters

## Task Commits

Each task was committed atomically:

1. **Task 1: Add picking location columns, warehouse filter, and Excel upload button** - `07f44fe` (feat)
2. **Task 2: Add picking location fields to registration form** - `c884602` (feat)

## Files Created/Modified
- `src/lib/db/schema.ts` - Added warehouseZone and sectorCode columns to inventory table
- `src/lib/inventory/types.ts` - Added warehouseZone, sectorCode to InventoryRecord; warehouseZone to InventoryFilters
- `src/lib/inventory/queries.ts` - Added warehouseZone filter condition and sort columns
- `src/lib/inventory/actions.ts` - Updated setStock to accept warehouseZone/sectorCode options
- `src/app/(auth)/inventory/actions.ts` - Pass warehouseZone/sectorCode from FormData to setStock
- `src/app/(auth)/inventory/page.tsx` - Added warehouseZone to searchParamsCache, distinct zone query, pass warehouseZones prop
- `src/app/(auth)/inventory/inventory-table.tsx` - Added warehouseZone/sectorCode columns, warehouse filter dropdown, Excel upload button
- `src/app/(auth)/inventory/adjust-stock-dialog.tsx` - Added warehouseZone and sectorCode inputs in set mode
- `src/app/(auth)/inventory/excel-upload-dialog.tsx` - New Excel upload dialog with file input, upload, and result display

## Decisions Made
- warehouseZone and sectorCode added as nullable varchar(100) to allow gradual population
- Warehouse zone filter uses nuqs for URL state persistence (bookmarkable filtered views)
- Excel upload dialog POSTs to /api/inventory/bulk-upload (API route to be implemented separately)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added warehouseZone/sectorCode to schema, types, queries, and actions**
- **Found during:** Task 1
- **Issue:** Plan assumed warehouseZone and sectorCode fields existed in schema/types from prior plans, but they were not present
- **Fix:** Added fields to schema.ts, types.ts, queries.ts, and actions.ts as nullable columns
- **Files modified:** src/lib/db/schema.ts, src/lib/inventory/types.ts, src/lib/inventory/queries.ts, src/lib/inventory/actions.ts, src/app/(auth)/inventory/actions.ts
- **Commit:** 07f44fe

**2. [Rule 3 - Blocking] Created ExcelUploadDialog in Task 1 instead of Task 2**
- **Found during:** Task 1
- **Issue:** inventory-table.tsx imports ExcelUploadDialog, so it must exist for TSC to pass at Task 1 verification
- **Fix:** Created the full ExcelUploadDialog component during Task 1
- **Files modified:** src/app/(auth)/inventory/excel-upload-dialog.tsx
- **Commit:** 07f44fe

## Known Stubs

- **Excel bulk upload API route** (`/api/inventory/bulk-upload`): The ExcelUploadDialog POSTs to this endpoint, but the API route does not exist yet. This is intentional -- the plan specifies the UI dialog only, and the API route is a separate concern (likely requiring ExcelJS parsing logic). The dialog will show an error result if the endpoint is not available.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Inventory UI enhancements complete
- API route /api/inventory/bulk-upload needs to be implemented for Excel upload to function end-to-end

## Self-Check: PASSED

All 9 files verified present. Both task commits (07f44fe, c884602) verified in git log.
