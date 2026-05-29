/**
 * Excel order import: parse uploaded Excel files into typed order rows.
 *
 * Server-side only. Uses ExcelJS for parsing and Zod for validation.
 * Header auto-detection maps Korean column names to field keys.
 */

import ExcelJS from 'exceljs'
import { z } from 'zod'
import {
  ORDER_IMPORT_FIELD_LABELS,
  REQUIRED_ORDER_IMPORT_FIELDS,
  type OrderImportMapping,
} from './excel-import-fields'
import { formatExcelDateCell } from './import-date'

/** Map of Korean header names to internal field keys */
const HEADER_MAP: Record<string, string> = {
  '주문번호': 'orderNumber',
  '주문자명': 'buyerName',
  '주문자전화': 'buyerPhone',
  '주문자휴대폰': 'buyerPhone',
  '수령자명': 'recipientName',
  '수령인': 'recipientName',
  '수령자주소': 'recipientAddress',
  '전체주소(도로명)': 'recipientAddress',
  '전체주소(지번)': 'recipientAddress',
  '수령자전화': 'recipientPhone',
  '수령인휴대폰': 'recipientPhone',
  '수령인연락처': 'recipientPhone',
  '우편번호': 'zipCode',
  '주문일시': 'orderedAt',
  '주문일': 'orderedAt',
  '상품명': 'productName',
  '옵션': 'optionText',
  '추가입력옵션': 'optionText',
  '수량': 'quantity',
  '주문수량': 'quantity',
  '금액(원)': 'totalAmount',
  '할인가x수량': 'totalAmount',
  'SKU': 'sku',
  '바코드': 'sku',
  '상품고유번호': 'sku',
  '마켓상품주문번호': 'marketplaceItemId',
  '주문번호+출고그룹': 'marketplaceItemId',
  '배송메시지': 'deliveryMessage',
  '사용자메모': 'deliveryMessage',
  '배송비': 'shippingFee',
}

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
  buyerPhone: z.string().optional(),
  recipientPhone: z.string().optional(),
  zipCode: z.string().optional(),
  optionText: z.string().optional(),
  sku: z.string().optional(),
  marketplaceItemId: z.string().optional(),
  deliveryMessage: z.string().optional(),
  shippingFee: z.number().nonnegative('배송비는 0 이상이어야 합니다').optional(),
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
  buyerPhone?: string
  recipientPhone?: string
  zipCode?: string
  optionText?: string
  sku?: string
  marketplaceItemId?: string
  deliveryMessage?: string
  shippingFee?: number
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
  mappings?: OrderImportMapping[],
): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook()
  // ExcelJS types don't account for Node.js 24+ Buffer changes
  await workbook.xlsx.load(buffer as ExcelJS.Buffer)

  if (workbook.worksheets.length === 0) {
    return { rows: [], errors: [{ row: 0, message: '시트를 찾을 수 없습니다' }] }
  }

  const colMap: Record<string, number> = {}

  const normalizedMappings = mappings
    ?.map((m) => ({
      field: m.field.trim(),
      excelColumn: m.excelColumn.trim(),
      fixedValue: m.fixedValue?.trim(),
      extraColumns: m.extraColumns?.map((col) => col.trim()).filter(Boolean),
      joinSeparator: m.joinSeparator ?? ' ',
    }))
    .filter((m) => m.field && (m.excelColumn || m.fixedValue))

  const readCellText = (value: ExcelJS.CellValue): string => {
    if (value === null || value === undefined) return ''
    if (value instanceof Date) return formatExcelDateCell(value)
    if (typeof value === 'object') {
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText.map((part) => part.text).join('').trim()
      }
      if ('text' in value && typeof value.text === 'string') return value.text.trim()
      if ('result' in value && value.result !== undefined) return String(value.result).trim()
    }
    return String(value).trim()
  }

  const mapColumnsFromRow = (row: ExcelJS.Row) => {
    const nextColMap: Record<string, number> = {}
    const nextMappedColumnNumbers = new Map<string, number[]>()

    row.eachCell((cell, colNumber) => {
      const value = readCellText(cell.value)
      if (!value) return

      if (normalizedMappings && normalizedMappings.length > 0) {
        for (const mapping of normalizedMappings) {
          if (value === mapping.excelColumn) {
            nextColMap[mapping.field] = colNumber
            const existing = nextMappedColumnNumbers.get(mapping.field) ?? []
            nextMappedColumnNumbers.set(mapping.field, [...existing, colNumber])
          }
          for (const extraColumn of mapping.extraColumns ?? []) {
            if (value === extraColumn) {
              const existing = nextMappedColumnNumbers.get(mapping.field) ?? []
              nextMappedColumnNumbers.set(mapping.field, [...existing, colNumber])
            }
          }
        }
      }

      for (const [headerLabel, fieldKey] of Object.entries(HEADER_MAP)) {
        if (
          !nextColMap[fieldKey]
          && !nextMappedColumnNumbers.has(fieldKey)
          && (value === headerLabel || value.includes(headerLabel))
        ) {
          nextColMap[fieldKey] = colNumber
        }
      }
    })

    return { colMap: nextColMap, mappedColumnNumbers: nextMappedColumnNumbers }
  }

  const scoreMappedRow = (candidate: ReturnType<typeof mapColumnsFromRow>): number => {
    const requiredScore = REQUIRED_ORDER_IMPORT_FIELDS.reduce((sum, field) => {
      const mapping = normalizedMappings?.find((m) => m.field === field)
      if (mapping?.fixedValue) return sum + 2
      const hasMapped = normalizedMappings && normalizedMappings.length > 0
        ? (candidate.mappedColumnNumbers.get(field)?.length ?? 0) > 0
        : !!candidate.colMap[field]
      return sum + (hasMapped ? 2 : 0)
    }, 0)

    return requiredScore + Object.keys(candidate.colMap).length + candidate.mappedColumnNumbers.size
  }

  let worksheet = workbook.worksheets[0]
  let headerRowNumber = 1
  let selectedColMap: Record<string, number> = {}
  let mappedColumnNumbers = new Map<string, number[]>()
  let bestScore = -1

  for (const candidateWorksheet of workbook.worksheets) {
    const maxHeaderScanRows = Math.min(20, candidateWorksheet.rowCount)
    for (let rowNumber = 1; rowNumber <= maxHeaderScanRows; rowNumber++) {
      const candidate = mapColumnsFromRow(candidateWorksheet.getRow(rowNumber))
      const score = scoreMappedRow(candidate)
      if (score > bestScore) {
        bestScore = score
        worksheet = candidateWorksheet
        headerRowNumber = rowNumber
        selectedColMap = candidate.colMap
        mappedColumnNumbers = candidate.mappedColumnNumbers
      }
    }
  }
  Object.assign(colMap, selectedColMap)

  // Verify required headers are present
  const missingHeaders = REQUIRED_ORDER_IMPORT_FIELDS
    .filter((field) => {
      const mapping = normalizedMappings?.find((m) => m.field === field)
      if (mapping?.fixedValue) return false
      if (normalizedMappings && normalizedMappings.length > 0) {
        return (mappedColumnNumbers.get(field)?.length ?? 0) === 0
      }
      return !colMap[field]
    })
    .map((field) => {
      const customLabel = normalizedMappings?.find((m) => m.field === field)?.excelColumn
      return customLabel ?? ORDER_IMPORT_FIELD_LABELS[field] ?? field
    })
  if (missingHeaders.length > 0) {
    return {
      rows: [],
      errors: [{ row: 1, message: `필수 컬럼 누락: ${missingHeaders.join(', ')}` }],
    }
  }

  const rows: ParsedOrderRow[] = []
  const errors: ParseError[] = []

  const getCellString = (row: ExcelJS.Row, key: string): string => {
    const mapping = normalizedMappings?.find((m) => m.field === key)
    if (mapping?.fixedValue) return mapping.fixedValue
    const mappedColumns = mappedColumnNumbers.get(key)
    if (mappedColumns && mappedColumns.length > 0) {
      return mappedColumns
        .map((colNumber) => {
          return readCellText(row.getCell(colNumber).value)
        })
        .filter(Boolean)
        .join(mapping?.joinSeparator ?? ' ')
    }
    if (!colMap[key]) return ''
    return readCellText(row.getCell(colMap[key]).value)
  }

  const getCellNumber = (row: ExcelJS.Row, key: string): number => {
    const value = getCellString(row, key)
    if (!value) return 0
    const num = Number(value.replaceAll(',', ''))
    return isNaN(num) ? 0 : num
  }

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return // skip guide/header rows

    const raw = {
      orderNumber: getCellString(row, 'orderNumber'),
      buyerName: getCellString(row, 'buyerName'),
      buyerPhone: getCellString(row, 'buyerPhone') || undefined,
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
      marketplaceItemId: getCellString(row, 'marketplaceItemId') || undefined,
      deliveryMessage: getCellString(row, 'deliveryMessage') || undefined,
      shippingFee: getCellString(row, 'shippingFee') ? getCellNumber(row, 'shippingFee') : undefined,
    }

    // Skip completely empty rows and platform guide rows.
    if (!raw.orderNumber && !raw.buyerName && !raw.productName) return
    if (
      raw.orderNumber.includes('수정 불가') ||
      raw.orderNumber.includes('수정 가능') ||
      raw.productName.includes('수정 불가') ||
      raw.productName.includes('수정 가능')
    ) {
      return
    }

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
