# Phase 3: Shipping & Invoice Processing - Research

**Researched:** 2026-04-03
**Domain:** Marketplace invoice upload APIs, combined shipping logic, carrier Excel export, shipping label printing
**Confidence:** MEDIUM-HIGH

## Summary

Phase 3 is the critical "사방넷 switching trigger" -- once invoice upload works reliably, the subscription can be cancelled. The phase covers four major areas: (1) implementing Coupang and Naver `uploadInvoice()` adapter methods with BullMQ-based bulk processing, (2) building combined shipping (합포장) detection with 출고편집코드-based auto-separation and max-pack-quantity limits, (3) carrier-specific Excel export using ExcelJS with customizable templates, and (4) browser-based batch shipping label printing.

The existing codebase provides strong foundations: marketplace adapters with stub `uploadInvoice()` methods, BullMQ queue infrastructure, Drizzle ORM schema with orders/order_items tables, and a TanStack Table-based order dashboard. The main work involves implementing the invoice upload API calls, extending the DB schema with shipping/invoice tracking fields, building the combined shipping algorithm, and creating the Excel export and print subsystems.

**Primary recommendation:** Build invoice upload first (SHIP-01 is the core value), then combined shipping detection (SHIP-04/05), then Excel export (SHIP-07/08, DATA-01), then label printing (SHIP-03) and Excel import (SHIP-02) last. Each piece can be tested independently.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use existing Coupang/Naver adapter uploadInvoice() methods. Bulk upload via BullMQ job queue.
- **D-02:** Track upload status per order (pending/uploaded/failed/confirmed). Retry failed uploads automatically.
- **D-03:** ExcelJS for reading uploaded Excel files. Column mapping configurable per carrier format.
- **D-04:** Upload flow: user uploads Excel -> system parses -> matches to orders -> bulk updates invoice numbers.
- **D-05:** Auto-detect: same buyer name + same address + within same day = merge candidate.
- **D-06:** 출고편집코드 기반 자동분리: 냉동/상온, 대형/소형 등 상품 속성별 분리.
- **D-07:** 최대합포장수량 설정: 박스 크기 제한으로 N개 이상은 자동 분할.
- **D-08:** UI shows merge suggestions with confirm/reject per group.
- **D-09:** Manual split: admin selects items from an order to ship separately.
- **D-10:** ExcelJS for formatted Excel output. Korean carrier templates (CJ대한통운, 한진, 롯데, 우체국, 로젠).
- **D-11:** Custom template builder: admin maps columns per carrier.
- **D-12:** Browser-based print using CSS @media print. Batch selection from order table.

### Claude's Discretion
- Specific carrier template column layouts
- Combined shipping detection algorithm optimization
- Excel parsing error handling UX
- Print layout design

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHIP-01 | 송장번호를 마켓플레이스 API로 자동 업로드 | Coupang/Naver invoice upload API patterns documented; BullMQ rate-limited worker pattern; per-marketplace rate limits (Coupang 10/s, Naver 2/s) |
| SHIP-02 | 엑셀 파일로 송장번호를 일괄 업로드 | ExcelJS read patterns; column mapping schema; Zod validation for parsed rows |
| SHIP-03 | 송장 출력(배송 라벨)을 일괄 인쇄 | CSS @media print pattern; batch print layout with page-break-after |
| SHIP-04 | 합포장으로 묶기 (출고편집코드 기반 자동분리 + 최대합포장수량 설정) | Combined shipping algorithm; shipment_group schema; fulfillment_code product attribute |
| SHIP-05 | 합포장 대상 자동 감지 및 제안 | Same-buyer+address+day detection query; group scoring and suggestion UI pattern |
| SHIP-06 | 주문 분할 배송 | Order splitting to multiple shipments; shipment_items join table |
| SHIP-07 | 택배사 양식 엑셀 내보내기 | ExcelJS write with styled headers; carrier template definitions |
| SHIP-08 | 엑셀 내보내기 양식 커스터마이징 | carrier_templates table schema; column mapping UI |
| DATA-01 | 주문 목록 커스터마이징 가능한 엑셀 내보내기 | ExcelJS workbook generation; configurable column selection |
</phase_requirements>

