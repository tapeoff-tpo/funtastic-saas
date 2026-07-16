import ExcelJS from 'exceljs'
import { normalizeExcelWorkbookBuffer } from '@/lib/orders/excel-workbook-buffer'

export type CoupangRocketOutboundField = 'shipmentDate' | 'sourceOrderId' | 'sourceSku' | 'productName' | 'quantity'

export type ParsedCoupangRocketOutboundRow = {
  rowNumber: number
  shipmentDate: string | null
  sourceOrderId: string | null
  sourceSku: string | null
  productName: string | null
  quantity: number | null
  rawData: Record<string, string>
}

export type ParsedCoupangRocketOutboundWorkbook = {
  sheetName: string
  headerRow: number
  headers: Record<CoupangRocketOutboundField, string | null>
  totalRows: number
  validRows: ParsedCoupangRocketOutboundRow[]
  invalidRows: number
  warnings: string[]
}

const FIELD_ALIASES: Record<CoupangRocketOutboundField, readonly string[]> = {
  shipmentDate: [
    '출고완료일자',
    '출고완료일',
    '출고일자',
    '출고일',
    '배송완료일자',
    '배송완료일',
    '배송일자',
    '배송일',
  ],
  sourceOrderId: [
    '사방넷 주문번호',
    '주문번호(쇼핑몰)',
    '주문번호',
    '주문번호(판매자)',
    '판매자주문번호',
    '주문ID',
    '주문아이디',
    '배송번호',
    '출고번호',
  ],
  sourceSku: [
    '사방넷 상품코드',
    '판매자상품코드',
    '옵션판매자상품코드',
    '업체상품코드',
    '품목코드',
    '상품코드',
    'SKU',
  ],
  productName: [
    '사방넷 상품명',
    '상품명',
    '판매자상품명',
    '등록상품명',
    '노출상품명',
    '상품명(판매자)',
  ],
  quantity: [
    '실 출고수량',
    '출고수량',
    '배송수량',
    '주문수량',
    '구매수량',
    '수량',
  ],
}

type HeaderCandidate = {
  headerRow: number
  score: number
  columns: Array<{ column: number; label: string }>
  headers: Record<CoupangRocketOutboundField, string | null>
}

export async function parseCoupangRocketOutboundWorkbook(
  fileBuffer: ArrayBuffer,
): Promise<ParsedCoupangRocketOutboundWorkbook> {
  const workbook = new ExcelJS.Workbook()
  const buffer = normalizeExcelWorkbookBuffer(Buffer.from(fileBuffer))
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

  const candidates = workbook.worksheets
    .map((sheet) => ({ sheet, candidate: findHeaderCandidate(sheet) }))
    .filter((value): value is { sheet: ExcelJS.Worksheet; candidate: HeaderCandidate } => value.candidate !== null)
    .sort((left, right) => right.candidate.score - left.candidate.score)
  const selected = candidates[0]
  if (!selected) {
    throw new Error('출고일, 수량, 상품코드 또는 상품명이 포함된 헤더를 찾지 못했습니다.')
  }

  const rows: ParsedCoupangRocketOutboundRow[] = []
  let totalRows = 0
  let invalidRows = 0
  for (let rowNumber = selected.candidate.headerRow + 1; rowNumber <= selected.sheet.rowCount; rowNumber += 1) {
    const row = selected.sheet.getRow(rowNumber)
    const rawData = Object.fromEntries(selected.candidate.columns.map(({ column, label }) => [
      label,
      cellText(row.getCell(column).value),
    ]))
    if (!Object.values(rawData).some(Boolean)) continue

    totalRows += 1
    const shipmentDate = parseShipmentDate(readField(rawData, selected.candidate.headers.shipmentDate))
    const sourceOrderId = cleanText(readField(rawData, selected.candidate.headers.sourceOrderId))
    const sourceSku = cleanText(readField(rawData, selected.candidate.headers.sourceSku))
    const productName = cleanText(readField(rawData, selected.candidate.headers.productName))
    const quantity = parseQuantity(readField(rawData, selected.candidate.headers.quantity))

    if (!shipmentDate || !quantity || (!sourceSku && !productName)) {
      invalidRows += 1
      continue
    }

    rows.push({
      rowNumber,
      shipmentDate,
      sourceOrderId,
      sourceSku,
      productName,
      quantity,
      rawData,
    })
  }

  const warnings: string[] = []
  if (!selected.candidate.headers.sourceOrderId) {
    warnings.push('주문번호 열이 없어 이후 같은 파일을 다시 등록할 때 일부 중복을 자동 판별하지 못할 수 있습니다.')
  }
  if (!selected.candidate.headers.sourceSku) {
    warnings.push('상품코드 열이 없어 품목명으로만 매칭합니다. 미매칭 행은 발주 수량에 반영되지 않습니다.')
  }

  return {
    sheetName: selected.sheet.name,
    headerRow: selected.candidate.headerRow,
    headers: selected.candidate.headers,
    totalRows,
    validRows: rows,
    invalidRows,
    warnings,
  }
}

