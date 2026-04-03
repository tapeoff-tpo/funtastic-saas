---
phase: 03-shipping-invoice-processing
plan: 05
subsystem: shipping-ui
tags: [shipping-ui, invoice-upload, excel-import, excel-export, combined-shipping, label-print, carrier-templates]

requires:
  - phase: 03-02
    provides: "queueInvoiceUpload, bulkQueueInvoiceUpload server actions"
  - phase: 03-03
    provides: "findMergeCandidates, getShipmentGroups, confirmShipmentGroup, rejectShipmentGroup"
  - phase: 03-04
    provides: "exportToCarrierExcel, parseInvoiceExcel, matchInvoicesToOrders, exportOrdersToExcel, template CRUD, AVAILABLE_ORDER_FIELDS"
provides:
  - "ShippingActions toolbar on order dashboard with 6 action buttons"
  - "InvoiceUploadDialog with carrier selection and tracking number input (single/bulk)"
  - "ExcelImportDialog with column mapping, file preview, and bulk apply"
  - "Invoice status column (송장상태) in order table with tracking number display"
  - "GET /api/shipping/export endpoint for carrier/order-list Excel downloads"
  - "POST /api/shipping/import endpoint for Excel invoice parsing and matching"
  - "Combined shipping review page with confirm/reject per group"
  - "Template management page with column builder and seed defaults"
  - "Batch label print page with CSS @media print for A4 layout"
affects: [order-dashboard, shipping-workflow, 사방넷-replacement]

tech-stack:
  added: []
  patterns:
    - "Server actions for invoice upload (uploadInvoiceAction, bulkUploadInvoiceAction)"
    - "Form actions for confirm/reject shipment groups"
    - "Client components for interactive dialogs (file upload, column builder)"
    - "CSS @media print for print-optimized label rendering"
    - "API routes for Excel file streaming (Content-Disposition: attachment)"

key-files:
  created:
    - src/app/(auth)/orders/shipping-actions.tsx
    - src/app/(auth)/orders/invoice-upload-dialog.tsx
    - src/app/(auth)/orders/excel-import-dialog.tsx
    - src/app/api/shipping/export/route.ts
    - src/app/api/shipping/import/route.ts
    - src/app/(auth)/shipping/layout.tsx
    - src/app/(auth)/shipping/combined/page.tsx
    - src/app/(auth)/shipping/combined/client.tsx
    - src/app/(auth)/shipping/combined/actions.ts
    - src/app/(auth)/shipping/templates/page.tsx
    - src/app/(auth)/shipping/templates/client.tsx
    - src/app/(auth)/shipping/print/page.tsx
    - src/app/(auth)/shipping/print/print-button.tsx
  modified:
    - src/app/(auth)/orders/data-table.tsx
    - src/app/(auth)/orders/columns.tsx
    - src/app/(auth)/orders/actions.ts
    - src/app/(auth)/orders/page.tsx
    - src/lib/orders/queries.ts

decisions:
  - "ShippingActions rendered inside DataTable component (not page.tsx) since selection state lives in DataTable"
  - "Invoice status column uses latest shipment record per order for display"
  - "Print button extracted to client component for window.print() access"
  - "Template column builder uses up/down buttons for reordering (simpler than drag)"

metrics:
  duration: 9min
  completed: "2026-04-03T05:55:12Z"
  tasks_completed: 3
  files_created: 13
  files_modified: 5
---

# Phase 3 Plan 5: Shipping UI & Workflow Integration Summary

Full shipping workflow wired into admin UI with dashboard actions, 3 new shipping pages, and 2 API routes for Excel I/O.

## What Was Built

### Task 1: Order Dashboard Shipping Actions + API Routes
- **ShippingActions toolbar** with 6 buttons: 송장업로드, 엑셀 송장등록, 엑셀 내보내기 (택배사/주문목록), 합포장, 라벨인쇄
- **InvoiceUploadDialog** with carrier dropdown (14 Korean carriers), tracking number input, bulk support for multi-order selection
- **ExcelImportDialog** with file upload (.xlsx/.xls), configurable column mapping (1-20 columns), preview of first 5 matched rows, bulk apply
- **Invoice status column** (송장상태) added to order table showing pending/uploading/uploaded/failed/confirmed badges with tracking number
- **GET /api/shipping/export** streams .xlsx files for carrier-specific or order-list exports
- **POST /api/shipping/import** parses uploaded Excel, matches to orders, returns matched/unmatched/invalid counts
- **Server actions** uploadInvoiceAction and bulkUploadInvoiceAction added to orders/actions.ts
- **Orders query** extended to join shipments table for invoice status display

### Task 2: Combined Shipping, Templates, Print Pages
- **Combined shipping page** (/shipping/combined) displays shipment groups with confirm/reject buttons, status badges (suggested/confirmed/rejected/shipped), fulfillment code indicators (normal/frozen/large/mixed)
- **Detect new candidates** button triggers findMergeCandidates and creates shipment groups
- **Template management page** (/shipping/templates) lists carrier templates with column details, seed defaults button, delete with confirmation, new template creator with interactive column builder (add/remove/reorder fields from AVAILABLE_ORDER_FIELDS)
- **Print page** (/shipping/print?ids=...) renders 2-up A4 labels with recipient info, address, product summary, tracking number; CSS @media print hides controls and enables page breaks
- **Shipping layout** with breadcrumb navigation back to orders

### Task 3: Checkpoint (Auto-approved)
Checkpoint auto-approved per user directive to move fast.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ShippingActions rendered inside DataTable instead of page.tsx**
- **Found during:** Task 1
- **Issue:** page.tsx is a server component and cannot manage client-side row selection state. ShippingActions needs selectedOrderIds from TanStack Table.
- **Fix:** Imported and rendered ShippingActions inside DataTable component which already computes selectedIds.
- **Files modified:** src/app/(auth)/orders/data-table.tsx

**2. [Rule 1 - Bug] Print button extracted to client component**
- **Found during:** Task 2
- **Issue:** window.print() requires client-side JavaScript; server component cannot use onClick.
- **Fix:** Created separate PrintButtonClient component with 'use client' directive.
- **Files created:** src/app/(auth)/shipping/print/print-button.tsx

**3. [Rule 2 - Missing] Orders query extended to join shipments**
- **Found during:** Task 1
- **Issue:** getOrders did not include shipment data, making invoice status column impossible to populate.
- **Fix:** Added shipments table query and mapping of latest shipment per order (uploadStatus, trackingNumber).
- **Files modified:** src/lib/orders/queries.ts

## Known Stubs

- `userId = 'placeholder-user-id'` in server actions and API routes -- will be replaced when Supabase auth session integration is wired (all files use this placeholder consistently)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 029b29d | Shipping actions, invoice dialog, Excel API routes |
| 2 | 78ebb0d | Combined shipping, templates, print pages |

## Self-Check: PASSED

All 13 created files verified present. Both task commits (029b29d, 78ebb0d) verified in git log.