## Standard Stack

### Core (Phase 3 additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ExcelJS | ^4.4.0 | Excel read/write with Korean formatting | Locked decision. Supports styled headers, merged cells, data validations. 5.6M weekly downloads. |
| BullMQ | ^5.72 | Invoice upload job queue with rate limiting | Already installed. Per-queue rate limiting essential for Coupang 10/s and Naver 2/s limits. |
| Zod | ^4.3 | Validate Excel import data and API responses | Already installed. Runtime validation for parsed Excel rows before matching to orders. |

### Supporting (already installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ky | ^1.7 | HTTP client for marketplace API calls | Already used by Coupang/Naver clients for all API requests |
| p-limit | ^6.x | Concurrency control per marketplace | Rate limit enforcement inside BullMQ invoice upload workers |
| date-fns | ^4.x | Date formatting for carrier Excel templates | Format order dates in KST for export files |

### No New Dependencies Needed

This phase does not require any new npm packages. ExcelJS, BullMQ, Zod, ky, p-limit, and date-fns are all already in the project.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   ├── shipping/
│   │   ├── types.ts              # Shipment, ShipmentGroup, CarrierTemplate types
│   │   ├── actions.ts            # Server actions: uploadInvoice, mergeShipments, splitOrder
│   │   ├── queries.ts            # getShipmentsByOrder, getPendingUploads, getCombinedShippingGroups
│   │   ├── combined-shipping.ts  # Detection algorithm: findMergeCandidates()
│   │   ├── carrier-codes.ts      # Korean carrier code registry (CJGLS, HANJIN, etc.)
│   │   └── excel/
│   │       ├── import.ts         # Parse uploaded Excel -> matched invoice records
│   │       ├── export.ts         # Generate carrier-specific Excel files
│   │       ├── order-export.ts   # DATA-01: customizable order list export
│   │       └── templates.ts      # Default carrier template definitions
│   ├── jobs/
│   │   ├── queues.ts             # Add invoiceUploadQueue
│   │   └── workers/
│   │       └── invoice-uploader.ts  # BullMQ worker: per-order invoice upload with rate limiting
│   ├── marketplace/adapters/
│   │   ├── coupang/adapter.ts    # Implement uploadInvoice()
│   │   └── naver/adapter.ts      # Implement uploadInvoice()
│   └── db/
│       └── schema.ts             # Add shipments, shipment_groups, carrier_templates tables
├── app/(auth)/
│   ├── orders/
│   │   ├── page.tsx              # Add shipping action buttons to existing table
│   │   └── shipping-actions.tsx  # Bulk invoice upload, combined shipping, export buttons
│   └── shipping/
│       ├── combined/page.tsx     # Combined shipping review UI (SHIP-04/05)
│       ├── templates/page.tsx    # Carrier template management (SHIP-08)
│       └── print/page.tsx        # Batch label print page (SHIP-03)
```

### Pattern 1: Invoice Upload Pipeline

**What:** Orders flow through a pipeline: select orders -> assign tracking numbers -> queue for API upload -> track result per order.

**When to use:** SHIP-01, SHIP-02 -- any flow that ends with uploading invoice numbers to marketplaces.

```typescript
// Invoice upload status tracking per order
type InvoiceUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'confirmed'

// BullMQ job data for single invoice upload
interface InvoiceUploadJobData {
  orderId: string
  shipmentId: string
  marketplaceId: string
  marketplaceOrderId: string
  connectionId: string
  trackingNumber: string
  carrierId: string  // Coupang carrier code (CJGLS, HANJIN, etc.)
  attempt: number
}

// Worker processes one order at a time with per-marketplace rate limiting
// Use BullMQ's built-in rate limiter:
// new Worker('invoice-upload', processor, { limiter: { max: 2, duration: 1000 } })
// For per-marketplace differentiation, use separate queues or group IDs
```

### Pattern 2: Combined Shipping Detection

**What:** Query orders with same buyer + address + date, group them, exclude orders that need separate fulfillment codes, apply max-pack-quantity limits.

**When to use:** SHIP-04, SHIP-05.

```typescript
// Combined shipping detection algorithm
interface ShipmentGroup {
  groupKey: string  // hash of buyerName+address+date
  orders: Order[]
  fulfillmentCode: string  // e.g., 'normal', 'frozen', 'large'
  suggestedAction: 'merge' | 'split'
  reason?: string
}

