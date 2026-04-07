/**
 * Excel bulk import for orders.
 *
 * Parses uploaded Excel files into order data, validates rows,
 * and inserts/updates orders via UPSERT on (marketplaceId, marketplaceOrderId).
 *
 * Server-side only. Uses ExcelJS for parsing and Zod for validation.
 */

import ExcelJS from 'exceljs'
import { z } from 'zod'
import { db } from '@/lib/db'
import { orders, orderItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

/** Column headers expected in the import Excel file (Korean) */
const COLUMN_HEADERS = {
  orderNumber: '주문번호',
  buyerName: '주문자명',
  recipientName: '수령자명',
  recipientPhone: '수령자전화',
  zipCode: '우편번호',
  address1: '주소',
  address2: '상세주소',
  orderedAt: '주문일시',
  productName: '상품명',
  optionText: '옵션',
  quantity: '수량',
  unitPrice: '단가',
  totalAmount: '총금액',
  sku: 'SKU',
} as const

/** Zod schema for a single row */
const rowSchema = z.object({
  orderNumber: z.string().min(1, '주문번호 필수'),
  buyerName: z.string().min(1, '주문자명 필수'),
  recipientName: z.string().min(1, '수령자명 필수'),
  recipientPhone: z.string().optional(),
  zipCode: z.string().optional(),
  address1: z.string().optional(),
  address2: z.string().optional(),
  orderedAt: z.string().min(1, '주문일시 필수'),
  productName: z.string().min(1, '상품명 필수'),
  optionText: z.string().optional(),
  quantity: z.number().min(1, '수량은 1 이상'),
  unitPrice: z.number().min(0, '단가는 0 이상'),
  totalAmount: z.number().optional(),
  sku: z.string().optional(),
})

export interface ParsedOrderRow {
  row: number
  orderNumber: string
  buyerName: string
  recipientName: string
  recipientPhone?: string
  zipCode?: string
  address1?: string
  address2?: string
  orderedAt: string
  productName: string
  optionText?: string
  quantity: number
  unitPrice: number
  totalAmount?: number
  sku?: string
}

export interface ValidationError {
  row: number
  errors: string[]
}

export interface ParseResult {
  rows: ParsedOrderRow[]
  errors: ValidationError[]
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: ValidationError[]
}

/**
 * Parse an Excel buffer into order rows.
 * Detects columns by header name (1st row).
 */
export async function parseOrderExcel(buffer: Buffer | ArrayBuffer | Uint8Array): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as ExcelJS.Buffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    return { rows: [], errors: [{ row: 0, errors: ['시트를 찾을 수 없습니다'] }] }
  }

  // Detect column indices from header row
  const headerRow = worksheet.getRow(1)
  const colMap: Record<string, number> = {}

  headerRow.eachCell((cell, colNumber) => {
    const value = String(cell.value ?? '').trim()
    for (const [key, header] of Object.entries(COLUMN_HEADERS)) {
      if (value === header || value.includes(header)) {
        colMap[key] = colNumber
      }
    }
  })

  // Check required columns
  const required = ['orderNumber', 'buyerName', 'recipientName', 'orderedAt', 'productName', 'quantity', 'unitPrice']
  const missing = required.filter((k) => !colMap[k])
  if (missing.length > 0) {
    const missingHeaders = missing.map((k) => COLUMN_HEADERS[k as keyof typeof COLUMN_HEADERS])
    return {
      rows: [],
      errors: [{ row: 1, errors: [`필수 컬럼 누락: ${missingHeaders.join(', ')}`] }],
    }
  }

  const rows: ParsedOrderRow[] = []
  const errors: ValidationError[] = []

  const getCellString = (row: ExcelJS.Row, key: string): string => {
    if (!colMap[key]) return ''
    const val = row.getCell(colMap[key]).value
    if (val === null || val === undefined) return ''
    if (val instanceof Date) return val.toISOString()
    return String(val).trim()
  }

  const getCellNumber = (row: ExcelJS.Row, key: string): number => {
    if (!colMap[key]) return 0
    const val = row.getCell(colMap[key]).value
    if (val === null || val === undefined) return 0
    const num = Number(val)
    return isNaN(num) ? 0 : num
  }

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // skip header

    const raw = {
      orderNumber: getCellString(row, 'orderNumber'),
      buyerName: getCellString(row, 'buyerName'),
      recipientName: getCellString(row, 'recipientName'),
      recipientPhone: getCellString(row, 'recipientPhone') || undefined,
      zipCode: getCellString(row, 'zipCode') || undefined,
      address1: getCellString(row, 'address1') || undefined,
      address2: getCellString(row, 'address2') || undefined,
      orderedAt: getCellString(row, 'orderedAt'),
      productName: getCellString(row, 'productName'),
      optionText: getCellString(row, 'optionText') || undefined,
      quantity: getCellNumber(row, 'quantity') || 1,
      unitPrice: getCellNumber(row, 'unitPrice'),
      totalAmount: getCellNumber(row, 'totalAmount') || undefined,
      sku: getCellString(row, 'sku') || undefined,
    }

    // Skip completely empty rows
    if (!raw.orderNumber && !raw.buyerName && !raw.productName) return

    const result = rowSchema.safeParse(raw)
    if (!result.success) {
      errors.push({
        row: rowNumber,
        errors: result.error.issues.map((i) => i.message),
      })
    } else {
      rows.push({ row: rowNumber, ...result.data })
    }
  })

  return { rows, errors }
}

