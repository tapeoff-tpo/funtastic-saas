---
phase: 03-shipping-invoice-processing
plan: "06"
subsystem: shipping-excel
tags: [schema, product-mappings, cj-export, picking-location]
dependency_graph:
  requires: []
  provides: [pickingLocation-in-cj-excel]
  affects: [apply-mappings, cj-export, shipping-export]
tech_stack:
  added: []
  patterns: [map-value-object-extension]
key_files:
  created: []
  modified:
    - src/lib/db/schema.ts
    - src/lib/products/apply-mappings.ts
    - src/lib/shipping/excel/cj-export.ts
    - src/app/api/shipping/cj/export/route.ts
    - src/app/api/shipping/export/route.ts
decisions:
  - "pickingLocation stored on productNameMappings (not inventory) so it travels with the display name mapping already used during export"
  - "MappingEntry interface exported from apply-mappings.ts so callers can type their fallback maps correctly"
metrics:
  duration: ~10min
  completed: 2026-04-09
  tasks_completed: 2
  files_changed: 5
---

# Phase 03 Plan 06: Picking Location in CJ Export Summary

Added `pickingLocation` field to `productNameMappings` schema table and wired it through the mapping lookup and CJ Excel export so warehouse workers see the picking location (e.g. `1창고 A-01-03`) in the 위치 column (column 24) of the CJ packing slip.

## What Was Done

### Task 1: Schema + mapping lookup extension
- Added `pickingLocation: varchar('picking_location', { length: 100 })` to `productNameMappings` table in `schema.ts`. The `inventory` table already had `warehouseZone` and `sectorCode` from Phase 4 — those were left untouched.
- Changed `loadMappingLookup` return type from `Map<string, string>` to `Map<string, MappingEntry>` where `MappingEntry = { displayName: string; pickingLocation: string | null }`.
- `applyMappings` return type updated to spread `pickingLocation` onto mapped items.
- Exported `MappingEntry` interface for callers.

### Task 2: CJ export wiring
- Added `pickingLocation?: string` to `CjOrderRow` interface in `cj-export.ts`.
- `generateCjExcel` now writes `row.pickingLocation ?? ''` to column 24 (위치) instead of a hardcoded empty string.
- CJ export route (`/api/shipping/cj/export/route.ts`) passes `firstItem?.pickingLocation ?? undefined` into the `CjOrderRow`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed type mismatch in generic shipping export route**
- **Found during:** Task 2 TypeScript check
- **Issue:** `/api/shipping/export/route.ts` used `new Map<string, string>()` as unauthenticated fallback, which is now incompatible with `Map<string, MappingEntry>` expected by `applyMappings`.
- **Fix:** Changed fallback to `new Map<string, MappingEntry>()` and imported `MappingEntry` type.
- **Files modified:** `src/app/api/shipping/export/route.ts`
- **Commit:** 6042c51

## Known Stubs

None. `pickingLocation` is nullable by design — rows without a picking location will render an empty string in the 위치 column, which is correct behavior (field was previously always empty).

## Self-Check: PASSED

- src/lib/db/schema.ts — pickingLocation column present on productNameMappings
- src/lib/products/apply-mappings.ts — MappingEntry interface exported, loadMappingLookup returns Map<string, MappingEntry>
- src/lib/shipping/excel/cj-export.ts — CjOrderRow.pickingLocation field present, written to column 24
- src/app/api/shipping/cj/export/route.ts — pickingLocation passed from mapped item
- src/app/api/shipping/export/route.ts — fallback map uses MappingEntry type
- Commit 6042c51 verified present
- npx tsc --noEmit: no errors in plan-modified files