// Step 1: Group by buyerName + shippingAddress + orderedAt (same day)
// Step 2: Within each group, sub-group by fulfillmentCode (출고편집코드)
// Step 3: Within each sub-group, split if count > maxPackQuantity
// Step 4: Present as suggestions with confirm/reject per group
```

### Pattern 3: ExcelJS Export with Carrier Templates

**What:** Generate formatted Excel files matching carrier-specific column layouts.

**When to use:** SHIP-07, SHIP-08, DATA-01.

```typescript
// Carrier template definition
interface CarrierTemplate {
  id: string
  carrierId: string  // 'CJGLS', 'HANJIN', etc.
  name: string       // 'CJ대한통운 기본양식'
  columns: Array<{
    header: string        // Korean column header
    field: string         // order field path (e.g., 'recipientName', 'shippingAddress.address1')
    width: number
    required: boolean
  }>
  isDefault: boolean
  userId: string
}

// ExcelJS export creates workbook with styled headers, auto-width columns
// Use ExcelJS streaming for large exports (500+ orders)
```

### Anti-Patterns to Avoid

- **Fire-and-forget invoice upload:** Never upload without tracking the result. Every upload must have a status record in the DB (pending/uploaded/failed/confirmed).
- **Global rate limiter for all marketplaces:** Coupang allows 10 req/sec, Naver allows 2 req/sec. Use per-marketplace rate limiters, not one shared limiter.
- **Client-side Excel parsing for large files:** Process Excel uploads server-side. Browser-based parsing will hang on 5000+ row files.
- **Single shipment per order assumption:** Orders can be split (SHIP-06) into multiple shipments. The data model must support one-to-many order-to-shipment relationships.

## Database Schema Extensions

### New Tables Required

```sql
-- Shipments: tracks each physical package
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  user_id UUID NOT NULL,
  tracking_number VARCHAR(100),
  carrier_id VARCHAR(50),         -- CJGLS, HANJIN, etc.
  carrier_name VARCHAR(100),      -- CJ대한통운, 한진택배, etc.
  upload_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | uploading | uploaded | failed | confirmed
  marketplace_upload_error TEXT,
  upload_attempts INTEGER DEFAULT 0,
  last_upload_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Shipment items: which order items go in which shipment (for split shipping)
CREATE TABLE shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id),
  quantity INTEGER NOT NULL DEFAULT 1
);

-- Shipment groups: combined shipping groups
CREATE TABLE shipment_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  group_key VARCHAR(500) NOT NULL,  -- hash of buyer+address+date
  status VARCHAR(20) NOT NULL DEFAULT 'suggested',
    -- suggested | confirmed | rejected | shipped
  fulfillment_code VARCHAR(50) DEFAULT 'normal',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Link orders to shipment groups
CREATE TABLE shipment_group_orders (
  shipment_group_id UUID NOT NULL REFERENCES shipment_groups(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id),
  PRIMARY KEY (shipment_group_id, order_id)
);

-- Carrier templates: customizable Excel export formats
CREATE TABLE carrier_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  carrier_id VARCHAR(50) NOT NULL,
  name VARCHAR(200) NOT NULL,
  columns JSONB NOT NULL,  -- Array<{ header, field, width, required }>
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

### Order Items Extension

The `order_items` table needs a `fulfillment_code` column for combined shipping logic:

```sql
ALTER TABLE order_items ADD COLUMN fulfillment_code VARCHAR(50) DEFAULT 'normal';
```

## Marketplace Invoice Upload APIs

### Coupang WING API -- Invoice Upload

**Confidence: MEDIUM** (Coupang docs returned 403; details reconstructed from search snippets and community code)

