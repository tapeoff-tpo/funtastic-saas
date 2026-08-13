import ExcelJS from 'exceljs'
import { normalizeExcelWorkbookBuffer } from '@/lib/orders/excel-workbook-buffer'

export type ChannelSalesField =
  | 'occurredOn'
  | 'sourceSku'
  | 'productName'
  | 'optionText'
  | 'quantity'
  | 'unitSalePrice'
  | 'salesAmount'
  | 'unitCost'
  | 'productCost'
  | 'marketplaceFee'
  | 'paidShippingFee'
  | 'actualShippingFee'
  | 'boxCost'
  | 'profitAmount'
  | 'counterparty'

export type ParsedChannelSalesRow = {
  rowNumber: number
  occurredOn: string | null
  sourceSku: string | null
  productName: string | null
  optionText: string | null
  quantity: number | null
  unitSalePrice: number | null
  salesAmount: number | null
  productCost: number | null
  marketplaceFee: number | null
  paidShippingFee: number | null
  actualShippingFee: number | null
  boxCost: number | null
  profitAmount: number | null
  counterparty: string | null
  rawData: Record<string, string>
}

export type ParsedChannelSalesWorkbook = {
  sheetName: string
  headerRow: number
  headers: Record<ChannelSalesField, string | null>
  totalRows: number
  validRows: ParsedChannelSalesRow[]
  invalidRows: number
  warnings: string[]
}

const FIELD_ALIASES: Record<ChannelSalesField, readonly string[]> = {
  occurredOn: ['업데이트날짜', '매출일', '판매일', '정산일', '거래일자', '출고완료일자', '출고일자', '출고일', '입고예정일', '입고일', '발주일'],
  sourceSku: ['상품코드', '품목코드', '사방넷 상품코드', '판매자상품코드', '판매자 상품코드', 'SKU ID', 'SKU'],
  productName: ['제품명', '상품명', '사방넷 상품명', '판매자상품명', '판매자 상품명', 'SKU 이름'],
  optionText: ['옵션', '옵션명', '규격정보', '사방넷 옵션'],
  quantity: ['입고수량', '확정수량', '수량', '출고수량', '실 출고수량', '주문수량', '판매수량'],
  unitSalePrice: ['개당 판매가', '판매단가', '판매가', '매입가', '단가'],
  salesAmount: ['총 판매금액', '매출금액', '판매금액', '입고금액', '결제금액', '최종결제금액', '총매출'],
  unitCost: ['원가', '개당 원가', '상품원가'],
  productCost: ['원가총액', '매입원가총액', '총 원가', '총원가'],
  marketplaceFee: ['수수료', '판매수수료', '플랫폼수수료', '결제수수료'],
  paidShippingFee: ['고객배송비', '결제배송비', '배송비'],
  actualShippingFee: ['실제배송비', '택배비', '배송원가'],
  boxCost: ['박스비', '포장비'],
  profitAmount: ['마진금액', '순이익', '순이익액', '이익금액'],
  counterparty: ['입금자', '거래처', '구매처', '고객명', '판매처'],
}

type HeaderCandidate = {
  headerRow: number
  score: number
  columns: Array<{ column: number; label: string }>
  headers: Record<ChannelSalesField, string | null>
}

export async function parseChannelSalesWorkbook(fileBuffer: ArrayBuffer): Promise<ParsedChannelSalesWorkbook> {
  const workbook = new ExcelJS.Workbook()
  const buffer = normalizeExcelWorkbookBuffer(Buffer.from(fileBuffer))
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

  const candidates = workbook.worksheets
    .map((sheet) => ({ sheet, candidate: findHeaderCandidate(sheet) }))
    .filter((value): value is { sheet: ExcelJS.Worksheet; candidate: HeaderCandidate } => value.candidate !== null)
    .sort((left, right) => right.candidate.score - left.candidate.score)
  const selected = candidates[0]
  if (!selected) {
    throw new Error('매출일, 수량, 상품코드 또는 상품명, 판매금액이 포함된 헤더를 찾지 못했습니다.')
  }

  const validRows: ParsedChannelSalesRow[] = []
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
    const parsed = parseChannelSalesRow({ rowNumber, rawData, headers: selected.candidate.headers })

    if (!isValidChannelSalesRow(parsed)) {
      invalidRows += 1
      continue
    }
    validRows.push(parsed)
  }

  return {
    sheetName: selected.sheet.name,
    headerRow: selected.candidate.headerRow,
    headers: selected.candidate.headers,
    totalRows,
    validRows,
    invalidRows,
    warnings: getWarnings(selected.candidate.headers),
  }
}