/**
 * Import parsed order rows into the database.
 * Groups rows by orderNumber (multiple items per order).
 * UPSERT on (marketplaceId, marketplaceOrderId).
 */
export async function importOrders(
  parsedRows: ParsedOrderRow[],
  marketplaceId: string,
  userId: string,
  connectionId?: string,
): Promise<ImportResult> {
  // Group rows by orderNumber (same order may have multiple items)
  const orderMap = new Map<string, ParsedOrderRow[]>()
  for (const row of parsedRows) {
    const existing = orderMap.get(row.orderNumber) || []
    existing.push(row)
    orderMap.set(row.orderNumber, existing)
  }

  let imported = 0
  let skipped = 0
  const errors: ValidationError[] = []

  for (const [orderNumber, items] of orderMap) {
    const first = items[0]
    const totalAmount = first.totalAmount ??
      items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)

    try {
      // Parse ordered date
      let orderedAt: Date
      try {
        orderedAt = new Date(first.orderedAt)
        if (isNaN(orderedAt.getTime())) throw new Error('Invalid date')
      } catch {
        orderedAt = new Date()
      }

      // UPSERT order
      const [upsertedOrder] = await db
        .insert(orders)
        .values({
          userId,
          connectionId: connectionId ?? null,
          marketplaceId,
          marketplaceOrderId: orderNumber,
          status: 'new',
          buyerName: first.buyerName,
          recipientName: first.recipientName,
          recipientPhone: first.recipientPhone,
          shippingAddress: first.address1
            ? { zipCode: first.zipCode, address1: first.address1, address2: first.address2 }
            : undefined,
          orderedAt,
          totalAmount: String(totalAmount),
          collectedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [orders.marketplaceId, orders.marketplaceOrderId],
          set: {
            buyerName: first.buyerName,
            recipientName: first.recipientName,
            recipientPhone: first.recipientPhone,
            shippingAddress: first.address1
              ? { zipCode: first.zipCode, address1: first.address1, address2: first.address2 }
              : undefined,
            totalAmount: String(totalAmount),
            updatedAt: new Date(),
          },
        })
        .returning({ id: orders.id })

      // Delete existing items and re-insert
      await db.delete(orderItems).where(eq(orderItems.orderId, upsertedOrder.id))
      if (items.length > 0) {
        await db.insert(orderItems).values(
          items.map((item) => ({
            orderId: upsertedOrder.id,
            marketplaceItemId: item.sku || `${orderNumber}-${item.productName}`,
            productName: item.productName,
            optionText: item.optionText,
            quantity: item.quantity,
            unitPrice: String(item.unitPrice),
            sku: item.sku,
          }))
        )
      }

      imported++
    } catch (error) {
      errors.push({
        row: first.row,
        errors: [error instanceof Error ? error.message : `주문 ${orderNumber} 저장 실패`],
      })
    }
  }

  return { imported, skipped, errors }
}
