import ExcelJS from 'exceljs'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { purchaseRequestItems } from '@/lib/db/schema'
import { PURCHASE_DELAY_TRACKING_START_DATE } from './purchase-delay'
import {
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_REQUEST_STATUSES,
  type PurchaseRequestStatus,
} from './purchase-request-status'

const PURCHASE_BUYERS: Record<string, string> = {
  '1': '한상철',
  '2': '김기환',
  '3': '최종석',
  '4': '오지은',
  '5': '김소희',
}

export const PURCHASE_REQUEST_EXCEL_HEADERS = [
  'ID',
  '상태',
  '품목코드',
  '상품명',
  '옵션명',
  '요청수량',
  '실제구매수량',
  '중국입고수량',
  '중국출고요청수량',
  '구입관리코드',
  '주문서번호',
  '발주요청 날짜',
  '구매날짜',
  '구매방법',
  '담당자코드',
  '담당자',
  '메모',
] as const

type PurchaseRequestExcelHeader = (typeof PURCHASE_REQUEST_EXCEL_HEADERS)[number]
type PurchaseRequestExcelRow = Record<PurchaseRequestExcelHeader, string>

export async function exportPurchaseRequestsExcel(input: {
  userId: string
  status?: PurchaseRequestStatus
  overdueOnly?: boolean
  search?: string
}) {
  const rows = await getPurchaseRequestRowsForExcel(input)
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('발주')

  sheet.columns = PURCHASE_REQUEST_EXCEL_HEADERS.map((header) => ({
    header,
    key: header,
    width: header === 'ID' ? 38 : Math.max(14, Math.min(28, header.length + 8)),
  }))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: PURCHASE_REQUEST_EXCEL_HEADERS.length } }

  const headerRow = sheet.getRow(1)
  headerRow.height = 24
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  for (const row of rows) {
    sheet.addRow({
      ID: row.id,
      상태: PURCHASE_REQUEST_STATUS_LABELS[row.status],
      품목코드: row.sku,
      상품명: row.productName,
      옵션명: row.optionName ?? '',
      요청수량: row.requestedQuantity,
      실제구매수량: row.actualPurchaseQuantity ?? '',
      중국입고수량: row.chinaReceivedQuantity ?? '',
      중국출고요청수량: outboundRequestedQuantity(row.rawData),
      구입관리코드: row.purchaseManagementCode ?? '',
      주문서번호: row.supplierOrderNumber ?? '',
      '발주요청 날짜': dateText(row.requestDate),
      구매날짜: dateText(row.outboundExpectedDate),
      구매방법: row.purchaseMethod ?? '',
      담당자코드: row.buyerCode ?? '',
      담당자: row.buyerName ?? '',
      메모: row.memo ?? '',
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

export async function importPurchaseRequestsExcel(input: {
  userId: string
  fileBuffer: ArrayBuffer
  defaultStatus?: PurchaseRequestStatus
}) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(input.fileBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('엑셀 시트를 찾을 수 없습니다.')

  const headerRow = findHeaderRow(sheet)
  if (!headerRow) throw new Error('발주 엑셀 헤더를 찾을 수 없습니다.')
  const columnByHeader = new Map<string, number>()
  sheet.getRow(headerRow).eachCell((cell, column) => columnByHeader.set(cellText(cell.value), column))

  const missing = ['품목코드', '상품명', '요청수량'].filter((header) => !columnByHeader.has(header))
  if (missing.length > 0) throw new Error(`필수 열이 없습니다: ${missing.join(', ')}`)

  const [{ maxRowNumber }] = await db.select({
    maxRowNumber: sql<number>`COALESCE(MAX(${purchaseRequestItems.rowNumber}), 0)::int`,
  }).from(purchaseRequestItems).where(eq(purchaseRequestItems.userId, input.userId))

  let nextRowNumber = maxRowNumber
  let total = 0
  let created = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ row: number; message: string }> = []

  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const data = readExcelRow(row, columnByHeader)
    if (!Object.values(data).some(Boolean)) continue
    total += 1

    const id = data.ID.trim()
    const sku = data.품목코드.trim()
    const productName = data.상품명.trim()
    const requestedQuantity = optionalInteger(data.요청수량)
    if (!sku || !productName || requestedQuantity == null || requestedQuantity < 1) {
      skipped += 1
      errors.push({ row: rowNumber, message: '품목코드, 상품명, 요청수량을 확인해주세요.' })
      continue
    }

    const status = parsePurchaseStatus(data.상태) ?? input.defaultStatus ?? 'requested'
    const outboundQuantity = optionalInteger(data.중국출고요청수량)
    const buyerCode = normalizeBuyerCode(data.담당자코드)
    const values: Partial<typeof purchaseRequestItems.$inferInsert> = {
      status,
      sku,
      productName,
      optionName: emptyToNull(data.옵션명),
      requestedQuantity,
      actualPurchaseQuantity: optionalInteger(data.실제구매수량),
      chinaReceivedQuantity: optionalInteger(data.중국입고수량),
      purchaseManagementCode: emptyToNull(data.구입관리코드),
      supplierOrderNumber: emptyToNull(data.주문서번호),
      requestDate: optionalDate(data['발주요청 날짜']),
      outboundExpectedDate: optionalDate(data.구매날짜),
      purchaseMethod: emptyToNull(data.구매방법),
      buyerCode,
      buyerName: buyerCode ? PURCHASE_BUYERS[buyerCode] : emptyToNull(data.담당자),
      memo: emptyToNull(data.메모),
      updatedAt: new Date(),
    }

    if (id) {
      const [current] = await db.select({
        id: purchaseRequestItems.id,
        rawData: purchaseRequestItems.rawData,
      }).from(purchaseRequestItems).where(and(
        eq(purchaseRequestItems.userId, input.userId),
        eq(purchaseRequestItems.id, id),
      )).limit(1)

      if (!current) {
        skipped += 1
        errors.push({ row: rowNumber, message: 'ID에 해당하는 발주 항목을 찾을 수 없습니다.' })
        continue
      }

      values.rawData = mergeOutboundQuantity(current.rawData, outboundQuantity)
      await db.update(purchaseRequestItems)
        .set(values)
        .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, id)))
      updated += 1
      continue
    }

    nextRowNumber += 1
    await db.insert(purchaseRequestItems).values({
      ...values,
      userId: input.userId,
      rowNumber: nextRowNumber,
      rawData: mergeOutboundQuantity({}, outboundQuantity),
    } as typeof purchaseRequestItems.$inferInsert)
    created += 1
  }

  return { total, created, updated, skipped, errors }
}

