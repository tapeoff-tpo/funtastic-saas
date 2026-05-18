/**
 * Excel invoice import: parse uploaded Excel files and match to orders.
 *
 * Server-side only. Uses ExcelJS for parsing and Zod for validation.
 * Supports configurable column mapping for different carrier formats.
 */

import ExcelJS from 'exceljs'
import { spawnSync } from 'node:child_process'
import * as XLSX from 'xlsx'
import { z } from 'zod'
import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { eq, and, inArray, or } from 'drizzle-orm'

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
  orderIdentifier: string
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
  /** Password for encrypted legacy Excel files. */
  password?: string
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

function isZipXlsx(buffer: Buffer | ArrayBuffer | Uint8Array): boolean {
  const bytes = Buffer.from(buffer)
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function isCompoundExcel(buffer: Buffer | ArrayBuffer | Uint8Array): boolean {
  const bytes = Buffer.from(buffer)
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  )
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('text' in value && value.text != null) return String(value.text).trim()
    if ('result' in value && value.result != null) return cellToString(value.result as ExcelJS.CellValue)
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim()
    }
    if ('hyperlink' in value && 'text' in value && value.text != null) return String(value.text).trim()
  }
  return String(value).trim()
}

function scalarToString(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

function decryptOfficeFile(buffer: Buffer | ArrayBuffer | Uint8Array, password?: string): Buffer {
  const resolvedPassword = password?.trim() || '1'
  const script = [
    'import io, sys',
    'try:',
    '  import msoffcrypto',
    '  data = sys.stdin.buffer.read()',
    '  office = msoffcrypto.OfficeFile(io.BytesIO(data))',
    '  office.load_key(password=sys.argv[1])',
    '  out = io.BytesIO()',
    '  office.decrypt(out)',
    '  sys.stdout.buffer.write(out.getvalue())',
    'except Exception as e:',
    '  sys.stderr.write(str(e))',
    '  sys.exit(1)',
  ].join('\n')

  const result = spawnSync('python3', ['-c', script, resolvedPassword], {
    input: Buffer.from(buffer),
    maxBuffer: 100 * 1024 * 1024,
  })
  if (result.error) {
    throw new Error(`암호화된 엑셀 복호화 실행 실패: ${result.error.message}`)
  }
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
    const message = result.stderr?.toString().trim()
    throw new Error(
      message
        ? `암호화된 엑셀 파일을 열 수 없습니다: ${message}`
        : '암호화된 엑셀 파일을 열 수 없습니다. 비밀번호를 확인해주세요.',
    )
  }
  return result.stdout
}

function parseRowsFromArrays(rows: unknown[][], mapping: ColumnMapping): ParseResult {
  const valid: ParsedInvoiceRow[] = []
  const invalid: InvalidRow[] = []

  rows.forEach((row, index) => {
    const rowNumber = index + 1
    if (rowNumber === 1) return

    const rawOrderId = scalarToString(row[mapping.orderIdCol - 1])
    const rawTracking = scalarToString(row[mapping.trackingNumberCol - 1])
    const rawCarrier = mapping.carrierCol
      ? scalarToString(row[mapping.carrierCol - 1])
      : undefined

    if (!rawOrderId && !rawTracking && !rawCarrier) return

    const result = invoiceRowSchema.safeParse({
      orderIdentifier: rawOrderId,
      trackingNumber: rawTracking,
      carrierId: rawCarrier || undefined,
    })

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

function parseWorkbookWithSheetJs(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  mapping: ColumnMapping,
): ParseResult {
  const workbook = XLSX.read(Buffer.from(buffer), {
    type: 'buffer',
    cellDates: true,
    password: mapping.password?.trim() || '1',
  })
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) return { valid: [], invalid: [] }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  })
  return parseRowsFromArrays(rows, mapping)
}

async function parseLegacyExcel(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  mapping: ColumnMapping,
): Promise<ParseResult> {
  if (isCompoundExcel(buffer)) {
    try {
      const decrypted = decryptOfficeFile(buffer, mapping.password)
      return parseWorkbookWithSheetJs(decrypted, mapping)
    } catch (decryptError) {
      const message = decryptError instanceof Error ? decryptError.message : String(decryptError)
      if (!/not encrypted|unencrypted/i.test(message)) {
        throw decryptError
      }
    }
  }

  try {
    return parseWorkbookWithSheetJs(buffer, mapping)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/password-protected/i.test(message)) {
      const decrypted = decryptOfficeFile(buffer, mapping.password)
      return parseInvoiceExcel(decrypted, mapping)
    }
    throw error
  }
}

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

  if (isCompoundExcel(buffer)) {
    return parseLegacyExcel(buffer, mapping)
  }
  if (!isZipXlsx(buffer)) {
    throw new Error('지원하지 않는 엑셀 파일 형식입니다. .xlsx 파일로 다시 저장해서 업로드해주세요.')
  }

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

    const rawOrderId = cellToString(row.getCell(mapping.orderIdCol).value)
    const rawTracking = cellToString(row.getCell(mapping.trackingNumberCol).value)
    const rawCarrier = mapping.carrierCol
      ? cellToString(row.getCell(mapping.carrierCol).value)
      : undefined

    if (!rawOrderId && !rawTracking && !rawCarrier) return

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
 * Match parsed invoice rows to existing orders by marketplaceOrderId, internalNo, or DB id.
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
        or(
          inArray(orders.marketplaceOrderId, orderIdentifiers),
          inArray(orders.internalNo, orderIdentifiers),
          inArray(orders.id, orderIdentifiers),
        )!,
      ),
    )

  // Build lookup map
  const orderMap = new Map<string, typeof matchingOrders[number]>()
  for (const order of matchingOrders) {
    orderMap.set(order.marketplaceOrderId, order)
    orderMap.set(order.internalNo, order)
    orderMap.set(order.id, order)
  }

  const matched: MatchedInvoice[] = []
  const unmatched: ParsedInvoiceRow[] = []

  for (const row of parsedRows) {
    const order = orderMap.get(row.orderIdentifier)
    if (order) {
      matched.push({
        orderId: order.id,
        orderIdentifier: row.orderIdentifier,
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
