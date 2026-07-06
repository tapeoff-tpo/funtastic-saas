import ExcelJS from 'exceljs'

export type MonthlySalesMetricRow = {
  internalSku: string
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
}

const SHEET_NAME = '메인'
const SKU_HEADER = '사방넷상품코드'
const CURRENT_MONTH_HEADER = '26/06'
const AVERAGE_MONTH_HEADERS = ['26/04', '26/05', '26/06'] as const

export async function parseMonthlySalesCalculator(fileBuffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)
  const sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.worksheets[0]
  if (!sheet) throw new Error('월 판매 계산기 시트를 찾을 수 없습니다.')

  const columnByHeader = new Map<string, number>()
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    columnByHeader.set(headerText(cell), column)
  })

  const skuColumn = findColumn(columnByHeader, SKU_HEADER)
  const currentMonthColumn = findColumn(columnByHeader, CURRENT_MONTH_HEADER)
  const averageMonthColumns = AVERAGE_MONTH_HEADERS.map((header) => findColumn(columnByHeader, header))
  const rows: MonthlySalesMetricRow[] = []

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const internalSku = cellText(row.getCell(skuColumn))
    if (!internalSku) continue

    const currentMonthOutgoing = cellNumber(row.getCell(currentMonthColumn))
    const averageTotal = averageMonthColumns.reduce(
      (total, column) => total + cellNumber(row.getCell(column)),
      0,
    )
    rows.push({
      internalSku,
      currentMonthOutgoing,
      threeMonthAverageOutgoing: roundOneDecimal(averageTotal / 3),
    })
  }

  return { rows }
}

function findColumn(columnByHeader: Map<string, number>, header: string) {
  const exact = columnByHeader.get(header)
  if (exact) return exact
  const partial = Array.from(columnByHeader.entries()).find(([value]) => value.startsWith(header))
  if (partial) return partial[1]
  throw new Error(`필수 열이 없습니다: ${header}`)
}

function headerText(cell: ExcelJS.Cell) {
  const value = cellResult(cell.value)
  if (value instanceof Date) return formatMonthHeader(value)
  if (typeof value === 'number' && value >= 30000 && value <= 60000) {
    return formatMonthHeader(excelSerialDate(value))
  }
  return String(value ?? '').trim()
}

function cellText(cell: ExcelJS.Cell) {
  return String(cellResult(cell.value) ?? '').trim()
}

function cellNumber(cell: ExcelJS.Cell) {
  const value = cellResult(cell.value)
  const number = typeof value === 'number'
    ? value
    : Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function cellResult(value: ExcelJS.CellValue): ExcelJS.CellValue {
  if (value && typeof value === 'object' && 'result' in value) {
    return value.result as ExcelJS.CellValue
  }
  return value
}

function excelSerialDate(value: number) {
  return new Date(Math.round((value - 25569) * 86400 * 1000))
}

function formatMonthHeader(value: Date) {
  return `${String(value.getUTCFullYear()).slice(-2)}/${String(value.getUTCMonth() + 1).padStart(2, '0')}`
}

function roundOneDecimal(value: number) {
  return Math.round(value * 10) / 10
}