- **Endpoint:** `POST /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/orders/invoices`
- **Base URL:** `https://api-gateway.coupang.com`
- **Auth:** HMAC-SHA256 (same as existing order collection)
- **Rate limit:** 10 requests/second per vendor ID

**Request body:**
```json
{
  "vendorId": "A00012345",
  "orderSheetInvoiceApplyDtos": [
    {
      "shipmentBoxId": 12345678,
      "orderId": 87654321,
      "vendorItemId": 11111111,
      "deliveryCompanyCode": "CJGLS",
      "invoiceNumber": "20180731040123",
      "splitShipping": false,
      "preSplitShipped": false,
      "estimatedShippingDate": "2026-04-04"
    }
  ]
}
```

**Key constraints:**
- Upload only possible for orders in "상품준비중" (Product in Preparation) status
- Duplicate tracking numbers within 6 months cause duplication errors
- Same tracking number allowed for different orders with same recipient name + address (합포장)
- `shipmentBoxId` is required -- must be extracted from order data (stored in rawData)

**Missing from current types:** The `CoupangOrderSheet` type needs `shipmentBoxId` -- it IS already there in the type definition. The `orderId` and `vendorItemId` are also present.

### Naver Commerce API -- Dispatch Processing (발송처리)

**Confidence: MEDIUM** (Official docs behind auth wall; details from community implementations and GitHub discussions)

- **Endpoint:** `POST /v1/pay-order/seller/product-orders/dispatch` (발송처리)
- **Pre-requisite endpoint:** `POST /v1/pay-order/seller/product-orders/place-order` (발주확인 -- must be called first)
- **Base URL:** `https://api.commerce.naver.com`
- **Auth:** OAuth2 Bearer token (same as existing order collection)
- **Rate limit:** 2 requests/second

**Request body (dispatch):**
```json
{
  "dispatchProductOrders": [
    {
      "productOrderId": "2024010112345001",
      "deliveryMethod": "DELIVERY",
      "deliveryCompanyCode": "CJGLS",
      "trackingNumber": "640012345678",
      "dispatchDate": "2026-04-03T10:00:00+09:00"
    }
  ]
}
```

**Two-step process:**
1. **발주확인 (Place Order Confirmation):** Transition order from PAYED to DELIVERING status. Required before dispatch.
2. **발송처리 (Dispatch):** Upload tracking number + carrier. Only works for orders that have been confirmed.

**Key constraint:** If order is already confirmed (placeOrderStatus = OK), skip step 1 and go directly to dispatch.

### Korean Carrier Codes

**Confidence: HIGH** (Verified from iamport standard codes, widely used across Korean e-commerce platforms)

| Code | Korean Name | English Name | Notes |
|------|------------|--------------|-------|
| CJGLS | CJ대한통운 | CJ Logistics | Highest volume carrier |
| HANJIN | 한진택배 | Hanjin Express | Major carrier |
| HYUNDAI | 롯데택배 | Lotte Global Logistics | Code is HYUNDAI for legacy reasons |
| EPOST | 우체국택배 | Korea Post | Government carrier |
| KGB | 로젠택배 | Logen Logistics | Code is KGB for legacy reasons |
| KDEXP | 경동택배 | Kyungdong Express | Regional carrier |
| CHUNIL | 천일택배 | Chunil Express | |
| DAESIN | 대신택배 | Daesin Express | |
| ILYANG | 일양로지스 | Ilyang Logis | |
| CVSNET | 편의점택배 | Convenience Store Delivery | GS25/CU pickup |
| REGISTPOST | 우편등기 | Registered Mail | |
| HDEXP | 합동택배 | Hapdong Express | |
| HONAM | 우리택배 | Woori Express | formerly 호남택배 |
| ETC | 기타 | Other | Fallback code |

**Primary 5 carriers for templates (D-10):** CJGLS, HANJIN, HYUNDAI (롯데), EPOST, KGB (로젠)

