---
phase: quick
plan: 260407-ohi
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/db/schema.ts
  - src/lib/orders/excel-import.ts
  - src/lib/orders/excel-template.ts
  - src/app/api/orders/import/route.ts
  - src/app/api/orders/import/template/route.ts
  - src/app/(auth)/orders/import/page.tsx
  - src/app/(auth)/orders/page.tsx
autonomous: true
requirements: []
must_haves:
  truths:
    - "User can upload an .xlsx file with order data and see them inserted into the orders table"
    - "Duplicate orders (same marketplaceId + marketplaceOrderId) are skipped, not errored"
    - "User can download a blank Excel template with correct Korean headers"
    - "Upload results show inserted/skipped/error counts"
    - "Orders page has a link to the import page"
  artifacts:
    - path: "src/lib/orders/excel-import.ts"
      provides: "Excel parsing with Zod row validation"
    - path: "src/lib/orders/excel-template.ts"
      provides: "Blank template Excel generation"
    - path: "src/app/api/orders/import/route.ts"
      provides: "POST endpoint for file upload + DB insert"
    - path: "src/app/api/orders/import/template/route.ts"
      provides: "GET endpoint for template download"
    - path: "src/app/(auth)/orders/import/page.tsx"
      provides: "Upload UI with drag-and-drop and results display"
  key_links:
    - from: "src/app/(auth)/orders/import/page.tsx"
      to: "/api/orders/import"
      via: "fetch POST with FormData"
    - from: "src/app/api/orders/import/route.ts"
      to: "src/lib/orders/excel-import.ts"
      via: "parseOrderExcel function call"
    - from: "src/app/(auth)/orders/page.tsx"
      to: "/orders/import"
      via: "Link component"
---

<objective>
Add Excel order import: parse uploaded .xlsx files, insert orders into DB, provide a blank template download, and a simple upload page.

Purpose: Enable order ingestion from marketplaces without API integration (manual excel download from seller portals).
Output: 5 new files + 2 modifications (schema nullable connectionId, orders page link).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/lib/db/schema.ts
@src/lib/orders/types.ts
@src/lib/shipping/excel/import.ts
@src/app/(auth)/orders/page.tsx
@src/app/api/orders/collect/route.ts

<interfaces>
<!-- Key types and contracts the executor needs -->

From src/lib/db/schema.ts:
```typescript
// orders table - connectionId is currently .notNull() but MUST be changed to nullable
export const orders = pgTable('orders', {
  connectionId: uuid('connection_id').references(() => marketplaceConnections.id),
  // ... other fields
})

export const orderItems = pgTable('order_items', {
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productName: text('product_name').notNull(),
  optionText: text('option_text'),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  sku: varchar('sku', { length: 100 }),
})
```

From src/lib/orders/types.ts:
```typescript
export type OrderStatus = 'new' | 'confirmed' | 'preparing' | 'shipped' | ...
```

Auth pattern (from src/app/api/orders/collect/route.ts):
```typescript
const supabase = await createClient()
const { data: { user }, error: authError } = await supabase.auth.getUser()
if (authError || !user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

Excel pattern (from src/lib/shipping/excel/import.ts):
```typescript
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(buffer as ExcelJS.Buffer)  // ExcelJS.Buffer cast for Node.js 24
const worksheet = workbook.worksheets[0]
worksheet.eachRow((row, rowNumber) => { ... })
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Schema migration + Excel parser + template generator</name>
  <files>
    src/lib/db/schema.ts
    src/lib/orders/excel-import.ts
    src/lib/orders/excel-template.ts
  </files>
  <action>
**1. Make connectionId nullable in schema.ts (line 88-90):**

Change:
```typescript
connectionId: uuid('connection_id')
  .notNull()
  .references(() => marketplaceConnections.id),
```
To:
```typescript
connectionId: uuid('connection_id')
  .references(() => marketplaceConnections.id),
```

Remove `.notNull()` only. Keep the reference. Then run `npx drizzle-kit push` to apply.

**2. Create src/lib/orders/excel-import.ts:**

Follow the exact pattern from `src/lib/shipping/excel/import.ts` (ExcelJS + Zod).

Header auto-detection: Read row 1, build a map of Korean header name to column index. Use these header names:

