---
phase: "03"
plan: "02"
subsystem: shipping-invoice-processing
tags: [invoice-upload, marketplace-api, bullmq, coupang, naver]
dependency_graph:
  requires: [03-01]
  provides: [invoice-upload-pipeline, marketplace-upload-adapters]
  affects: [03-03, 03-04, 03-05]
tech_stack:
  added: []
  patterns: [tdd, adapter-pattern, bullmq-worker, server-actions]
key_files:
  created:
    - src/lib/jobs/workers/invoice-uploader.ts
    - src/lib/shipping/actions.ts
    - tests/shipping/invoice-upload.test.ts
    - tests/shipping/invoice-worker.test.ts
  modified:
    - src/lib/marketplace/adapters/coupang/adapter.ts
    - src/lib/marketplace/adapters/naver/adapter.ts
    - src/lib/jobs/queues.ts
    - worker.ts
decisions:
  - "Naver two-step upload: place-order confirmation optional via requiresConfirmation flag"
  - "Worker rate limit: 2 req/s conservative default (Naver limit)"
  - "Worker concurrency: 1 to stay within marketplace API rate limits"
metrics:
  duration: "7min"
  completed: "2026-04-03"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 15
  files_changed: 8
requirements: [SHIP-01]
---

# Phase 03 Plan 02: Invoice Upload Pipeline Summary

Coupang PUT with HMAC-signed orderSheetInvoiceApplyDtos and Naver two-step place-order + dispatch, processed by BullMQ worker with 3-attempt exponential backoff and per-marketplace rate limiting.

## What Was Built

### Task 1: Coupang and Naver uploadInvoice() Adapter Methods

Replaced uploadInvoice stubs in both marketplace adapters with real API implementations:

**Coupang adapter**: PUT to `/v4/vendors/{vendorId}/orders/invoices` with body containing `vendorId`, `orderSheetInvoiceApplyDtos` array (shipmentBoxId, orderId, vendorItemId, deliveryCompanyCode, invoiceNumber). Uses HMAC-SHA256 auth from existing client. Returns `{ success: true }` on code 200/SUCCESS, `{ success: false, error }` otherwise.

**Naver adapter**: Two-step process per research Pitfall 3. Step 1 (optional): POST to `place-order` endpoint to confirm orders. Step 2: POST to `dispatch` endpoint with deliveryMethod, deliveryCompanyCode, trackingNumber, and dispatchDate. Checks failProductOrderIds in response. Uses OAuth2 token from existing client.

Both adapters use `mapCarrierCode()` for marketplace-specific carrier code translation and wrap all calls in try/catch.

**Commit:** 3cd8e1c | 9 tests

### Task 2: BullMQ Invoice Upload Worker, Queue, and Server Actions

Built the full pipeline from server action to marketplace API call:

**Queue** (`src/lib/jobs/queues.ts`): Added `invoiceUploadQueue` and `queueInvoiceUploadJob()` with BullMQ options: 3 attempts, exponential backoff (5s base), removeOnComplete/Fail retention.

**Worker** (`src/lib/jobs/workers/invoice-uploader.ts`): `processInvoiceUpload` sets shipment status to 'uploading', calls adapter.uploadInvoice(), then updates to 'uploaded' or 'failed'. Throws on failure to trigger BullMQ retry. `createInvoiceUploadWorker()` creates the BullMQ Worker with concurrency 1 and rate limiter (2/s).

**Server actions** (`src/lib/shipping/actions.ts`): `queueInvoiceUpload()` looks up order context, creates shipment record via `createShipment()`, and adds a BullMQ job. `bulkQueueInvoiceUpload()` processes an array of orders, collecting errors without stopping.

**Worker entry** (`worker.ts`): Starts both order collection and invoice upload workers with unified graceful shutdown.

**Commit:** f1b8d2a | 6 tests

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Naver requiresConfirmation as optional flag | Not all Naver orders need place-order confirmation; caller decides based on order status |
| Worker rate limit 2 req/s | Conservative default matching Naver's API limit; Coupang allows more but shared worker means lowest common denominator |
| Worker concurrency 1 | Single concurrent job prevents rate limit violations across marketplace APIs |

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all planned functionality is implemented and tested.

## Test Coverage

| Test File | Tests | What's Verified |
|-----------|-------|-----------------|
| tests/shipping/invoice-upload.test.ts | 9 | Coupang PUT body shape, success/error paths, Naver two-step flow, place-order skip, dispatch params, failProductOrderIds handling |
| tests/shipping/invoice-worker.test.ts | 6 | Worker calls adapter correctly, status transitions (uploading/uploaded/failed), queueInvoiceUpload creates shipment + job, bulkQueueInvoiceUpload queues multiple |

## Self-Check: PASSED

All 8 key files verified present. Both commit hashes (3cd8e1c, f1b8d2a) confirmed in git log.