**Naver carrier codes:** Naver uses the same code system but maps to their own `deliveryCompanyCode` values. Use CJGLS-style codes internally and map per marketplace in the adapter.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Excel read/write with formatting | Custom XLSX parser | ExcelJS ^4.4.0 | XLSX is complex (ZIP of XML). Korean formatting (merged cells, styled headers) requires library support |
| Rate limiting for API calls | Custom token bucket | BullMQ rate limiter + p-limit | BullMQ has built-in `limiter: { max, duration }` per worker. p-limit for within-job concurrency |
| Retry with exponential backoff | Custom retry loop | BullMQ job options `{ attempts, backoff: { type: 'exponential' } }` | BullMQ handles retry persistence, dead letter queues, backoff natively |
| PDF generation for labels | Custom PDF builder | CSS @media print (D-12 decision) | Browser print is simpler and more maintainable than server-side PDF generation |
| Excel encoding detection | Custom byte-checking | iconv-lite (already installed) | EUC-KR detection is a solved problem |

## Common Pitfalls

### Pitfall 1: Not Tracking Upload Status Per Order

**What goes wrong:** Invoice upload succeeds for 150 of 200 orders, but the system has no record of which 50 failed. Admin has no way to retry just the failures.

**Why it happens:** Treating bulk upload as an all-or-nothing operation instead of per-order tracking.

**How to avoid:** Each order gets a `shipments` record with `upload_status` tracking. The reconciliation view shows "shipped but not confirmed" orders. Failed uploads are individually retryable.

**Warning signs:** Admin manually checking each marketplace portal to verify uploads went through.

### Pitfall 2: Ignoring the Coupang Two-Status Requirement

**What goes wrong:** Trying to upload a tracking number to Coupang for an order that hasn't been moved to "상품준비중" first. The API rejects with a status error.

**Why it happens:** Assuming invoice upload works on any order regardless of current status.

**How to avoid:** Before uploading to Coupang, check order status. If still in "결제완료" (Payment Complete), first call the status change API to move to "상품준비중" (Product in Preparation), then upload the invoice.

**Warning signs:** Coupang uploads failing with "invalid status" errors for all newly collected orders.

### Pitfall 3: Ignoring the Naver Two-Step Process

**What goes wrong:** Trying to dispatch (발송처리) without first doing order confirmation (발주확인). Naver API rejects the dispatch call.

**Why it happens:** Assuming dispatch is a single API call like Coupang.

**How to avoid:** Check `placeOrderStatus` before dispatch. If not confirmed, call place-order confirmation API first, then dispatch. Handle the case where confirmation was already done via SmartStore Center.

**Warning signs:** Naver dispatch calls failing for "unconfirmed" orders.

### Pitfall 4: Combined Shipping Without Fulfillment Code Separation

**What goes wrong:** System merges frozen food with room-temperature products into one package because it only checks buyer name + address.

**Why it happens:** Not implementing 출고편집코드 (fulfillment edit code) as a separation criterion.

**How to avoid:** Every product/order_item has a `fulfillment_code`. Combined shipping groups are sub-grouped by fulfillment_code before merging. Different codes = different packages even for same buyer.

**Warning signs:** Customer complaints about food safety, product damage from incorrect packaging.

### Pitfall 5: Coupang Duplicate Tracking Number Error

**What goes wrong:** Retrying a failed upload sends the same tracking number again, but Coupang rejects it as a duplicate (within 6-month window).

**Why it happens:** Not checking whether the previous attempt actually succeeded before retrying.

**How to avoid:** Before retrying, query Coupang's order status to check if tracking was already accepted. Make upload idempotent: if tracking is already registered, mark as success. The exception: same tracking number IS allowed for same-recipient orders (합포장).

**Warning signs:** Retry queue growing with "duplicate tracking" errors that never clear.

### Pitfall 6: ExcelJS Streaming for Large Exports

**What goes wrong:** Generating a 2000-row Excel file in memory causes high memory usage and potential timeout.

**Why it happens:** Using `workbook.xlsx.writeBuffer()` for all sizes.

**How to avoid:** For exports under 500 rows, in-memory is fine. For larger exports, use ExcelJS streaming writer: `new ExcelJS.stream.xlsx.WorkbookWriter({ stream })`. Generate the file server-side and return as download.

**Warning signs:** API route timeouts on large order exports.

## Code Examples