function findHeaderCandidate(sheet: ExcelJS.Worksheet): HeaderCandidate | null {
  let best: HeaderCandidate | null = null
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const columns: Array<{ column: number; label: string }> = []
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const label = cleanText(cellText(row.getCell(column).value))
      if (label) columns.push({ column, label })
    }
    if (columns.length === 0) continue

    const headers = Object.fromEntries((Object.keys(FIELD_ALIASES) as CoupangRocketOutboundField[]).map((field) => [
      field,
      findHeader(columns, FIELD_ALIASES[field]),
    ])) as Record<CoupangRocketOutboundField, string | null>
    const requiredCount = [headers.shipmentDate, headers.quantity].filter(Boolean).length
    const identityCount = [headers.sourceSku, headers.productName].filter(Boolean).length
    if (requiredCount < 2 || identityCount === 0) continue

    const score = requiredCount * 10 + identityCount * 5 + (headers.sourceOrderId ? 3 : 0)
    if (!best || score > best.score) {
      best = { headerRow: rowNumber, score, columns, headers }
    }
  }
  return best
}

function findHeader(columns: Array<{ column: number; label: string }>, aliases: readonly string[]) {
  const normalizedColumns = columns.map((column) => ({ ...column, normalized: normalizeHeader(column.label) }))
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias)
    const exact = normalizedColumns.find((column) => column.normalized === normalizedAlias)
    if (exact) return exact.label
  }
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias)
    const partial = normalizedColumns.find((column) => (
      normalizedAlias.length >= 3
      && (column.normalized.includes(normalizedAlias) || normalizedAlias.includes(column.normalized))
    ))
    if (partial) return partial.label
  }
  return null
}

function readField(rawData: Record<string, string>, header: string | null) {
  return header ? rawData[header] ?? '' : ''
}

function parseShipmentDate(value: string) {
  const text = cleanText(value)
  if (!text) return null

  const compact = text.replace(/[^0-9]/g, '')
  if (/^\d{8}$/.test(compact)) return toDateString(compact.slice(0, 4), compact.slice(4, 6), compact.slice(6, 8))

  const match = text.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/)
  if (match) return toDateString(match[1], match[2], match[3])
  return null
}

function toDateString(yearText: string, monthText: string, dayText: string) {
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseQuantity(value: string) {
  const normalized = value.replace(/,/g, '').trim()
  if (!normalized) return null
  const quantity = Number(normalized)
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  return Math.trunc(quantity)
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('result' in value && value.result != null) return cellText(value.result as ExcelJS.CellValue)
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
  }
  return String(value).trim()
}

function cleanText(value: string) {
  const text = value.trim()
  return text || null
}

function normalizeHeader(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/[\s_()[\]{}./\\-]/g, '')
}
