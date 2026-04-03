/**
 * Excel invoice import: parse uploaded Excel files and match to orders.
 *
 * Server-side only. Uses ExcelJS for parsing and Zod for validation.
 * Supports configurable column mapping for different carrier formats.
 */

import ExcelJS from 'exceljs'
import { z } from 'zod'
import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

/** A parsed row from the invoice Excel file */
export interface ParsedInvoiceRow {
  orderIdentifier: string
  trackingNumber: string
  carrierId?: string
}

/** A row that failed validation */
export interface InvalidRow {
  row: number
  errors: string[]
}

/** Result of parsing an invoice Excel file */
export interface ParseResult {
  valid: ParsedInvoiceRow[]
  invalid: InvalidRow[]
}

/** A matched invoice ready for shipment creation */
export interface MatchedInvoice {
  orderId: string
  marketplaceOrderId: string
  trackingNumber: string
  carrierId?: string
}

/** Column mapping configuration */
export interface ColumnMapping {
  /** 1-based column index for order ID (default: 1) */
  orderIdCol: number
  /** 1-based column index for tracking number (default: 2) */
  trackingNumberCol: number
  /** 1-based column index for carrier code (default: 3) */
  carrierCol?: number
}

const DEFAULT_MAPPING: ColumnMapping = {
  orderIdCol: 1,
  trackingNumberCol: 2,
  carrierCol: 3,
}

/** Zod schema for validating parsed rows */
const invoiceRowSchema = z.object({
  orderIdentifier: z.string().min(1, '주문번호가 비어있습니다'),
  trackingNumber: z.string().min(1, '송장번호가 비어있습니다'),
  carrierId: z.string().optional(),
})

/**
 * Parse an uploaded Excel buffer for invoice data.
 *
 * Reads the first worksheet, skips header row (row 1),
 * extracts orderIdentifier, trackingNumber, and optional carrierId
 * based on configurable column mapping.
 */
export async function parseInvoiceExcel(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  columnMapping?: Partial<ColumnMapping>,
): Promise<ParseResult> {
  const mapping = { ...DEFAULT_MAPPING, ...columnMapping }

  const workbook = new ExcelJS.Workbook()
  // ExcelJS types don't account for Node.js 24+ Buffer changes
  await workbook.xlsx.load(buffer as ExcelJS.Buffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    return { valid: [], invalid: [] }
  }

  const valid: ParsedInvoiceRow[] = []
  const invalid: InvalidRow[] = []

  worksheet.eachRow((row, rowNumber) => {
    // Skip header row
    if (rowNumber === 1) return

    const rawOrderId = String(row.getCell(mapping.orderIdCol).value ?? '').trim()
    const rawTracking = String(row.getCell(mapping.trackingNumberCol).value ?? '').trim()
    const rawCarrier = mapping.carrierCol
      ? String(row.getCell(mapping.carrierCol).value ?? '').trim()
      : undefined

    const rawRow = {
      orderIdentifier: rawOrderId,
      trackingNumber: rawTracking,
      carrierId: rawCarrier || undefined,
    }

    const result = invoiceRowSchema.safeParse(rawRow)

    if (result.success) {
      valid.push(result.data)
    } else {
      invalid.push({
        row: rowNumber,
        errors: result.error.issues.map((issue) => issue.message),
      })
    }
  })

  return { valid, invalid }
}

/**
 * Match parsed invoice rows to existing orders by marketplaceOrderId.
 *
 * Returns matched rows (with internal orderId) and unmatched rows separately.
 */
export async function matchInvoicesToOrders(
  parsedRows: ParsedInvoiceRow[],
  userId: string,
): Promise<{ matched: MatchedInvoice[]; unmatched: ParsedInvoiceRow[] }> {
  if (parsedRows.length === 0) {
    return { matched: [], unmatched: [] }
  }

  const orderIdentifiers = parsedRows.map((r) => r.orderIdentifier)

  // Query orders matching the marketplace order IDs
  const matchingOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        inArray(orders.marketplaceOrderId, orderIdentifiers),
      ),
    )

  // Build lookup map
  const orderMap = new Map(
    matchingOrders.map((o) => [o.marketplaceOrderId, o]),
  )

  const matched: MatchedInvoice[] = []
  const unmatched: ParsedInvoiceRow[] = []

  for (const row of parsedRows) {
    const order = orderMap.get(row.orderIdentifier)
    if (order) {
      matched.push({
        orderId: order.id,
        marketplaceOrderId: order.marketplaceOrderId,
        trackingNumber: row.trackingNumber,
        carrierId: row.carrierId,
      })
    } else {
      unmatched.push(row)
    }
  }

  return { matched, unmatched }
}
