/**
 * Excel order import: parse uploaded Excel files into typed order rows.
 *
 * Server-side only. Uses ExcelJS for parsing and Zod for validation.
 * Header auto-detection maps Korean column names to field keys.
 */

import ExcelJS from 'exceljs'
import { z } from 'zod'

/** Map of Korean header names to internal field keys */
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

const REQUIRED_HEADERS = ['주문번호', '주문자명', '수령자명', '수령자주소', '주문일시', '상품명', '수량', '금액(원)']

/** Zod schema for each row */
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

export interface ParsedOrderRow {
  orderNumber: string
  buyerName: string
  recipientName: string
  recipientAddress: string
  orderedAt: string
  productName: string
  quantity: number
  totalAmount: number
  recipientPhone?: string
  zipCode?: string
  optionText?: string
  sku?: string
}

export interface ParseError {
  row: number
  message: string
}

export interface ParseResult {
  rows: ParsedOrderRow[]
  errors: ParseError[]
}

/**
 * Parse an uploaded Excel buffer for order data.
 *
 * Reads the first worksheet, detects column indices from header row (row 1),
 * then validates each data row using Zod.
 */
export async function parseOrderExcel(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook()
  // ExcelJS types don't account for Node.js 24+ Buffer changes
  await workbook.xlsx.load(buffer as ExcelJS.Buffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    return { rows: [], errors: [{ row: 0, message: '시트를 찾을 수 없습니다' }] }
  }

  // Build column index map from header row
  const headerRow = worksheet.getRow(1)
  const colMap: Record<string, number> = {}

  headerRow.eachCell((cell, colNumber) => {
    const value = String(cell.value ?? '').trim()
    for (const [korean, fieldKey] of Object.entries(HEADER_MAP)) {
      if (value === korean || value.includes(korean)) {
        colMap[fieldKey] = colNumber
      }
    }
  })

  // Verify required headers are present
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !colMap[HEADER_MAP[h]])
  if (missingHeaders.length > 0) {
    return {
      rows: [],
      errors: [{ row: 1, message: `필수 컬럼 누락: ${missingHeaders.join(', ')}` }],
    }
  }

  const rows: ParsedOrderRow[] = []
  const errors: ParseError[] = []

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
      recipientAddress: getCellString(row, 'recipientAddress'),
      recipientPhone: getCellString(row, 'recipientPhone') || undefined,
      zipCode: getCellString(row, 'zipCode') || undefined,
      orderedAt: getCellString(row, 'orderedAt'),
      productName: getCellString(row, 'productName'),
      optionText: getCellString(row, 'optionText') || undefined,
      quantity: getCellNumber(row, 'quantity') || 1,
      totalAmount: getCellNumber(row, 'totalAmount'),
      sku: getCellString(row, 'sku') || undefined,
    }

    // Skip completely empty rows
    if (!raw.orderNumber && !raw.buyerName && !raw.productName) return

    const result = orderRowSchema.safeParse(raw)
    if (!result.success) {
      errors.push({
        row: rowNumber,
        message: result.error.issues.map((i) => i.message).join(', '),
      })
    } else {
      rows.push(result.data)
    }
  })

  return { rows, errors }
}