async function getPurchaseRequestRowsForExcel(input: {
  userId: string
  status?: PurchaseRequestStatus
  overdueOnly?: boolean
  search?: string
}) {
  const conditions: SQL[] = [eq(purchaseRequestItems.userId, input.userId)]
  if (input.overdueOnly) {
    conditions.push(or(
      and(
        eq(purchaseRequestItems.status, 'purchased'),
        sql`${purchaseRequestItems.requestDate} IS NOT NULL`,
        sql`${purchaseRequestItems.requestDate} >= ${PURCHASE_DELAY_TRACKING_START_DATE}::date`,
        sql`${purchaseRequestItems.requestDate} <= CURRENT_DATE - INTERVAL '7 days'`,
      ),
      and(
        eq(purchaseRequestItems.status, 'purchase_completed'),
        sql`${purchaseRequestItems.outboundExpectedDate} IS NOT NULL`,
        sql`${purchaseRequestItems.outboundExpectedDate} <= CURRENT_DATE - INTERVAL '7 days'`,
      ),
    )!)
  } else if (input.status) {
    conditions.push(eq(purchaseRequestItems.status, input.status))
  }
  if (input.search) {
    const pattern = `%${input.search}%`
    conditions.push(or(
      ilike(purchaseRequestItems.sku, pattern),
      ilike(purchaseRequestItems.productName, pattern),
      ilike(purchaseRequestItems.optionName, pattern),
      ilike(purchaseRequestItems.purchaseManagementCode, pattern),
      ilike(purchaseRequestItems.supplierOrderNumber, pattern),
    )!)
  }

  return db.select().from(purchaseRequestItems)
    .where(and(...conditions))
    .orderBy(desc(purchaseRequestItems.requestDate), asc(purchaseRequestItems.productName), asc(purchaseRequestItems.sku))
}

function findHeaderRow(sheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const values = new Set<string>()
    sheet.getRow(rowNumber).eachCell((cell) => values.add(cellText(cell.value)))
    if (values.has('품목코드') && values.has('상품명') && values.has('요청수량')) return rowNumber
  }
  return null
}

function readExcelRow(row: ExcelJS.Row, columnByHeader: Map<string, number>) {
  return Object.fromEntries(PURCHASE_REQUEST_EXCEL_HEADERS.map((header) => {
    const column = columnByHeader.get(header)
    return [header, column ? cellText(row.getCell(column).value) : '']
  })) as PurchaseRequestExcelRow
}

function cellText(value: ExcelJS.CellValue) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim()
  }
  return String(value).trim()
}

function parsePurchaseStatus(value: string): PurchaseRequestStatus | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if ((PURCHASE_REQUEST_STATUSES as readonly string[]).includes(trimmed)) return trimmed as PurchaseRequestStatus
  const found = PURCHASE_REQUEST_STATUSES.find((status) => PURCHASE_REQUEST_STATUS_LABELS[status] === trimmed)
  return found ?? null
}

function optionalInteger(value: string) {
  if (!value.trim()) return undefined
  const number = Number(value.replace(/,/g, ''))
  return Number.isInteger(number) && number >= 0 ? number : null
}

function optionalDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (!match) return null
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function emptyToNull(value: string) {
  return value.trim() || null
}

function normalizeBuyerCode(value: string) {
  const trimmed = value.trim()
  return trimmed && PURCHASE_BUYERS[trimmed] ? trimmed : null
}

function outboundRequestedQuantity(rawData: Record<string, unknown>) {
  const value = rawData.outboundRequestedQuantity
  return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
}

function mergeOutboundQuantity(rawData: Record<string, unknown>, quantity: number | null | undefined) {
  if (quantity === undefined) return rawData
  return { ...rawData, outboundRequestedQuantity: quantity }
}

function dateText(value: string | Date | null) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}