export async function parseChannelSalesFile(input: {
  fileName: string
  fileBuffer: ArrayBuffer
}): Promise<ParsedChannelSalesWorkbook> {
  if (input.fileName.toLocaleLowerCase('ko-KR').endsWith('.csv')) {
    return parseChannelSalesCsv(input.fileBuffer)
  }
  return parseChannelSalesWorkbook(input.fileBuffer)
}

function parseChannelSalesCsv(fileBuffer: ArrayBuffer): ParsedChannelSalesWorkbook {
  const text = Buffer.from(fileBuffer).toString('utf8').replace(/^\uFEFF/, '')
  const rows = parseCsvRows(text)
  const header = rows[0]?.map((value) => cleanText(value) ?? '') ?? []
  if (header.length === 0) {
    throw new Error('CSV 파일에서 헤더를 찾지 못했습니다.')
  }

  const columns = header
    .map((label, index) => ({ column: index, label }))
    .filter((column) => Boolean(column.label))
  const headers = Object.fromEntries((Object.keys(FIELD_ALIASES) as ChannelSalesField[]).map((field) => [
    field,
    findHeader(columns, FIELD_ALIASES[field]),
  ])) as Record<ChannelSalesField, string | null>

  const hasIdentity = Boolean(headers.sourceSku || headers.productName)
  const hasSales = Boolean(headers.salesAmount || headers.unitSalePrice)
  if (!headers.occurredOn || !headers.quantity || !hasIdentity || !hasSales) {
    throw new Error('CSV에 판매일, 수량, 상품코드 또는 상품명, 판매금액 또는 판매단가 헤더가 필요합니다.')
  }

  const validRows: ParsedChannelSalesRow[] = []
  let totalRows = 0
  let invalidRows = 0
  for (let index = 1; index < rows.length; index += 1) {
    const values = rows[index]
    const rawData = Object.fromEntries(columns.map(({ column, label }) => [label, values[column] ?? '']))
    if (!Object.values(rawData).some((value) => value.trim())) continue

    totalRows += 1
    const parsed = parseChannelSalesRow({ rowNumber: index + 1, rawData, headers })
    if (!isValidChannelSalesRow(parsed)) {
      invalidRows += 1
      continue
    }
    validRows.push(parsed)
  }

  return {
    sheetName: 'CSV',
    headerRow: 1,
    headers,
    totalRows,
    validRows,
    invalidRows,
    warnings: getWarnings(headers),
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

    const headers = Object.fromEntries((Object.keys(FIELD_ALIASES) as ChannelSalesField[]).map((field) => [
      field,
      findHeader(columns, FIELD_ALIASES[field]),
    ])) as Record<ChannelSalesField, string | null>
    const hasIdentity = Boolean(headers.sourceSku || headers.productName)
    const hasSales = Boolean(headers.salesAmount || headers.unitSalePrice)
    if (!headers.occurredOn || !headers.quantity || !hasIdentity || !hasSales) continue

    const score = 30
      + (headers.sourceSku ? 8 : 0)
      + (headers.salesAmount ? 8 : 0)
      + (headers.productCost || headers.unitCost ? 4 : 0)
      + (headers.profitAmount ? 4 : 0)
    if (!best || score > best.score) best = { headerRow: rowNumber, score, columns, headers }
  }
  return best
}

