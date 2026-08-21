import ExcelJS from 'exceljs'

export type MonthlySalesMetricRow = {
  internalSku: string
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
  isDiscontinued: boolean
}

export async function parseMonthlySalesCalculator(fileBuffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('월 판매 계산기 시트를 찾을 수 없습니다.')
  const rows: MonthlySalesMetricRow[] = []

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const internalSku = cellText(row.getCell(1))
    if (!internalSku) continue

    rows.push({
      internalSku,
      currentMonthOutgoing: 0,
      threeMonthAverageOutgoing: roundOneDecimal(cellNumber(row.getCell(4))),
      isDiscontinued: cellText(row.getCell(13)) === '단종',
    })
  }

  return { rows }
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

function roundOneDecimal(value: number) {
  return Math.round(value * 10) / 10
}
