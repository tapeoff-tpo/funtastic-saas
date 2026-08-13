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
  occurredOn: ['업데이트날짜', '매출일', '판매일', '정산일', '거래일자', '출고완료일자', '출고일자', '출고일'],
  sourceSku: ['상품코드', '품목코드', '사방넷 상품코드', '판매자상품코드', '판매자 상품코드', 'SKU'],
  productName: ['제품명', '상품명', '사방넷 상품명', '판매자상품명', '판매자 상품명'],
  optionText: ['옵션', '옵션명', '규격정보', '사방넷 옵션'],
  quantity: ['수량', '출고수량', '실 출고수량', '주문수량', '판매수량'],
  unitSalePrice: ['개당 판매가', '판매단가', '판매가', '단가'],
  salesAmount: ['총 판매금액', '매출금액', '판매금액', '결제금액', '최종결제금액', '총매출'],
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
    const quantity = parseQuantity(readField(rawData, selected.candidate.headers.quantity))
    const unitSalePrice = parseAmount(readField(rawData, selected.candidate.headers.unitSalePrice))
    const explicitSalesAmount = parseAmount(readField(rawData, selected.candidate.headers.salesAmount))
    const unitCost = parseAmount(readField(rawData, selected.candidate.headers.unitCost))
    const explicitProductCost = parseAmount(readField(rawData, selected.candidate.headers.productCost))
    const salesAmount = explicitSalesAmount ?? (quantity && unitSalePrice != null ? quantity * unitSalePrice : null)
    const productCost = explicitProductCost ?? (quantity && unitCost != null ? quantity * unitCost : null)
    const parsed: ParsedChannelSalesRow = {
      rowNumber,
      occurredOn: parseDate(readField(rawData, selected.candidate.headers.occurredOn)),
      sourceSku: cleanText(readField(rawData, selected.candidate.headers.sourceSku)),
      productName: cleanText(readField(rawData, selected.candidate.headers.productName)),
      optionText: cleanText(readField(rawData, selected.candidate.headers.optionText)),
      quantity,
      unitSalePrice,
      salesAmount,
      productCost,
      marketplaceFee: parseAmount(readField(rawData, selected.candidate.headers.marketplaceFee)),
      paidShippingFee: parseAmount(readField(rawData, selected.candidate.headers.paidShippingFee)),
      actualShippingFee: parseAmount(readField(rawData, selected.candidate.headers.actualShippingFee)),
      boxCost: parseAmount(readField(rawData, selected.candidate.headers.boxCost)),
      profitAmount: parseAmount(readField(rawData, selected.candidate.headers.profitAmount)),
      counterparty: cleanText(readField(rawData, selected.candidate.headers.counterparty)),
      rawData,
    }

    if (!parsed.occurredOn || !parsed.quantity || (!parsed.sourceSku && !parsed.productName) || parsed.salesAmount == null) {
      invalidRows += 1
      continue
    }
    validRows.push(parsed)
  }

  const warnings: string[] = []
  if (!selected.candidate.headers.profitAmount) {
    warnings.push('마진금액 열이 없어 매출-원가-수수료-배송비 기준으로 이익을 계산합니다.')
  }
  if (!selected.candidate.headers.productCost && !selected.candidate.headers.unitCost) {
    warnings.push('원가 열이 없어 해당 파일 행은 원가 0원으로 표시됩니다.')
  }
  if (!selected.candidate.headers.sourceSku) {
    warnings.push('상품코드 열이 없어 상품명 기준으로만 기록됩니다.')
  }

  return {
    sheetName: selected.sheet.name,
    headerRow: selected.candidate.headerRow,
    headers: selected.candidate.headers,
    totalRows,
    validRows,
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