```typescript
const HEADER_MAP: Record<string, string> = {
  '주문번호': 'orderNumber',
  '주문자명': 'buyerName',
  '수령자명': 'recipientName',
  '수령자주소': 'recipientAddress',
  '수령자전화': 'recipientPhone',
  '우편번호': 'zipCode',
  '주문일시': 'orderedAt',
  '상품명': 'productName',
  '옵션': 'optionText',
  '수량': 'quantity',
  '금액(원)': 'totalAmount',
  'SKU': 'sku',
}
```

Required headers: 주문번호, 주문자명, 수령자명, 수령자주소, 주문일시, 상품명, 수량, 금액(원).
Optional: 수령자전화, 우편번호, 옵션, SKU.

Zod schema for each row:
```typescript
const orderRowSchema = z.object({
  orderNumber: z.string().min(1, '주문번호가 비어있습니다'),
  buyerName: z.string().min(1, '주문자명이 비어있습니다'),
  recipientName: z.string().min(1, '수령자명이 비어있습니다'),
  recipientAddress: z.string().min(1, '수령자주소가 비어있습니다'),
  orderedAt: z.string().min(1, '주문일시가 비어있습니다'),
  productName: z.string().min(1, '상품명이 비어있습니다'),
  quantity: z.number().int().positive('수량은 1 이상이어야 합니다'),
  totalAmount: z.number().nonnegative('금액은 0 이상이어야 합니다'),
  recipientPhone: z.string().optional(),
  zipCode: z.string().optional(),
  optionText: z.string().optional(),
  sku: z.string().optional(),
})
```

Export interface and function:
```typescript
export interface ParsedOrderRow { /* all fields from schema */ }
export interface ParseError { row: number; message: string }
export interface ParseResult { rows: ParsedOrderRow[]; errors: ParseError[] }

export async function parseOrderExcel(buffer: Buffer | ArrayBuffer | Uint8Array): Promise<ParseResult>
```

Handle numeric cells for quantity/totalAmount: coerce to number. Handle date cells for orderedAt: convert Date objects to ISO string with `toISOString()`. Use `as ExcelJS.Buffer` cast per existing pattern.

**3. Create src/lib/orders/excel-template.ts:**

```typescript
export async function generateOrderTemplate(): Promise<Buffer>
```

Create a workbook with one worksheet named "주문". Row 1 headers in order:
주문번호, 주문자명, 수령자명, 수령자주소, 수령자전화, 우편번호, 주문일시, 상품명, 옵션, 수량, 금액(원), SKU

Row 2 example data:
ORD-001, 홍길동, 김철수, 서울시 강남구 테헤란로 123, 010-1234-5678, 06234, 2026-04-07 10:00, 테스트상품, 빨강/L, 1, 15000, SKU-001

Style header row: bold, light gray fill. Set column widths appropriately (wider for address).
Return `await workbook.xlsx.writeBuffer()` cast to Buffer.
  </action>
  <verify>
    <automated>cd /Users/ian/Desktop/funtastic-saas && npx tsx -e "
import { parseOrderExcel } from './src/lib/orders/excel-import';
import { generateOrderTemplate } from './src/lib/orders/excel-template';
const buf = await generateOrderTemplate();
console.log('Template size:', buf.length, 'bytes');
const result = await parseOrderExcel(buf);
console.log('Parsed rows:', result.rows.length, 'errors:', result.errors.length);
if (result.rows.length !== 1) throw new Error('Expected 1 example row');
console.log('OK');
"</automated>
  </verify>
  <done>
    - connectionId is nullable in schema
    - parseOrderExcel returns typed rows with Zod validation
    - generateOrderTemplate creates valid .xlsx with Korean headers + example row
    - Template round-trips through parser successfully
  </done>
</task>

<task type="auto">
  <name>Task 2: Upload API routes + import page + orders page link</name>
  <files>
    src/app/api/orders/import/route.ts
    src/app/api/orders/import/template/route.ts
    src/app/(auth)/orders/import/page.tsx
    src/app/(auth)/orders/page.tsx
  </files>
  <action>
**1. Create src/app/api/orders/import/route.ts — POST handler:**

Follow auth pattern from `src/app/api/orders/collect/route.ts`:
```typescript
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
```

Accept FormData with `file` (File) and `marketplaceId` (string).
- Validate: file must be present and .xlsx extension
- Call `parseOrderExcel(buffer)` from the lib module
- If parsing has errors, still proceed with valid rows (report errors in response)