function parseChannelSalesRow(input: {
  rowNumber: number
  rawData: Record<string, string>
  headers: Record<ChannelSalesField, string | null>
}): ParsedChannelSalesRow {
  const quantity = parseQuantity(readField(input.rawData, input.headers.quantity))
  const unitSalePrice = parseAmount(readField(input.rawData, input.headers.unitSalePrice))
  const explicitSalesAmount = parseAmount(readField(input.rawData, input.headers.salesAmount))
  const unitCost = parseAmount(readField(input.rawData, input.headers.unitCost))
  const explicitProductCost = parseAmount(readField(input.rawData, input.headers.productCost))

  return {
    rowNumber: input.rowNumber,
    occurredOn: parseDate(readField(input.rawData, input.headers.occurredOn)),
    sourceSku: cleanText(readField(input.rawData, input.headers.sourceSku)),
    productName: cleanText(readField(input.rawData, input.headers.productName)),
    optionText: cleanText(readField(input.rawData, input.headers.optionText)),
    quantity,
    unitSalePrice,
    salesAmount: explicitSalesAmount ?? (quantity && unitSalePrice != null ? quantity * unitSalePrice : null),
    productCost: explicitProductCost ?? (quantity && unitCost != null ? quantity * unitCost : null),
    marketplaceFee: parseAmount(readField(input.rawData, input.headers.marketplaceFee)),
    paidShippingFee: parseAmount(readField(input.rawData, input.headers.paidShippingFee)),
    actualShippingFee: parseAmount(readField(input.rawData, input.headers.actualShippingFee)),
    boxCost: parseAmount(readField(input.rawData, input.headers.boxCost)),
    profitAmount: parseAmount(readField(input.rawData, input.headers.profitAmount)),
    counterparty: cleanText(readField(input.rawData, input.headers.counterparty)),
    rawData: input.rawData,
  }
}

function isValidChannelSalesRow(row: ParsedChannelSalesRow) {
  return Boolean(row.occurredOn && row.quantity && (row.sourceSku || row.productName) && row.salesAmount != null)
}

function getWarnings(headers: Record<ChannelSalesField, string | null>) {
  const warnings: string[] = []
  if (!headers.profitAmount) {
    warnings.push('마진금액 열이 없어 매출-원가-수수료-배송비 기준으로 이익을 계산합니다.')
  }
  if (!headers.productCost && !headers.unitCost) {
    warnings.push('원가 열이 없어 해당 파일은 매출만 반영하고 이익은 계산하지 않습니다.')
  }
  if (!headers.sourceSku) {
    warnings.push('상품코드 열이 없어 상품명 기준으로만 기록됩니다.')
  }
  return warnings
}

function parseCsvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (character === ',' && !quoted) {
      row.push(value)
      value = ''
      continue
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      rows.push(row)
      row = []
      value = ''
      continue
    }
    value += character
  }

  if (value || row.length > 0) {
    row.push(value)
    rows.push(row)
  }
  return rows
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
      && column.normalized.includes(normalizedAlias)
    ))
    if (partial) return partial.label
  }
  return null
}

function readField(rawData: Record<string, string>, header: string | null) {
  return header ? rawData[header] ?? '' : ''
}

function parseDate(value: string) {
  const text = value.trim()
  if (!text) return null
  const compact = text.replace(/[^0-9]/g, '')
  if (/^\d{8}$/.test(compact)) return toDateString(compact.slice(0, 4), compact.slice(4, 6), compact.slice(6, 8))
  const match = text.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/)
  return match ? toDateString(match[1], match[2], match[3]) : null
}

function toDateString(yearText: string, monthText: string, dayText: string) {
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseQuantity(value: string) {
  const quantity = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : null
}

function parseAmount(value: string) {
  const text = value.trim()
  if (!text) return null
  const normalized = text.replace(/[^0-9.-]/g, '')
  if (!normalized || normalized === '-' || normalized === '.') return null
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
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