### Coupang Invoice Upload (adapter implementation)

```typescript
// Source: Coupang WING API docs (reconstructed from search)
async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
  const path = `v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/orders/invoices`

  try {
    const response = await this.client.put(path, {
      json: {
        vendorId: this.vendorId,
        orderSheetInvoiceApplyDtos: [{
          shipmentBoxId: Number(invoice.shipmentBoxId),
          orderId: Number(orderId),
          vendorItemId: Number(invoice.vendorItemId),
          deliveryCompanyCode: invoice.carrierId,
          invoiceNumber: invoice.trackingNumber,
          splitShipping: invoice.splitShipping ?? false,
          preSplitShipped: false,
          estimatedShippingDate: invoice.estimatedShippingDate,
        }],
      },
    }).json<{ code: string; message: string }>()

    if (response.code !== '200' && response.code !== 'SUCCESS') {
      return { success: false, error: response.message }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
```

### Naver Dispatch (adapter implementation)

```typescript
// Source: Naver Commerce API community implementations
async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1: Place order confirmation (발주확인) if not already confirmed
    if (invoice.requiresConfirmation) {
      await this.naverClient.client.post('external/v1/pay-order/seller/product-orders/place-order', {
        json: { productOrderIds: [orderId] },
      }).json()
    }

    // Step 2: Dispatch with tracking info (발송처리)
    const response = await this.naverClient.client.post('external/v1/pay-order/seller/product-orders/dispatch', {
      json: {
        dispatchProductOrders: [{
          productOrderId: orderId,
          deliveryMethod: 'DELIVERY',
          deliveryCompanyCode: invoice.carrierId,
          trackingNumber: invoice.trackingNumber,
          dispatchDate: new Date().toISOString(),
        }],
      },
    }).json<{ data?: { successProductOrderIds?: string[]; failProductOrderIds?: string[] } }>()

    const failed = response.data?.failProductOrderIds ?? []
    if (failed.includes(orderId)) {
      return { success: false, error: 'Naver rejected dispatch for this order' }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
```

### BullMQ Invoice Upload Worker

```typescript
// Source: BullMQ docs pattern
import { Worker, Queue } from 'bullmq'
import { connection } from './connection'
import pLimit from 'p-limit'

const invoiceUploadQueue = new Queue<InvoiceUploadJobData>('invoice-upload', { connection })

// Per-marketplace rate limiters
const RATE_LIMITS: Record<string, { max: number; duration: number }> = {
  coupang: { max: 10, duration: 1000 },  // 10 req/sec
  naver: { max: 2, duration: 1000 },     // 2 req/sec
}

const worker = new Worker<InvoiceUploadJobData>(
  'invoice-upload',
  async (job) => {
    const { orderId, marketplaceId, trackingNumber, carrierId, connectionId } = job.data
    // 1. Get adapter from registry
    // 2. Call adapter.uploadInvoice()
    // 3. Update shipment.upload_status in DB
    // 4. If failed, throw to trigger retry
  },
  {
    connection,
    limiter: { max: 2, duration: 1000 }, // Conservative default
    concurrency: 1,
  }
)
```

### ExcelJS Carrier Export

```typescript
// Source: ExcelJS npm documentation
import ExcelJS from 'exceljs'

async function exportToCarrierExcel(
  orders: OrderWithShipment[],
  template: CarrierTemplate
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(template.name)

  // Set up columns from template
  sheet.columns = template.columns.map((col) => ({
    header: col.header,
    key: col.field,
    width: col.width,
  }))

  // Style header row
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  }

  // Add data rows
  for (const order of orders) {
    const row: Record<string, unknown> = {}
    for (const col of template.columns) {
      row[col.field] = getNestedValue(order, col.field)
    }
    sheet.addRow(row)
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
```

### Combined Shipping Detection