DB insert logic: Group parsed rows by orderNumber (same order number = same order, multiple items).
For each unique orderNumber:
- Check if order exists: `SELECT id FROM orders WHERE marketplace_id = $marketplaceId AND marketplace_order_id = $orderNumber`
- If exists: skip (increment `skipped` counter)
- If new: INSERT into `orders` with:
  - `userId`: from auth
  - `connectionId`: null (no marketplace connection for manual imports)
  - `marketplaceId`: from form input
  - `marketplaceOrderId`: orderNumber
  - `status`: 'confirmed'
  - `buyerName`: from first row of this orderNumber
  - `recipientName`, `recipientPhone`: from first row
  - `shippingAddress`: `{ zipCode, address1: recipientAddress }` as jsonb
  - `orderedAt`: parse the date string (try `new Date(orderedAt)`, fallback to current time)
  - `totalAmount`: sum of all items' totalAmount for this order
  - `rawData`: null
- INSERT each row as an `order_item`:
  - `productName`, `optionText` (as optionText), `quantity`, `unitPrice` = totalAmount / quantity, `sku`

Use a transaction (`db.transaction()`) for the entire batch.

Response: `{ inserted: number, skipped: number, errors: Array<{ row: number, message: string }> }`

**2. Create src/app/api/orders/import/template/route.ts — GET handler:**

No auth required (template is just a blank form).
```typescript
import { generateOrderTemplate } from '@/lib/orders/excel-template'

export async function GET() {
  const buffer = await generateOrderTemplate()
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="order-import-template.xlsx"',
    },
  })
}
```

**3. Create src/app/(auth)/orders/import/page.tsx — Upload page:**

This is a client component (`'use client'`).

UI structure:
- Page title: "엑셀 주문 업로드"
- "양식 다운로드" link/button pointing to `/api/orders/import/template` (download attribute)
- Text input for marketplace name (label: "마켓플레이스", placeholder: "예: 자사몰, 오프라인, 도매꾹")
- File drop zone: A bordered dashed area that accepts .xlsx files. Use native HTML input[type=file] with accept=".xlsx" plus drag-and-drop via onDragOver/onDrop handlers. Show file name when selected.
- "업로드" button (disabled until file + marketplace are filled)
- Loading state during upload (button shows spinner text)
- Results section (shown after upload):
  - "N건 등록" in green
  - "N건 중복 스킵" in gray (if > 0)
  - Error list if any (red, show row number + message)
- Link back to /orders: "주문 목록으로"

Use fetch to POST to `/api/orders/import` with FormData. Use existing Tailwind utility classes matching the project style (see orders page: `text-2xl font-bold`, `text-sm text-muted-foreground`, etc.). Use shadcn Button component if available, otherwise native button with Tailwind.

**4. Modify src/app/(auth)/orders/page.tsx:**

Add a link to the import page in the header section. After the `<p>` tag showing total count (line ~81), add:
```tsx
<div className="flex items-center gap-4">
  <p className="mt-1 text-sm text-muted-foreground">
    전체 {total.toLocaleString('ko-KR')}건의 주문
  </p>
  <a
    href="/orders/import"
    className="text-sm text-blue-600 hover:underline"
  >
    엑셀 업로드
  </a>
</div>
```

Wrap the existing `<p>` and the new link in a flex container. Remove the standalone `<p>` tag.
  </action>
  <verify>
    <automated>cd /Users/ian/Desktop/funtastic-saas && npx next build 2>&1 | tail -20</automated>
  </verify>
  <done>
    - POST /api/orders/import accepts .xlsx and inserts orders with connectionId=null
    - GET /api/orders/import/template returns downloadable .xlsx
    - /orders/import page renders with file upload UI
    - /orders page has "엑셀 업로드" link
    - Build succeeds without errors
  </done>
</task>

</tasks>

<verification>
1. Template download: `curl -o /tmp/template.xlsx http://localhost:3000/api/orders/import/template` returns valid .xlsx
2. Upload flow: Upload template file (with example row) via the import page, verify 1 order inserted
3. Duplicate check: Upload same file again, verify 0 inserted / 1 skipped
4. Orders page: "엑셀 업로드" link visible and navigates to /orders/import
</verification>

<success_criteria>
- Excel file with Korean headers parses correctly with Zod validation
- Orders insert with connectionId=null and status='confirmed'
- Duplicate orders (same marketplaceId + orderNumber) are skipped
- Template download works as .xlsx attachment
- Upload page shows clear results (inserted/skipped/errors)
- Build passes
</success_criteria>

<output>
After completion, create `.planning/quick/260407-ohi-excel-order-import/260407-ohi-SUMMARY.md`
</output>