```typescript
// Algorithm for SHIP-04/05
function findMergeCandidates(orders: Order[]): ShipmentGroup[] {
  // Step 1: Group by buyerName + normalized address + order date
  const groups = new Map<string, Order[]>()
  for (const order of orders) {
    const dateKey = format(order.orderedAt, 'yyyy-MM-dd')
    const addrKey = normalizeAddress(order.shippingAddress)
    const key = `${order.buyerName}|${addrKey}|${dateKey}`
    const existing = groups.get(key) ?? []
    existing.push(order)
    groups.set(key, existing)
  }

  // Step 2: Sub-group by fulfillmentCode (출고편집코드)
  const result: ShipmentGroup[] = []
  for (const [groupKey, groupOrders] of groups) {
    if (groupOrders.length < 2) continue // Single orders don't need merging

    const byFulfillment = new Map<string, Order[]>()
    for (const order of groupOrders) {
      const code = getFulfillmentCode(order) // from order items
      const existing = byFulfillment.get(code) ?? []
      existing.push(order)
      byFulfillment.set(code, existing)
    }

    // Step 3: Apply maxPackQuantity limit
    for (const [code, subOrders] of byFulfillment) {
      const maxPack = getMaxPackQuantity() // from settings, default 10
      for (let i = 0; i < subOrders.length; i += maxPack) {
        const chunk = subOrders.slice(i, i + maxPack)
        if (chunk.length > 1) {
          result.push({
            groupKey: `${groupKey}|${code}|${i}`,
            orders: chunk,
            fulfillmentCode: code,
            suggestedAction: 'merge',
          })
        }
      }
    }
  }

  return result
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PDF server-side generation for labels | CSS @media print | Standard practice | Simpler, no PDF library dependency, browser-native |
| SheetJS Community for Excel | ExcelJS for formatted output | Ongoing | SheetJS CE drops styling; ExcelJS retains Korean formatting |
| Sequential API uploads | BullMQ with per-marketplace rate limiting | BullMQ v5+ | Reliable retry, persistence, rate control |
| Global carrier code list | Per-marketplace carrier code mapping | Current | Coupang, Naver, 11st may use different codes for same carrier |

## Open Questions

1. **Coupang invoice upload HTTP method**
   - What we know: Search results show both POST and PUT. The endpoint path is confirmed.
   - What's unclear: Whether it's POST or PUT (most likely PUT based on Coupang patterns for updates).
   - Recommendation: Try PUT first (Coupang typically uses PUT for status updates). If 405, fall back to POST.

2. **Naver dispatch endpoint exact path**
   - What we know: Pattern is `POST /external/v1/pay-order/seller/product-orders/dispatch`
   - What's unclear: Exact field names and response structure (official docs behind auth wall)
   - Recommendation: Reference official Naver Commerce API docs at `apicenter.commerce.naver.com`. The community pattern above is high-confidence.

3. **Naver carrier codes vs Coupang carrier codes**
   - What we know: Both use similar codes (CJGLS, HANJIN)
   - What's unclear: Whether codes are identical across marketplaces
   - Recommendation: Use a `carrierCodeMap` per marketplace adapter that maps internal carrier IDs to marketplace-specific codes. Start with identical codes, add overrides if needed.

4. **CJ대한통운 Excel template exact columns**
   - What we know: Standard columns include recipient name, phone, address, product name, quantity, tracking number
   - What's unclear: Exact column order and headers for each carrier
   - Recommendation: Claude's discretion area. Build with sensible defaults and allow customization (SHIP-08).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHIP-01 | Invoice upload via marketplace API | unit + integration | `npx vitest run src/__tests__/shipping/invoice-upload.test.ts -x` | Wave 0 |
| SHIP-02 | Excel file invoice import | unit | `npx vitest run src/__tests__/shipping/excel-import.test.ts -x` | Wave 0 |
| SHIP-03 | Shipping label batch print | manual-only | Manual: verify CSS print layout | N/A |
| SHIP-04 | Combined shipping merge/split | unit | `npx vitest run src/__tests__/shipping/combined-shipping.test.ts -x` | Wave 0 |
| SHIP-05 | Auto-detect combined shipping candidates | unit | `npx vitest run src/__tests__/shipping/combined-shipping.test.ts -x` | Wave 0 |
| SHIP-06 | Order split into multiple shipments | unit | `npx vitest run src/__tests__/shipping/order-split.test.ts -x` | Wave 0 |
| SHIP-07 | Carrier Excel export | unit | `npx vitest run src/__tests__/shipping/excel-export.test.ts -x` | Wave 0 |
| SHIP-08 | Custom template management | unit | `npx vitest run src/__tests__/shipping/carrier-templates.test.ts -x` | Wave 0 |
| DATA-01 | Order list Excel export | unit | `npx vitest run src/__tests__/shipping/order-export.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/shipping/invoice-upload.test.ts` -- covers SHIP-01 (mock marketplace adapter, verify upload flow)
- [ ] `src/__tests__/shipping/excel-import.test.ts` -- covers SHIP-02 (ExcelJS parse + order matching)
- [ ] `src/__tests__/shipping/combined-shipping.test.ts` -- covers SHIP-04, SHIP-05 (detection algorithm)
- [ ] `src/__tests__/shipping/order-split.test.ts` -- covers SHIP-06
- [ ] `src/__tests__/shipping/excel-export.test.ts` -- covers SHIP-07 (carrier template export)
- [ ] `src/__tests__/shipping/carrier-templates.test.ts` -- covers SHIP-08
- [ ] `src/__tests__/shipping/order-export.test.ts` -- covers DATA-01
- [ ] MSW handlers for Coupang/Naver invoice upload endpoints

## Sources

### Primary (HIGH confidence)
- ExcelJS npm docs (https://www.npmjs.com/package/exceljs) -- Excel read/write API patterns
- BullMQ docs (https://docs.bullmq.io/) -- Rate limiter, job retry, worker patterns
- iamport logistics codes (https://github.com/iamport/iamport-manual/blob/master/RESTAPI/logis.md) -- Korean carrier code registry
- Existing codebase: `src/lib/marketplace/adapters/coupang/adapter.ts`, `src/lib/marketplace/adapters/naver/adapter.ts` -- adapter pattern, client infrastructure

### Secondary (MEDIUM confidence)
- Coupang WING API invoice upload (https://developers.coupangcorp.com/hc/ko/articles/360033793014) -- Endpoint path and request structure from search snippets (docs 403'd)
- Naver Commerce API dispatch (https://github.com/commerce-api-naver/commerce-api/discussions) -- Dispatch endpoint pattern from community discussions
- Naver order implementation guide (https://www.jaenung.net/tree/1427) -- Shipment API example showing deliveryCompany/trackingNumber structure
- Coupang rate limits (https://developers.coupangcorp.com/hc/en-us/articles/20414599556889) -- 10 req/sec per vendor
- Naver rate limits (https://github.com/commerce-api-naver/commerce-api/discussions/6) -- 2 req/sec baseline

### Tertiary (LOW confidence)
- Coupang invoice upload HTTP method (PUT vs POST) -- conflicting search results, needs runtime verification
- Naver dispatch exact response schema -- behind auth wall, community pattern used

## Project Constraints (from CLAUDE.md)

- **Tech stack:** Next.js 16 + Supabase + TypeScript + Tailwind CSS v4
- **ExcelJS required:** Use ExcelJS, not SheetJS (CLAUDE.md explicit)
- **BullMQ required:** Use BullMQ for job queues, not node-cron or pgmq
- **ky required:** Use ky HTTP client, not axios
- **TanStack Table v8:** Do NOT use v9 alpha
- **Drizzle ORM:** Use for complex queries
- **Zod:** Use for runtime validation (import from `zod/v4` or install `zod@^4.3` directly)
- **Rate limits:** Coupang 10 req/sec, Naver 2 req/sec -- enforce per-marketplace
- **Next.js 16 docs:** Check `node_modules/next/dist/docs/` before writing code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already decided and installed
- Architecture: HIGH -- builds directly on Phase 1/2 patterns (adapters, BullMQ, Drizzle)
- Invoice upload APIs: MEDIUM -- Coupang/Naver docs partially behind auth walls, but patterns are well-established from community
- Combined shipping algorithm: HIGH -- pure business logic, no external dependency
- Pitfalls: HIGH -- directly sourced from PITFALLS.md research

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable -- marketplace APIs change infrequently)
