import ExcelJS from 'exceljs'

const SPECIAL_BULK_MALL_NAME = 'M테이포프(대량)'
const SPECIAL_BULK_POLICY = 'one_month_excluded_repeat_half'
const SPECIAL_BULK_RECURRING_MONTH_THRESHOLD = 2
const SPECIAL_BULK_RECURRING_REFLECTION_RATE = 0.5
const MONTHLY_AVERAGE_SOURCE_MONTH_COUNT = 3

export type MonthlySalesBulkOutgoingAdjustment = {
  specialMall: typeof SPECIAL_BULK_MALL_NAME
  policy: typeof SPECIAL_BULK_POLICY
  sourceMonths: string[]
  rawThreeMonthAverageOutgoing: number
  specialBulkQuantity: number
  specialBulkMonthCount: number
  specialBulkIncludedQuantity: number
  specialBulkExcludedQuantity: number
  adjustedThreeMonthAverageOutgoing: number
}

export type MonthlySalesMetricRow = {
  internalSku: string
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
  rawThreeMonthAverageOutgoing: number
  specialBulkOutgoingAdjustment: MonthlySalesBulkOutgoingAdjustment | null
  isDiscontinued: boolean
}

type MonthlySourceColumn = {
  mainColumn: number
  sheetName: string
  excludedCategoryColumn: number | null
  excludedCategoryValue: string | null
}

export async function parseMonthlySalesCalculator(fileBuffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('월 판매 계산기 시트를 찾을 수 없습니다.')

  const monthlySourceColumns = findMonthlySourceColumns(sheet)
  const specialBulkOutgoingBySku = collectSpecialBulkOutgoingBySku(workbook, monthlySourceColumns)
  const rows: MonthlySalesMetricRow[] = []

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const internalSku = cellText(row.getCell(1))
    if (!internalSku) continue

    const rawThreeMonthAverageOutgoing = roundOneDecimal(cellNumber(row.getCell(4)))
    const specialBulkOutgoingAdjustment = buildSpecialBulkOutgoingAdjustment({
      row,
      internalSku,
      rawThreeMonthAverageOutgoing,
      monthlySourceColumns,
      specialBulkOutgoingBySku,
    })

    rows.push({
      internalSku,
      currentMonthOutgoing: 0,
      threeMonthAverageOutgoing: specialBulkOutgoingAdjustment?.adjustedThreeMonthAverageOutgoing
        ?? rawThreeMonthAverageOutgoing,
      rawThreeMonthAverageOutgoing,
      specialBulkOutgoingAdjustment,
      isDiscontinued: cellText(row.getCell(13)) === '단종',
    })
  }

  return { rows }
}

function findMonthlySourceColumns(sheet: ExcelJS.Worksheet): MonthlySourceColumn[] {
  const maximumSampleRow = Math.min(sheet.rowCount, 40)

  for (let rowNumber = 2; rowNumber <= maximumSampleRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const sources: MonthlySourceColumn[] = []
    const includedSheets = new Set<string>()

    for (let columnNumber = 1; columnNumber <= sheet.columnCount; columnNumber += 1) {
      const formula = row.getCell(columnNumber).formula
      if (!formula) continue

      const source = parseMonthlySourceFormula(formula, columnNumber)
      if (!source || includedSheets.has(source.sheetName)) continue

      sources.push(source)
      includedSheets.add(source.sheetName)
      if (sources.length === MONTHLY_AVERAGE_SOURCE_MONTH_COUNT) return sources
    }
  }

  return []
}

function parseMonthlySourceFormula(formula: string, mainColumn: number): MonthlySourceColumn | null {
  const sourceMatch = formula.match(/SUMIFS\(\s*'([^']+)'!\$[A-Z]+:\$[A-Z]+/i)
  if (!sourceMatch?.[1]) return null

  const excludedCategoryMatch = formula.match(
    /'[^']+'!\$([A-Z]+):\$\1\s*,\s*"<>"\s*&\s*"([^"]+)"/,
  )

  return {
    mainColumn,
    sheetName: sourceMatch[1],
    excludedCategoryColumn: excludedCategoryMatch?.[1]
      ? excelColumnToIndex(excludedCategoryMatch[1])
      : null,
    excludedCategoryValue: excludedCategoryMatch?.[2] ?? null,
  }
}

function collectSpecialBulkOutgoingBySku(
  workbook: ExcelJS.Workbook,
  monthlySourceColumns: MonthlySourceColumn[],
) {
  const outgoingBySku = new Map<string, Map<string, number>>()

  for (const source of monthlySourceColumns) {
    const sourceSheet = workbook.getWorksheet(source.sheetName)
    if (!sourceSheet) continue

    const headerRowNumber = findMonthlySalesHeaderRow(sourceSheet)
    if (headerRowNumber == null) continue

    const headerRow = sourceSheet.getRow(headerRowNumber)
    const marketplaceColumn = findColumnByHeader(headerRow, sourceSheet.columnCount, '쇼핑몰명')
    const skuColumn = findColumnByHeader(headerRow, sourceSheet.columnCount, '사방넷 상품코드')
    const outgoingQuantityColumn = findColumnByHeader(headerRow, sourceSheet.columnCount, '실 출고수량')
    if (!marketplaceColumn || !skuColumn || !outgoingQuantityColumn) continue

    for (let rowNumber = headerRowNumber + 1; rowNumber <= sourceSheet.rowCount; rowNumber += 1) {
      const row = sourceSheet.getRow(rowNumber)
      if (normalizeText(cellText(row.getCell(marketplaceColumn))) !== normalizeText(SPECIAL_BULK_MALL_NAME)) continue
      if (
        source.excludedCategoryColumn != null
        && source.excludedCategoryValue
        && normalizeText(cellText(row.getCell(source.excludedCategoryColumn)))
          === normalizeText(source.excludedCategoryValue)
      ) continue

      const internalSku = cellText(row.getCell(skuColumn))
      const quantity = cellNumber(row.getCell(outgoingQuantityColumn))
      if (!internalSku || quantity === 0) continue

      const bySourceMonth = outgoingBySku.get(internalSku) ?? new Map<string, number>()
      bySourceMonth.set(source.sheetName, (bySourceMonth.get(source.sheetName) ?? 0) + quantity)
      outgoingBySku.set(internalSku, bySourceMonth)
    }
  }

  return outgoingBySku
}

function findMonthlySalesHeaderRow(sheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 10); rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const marketplaceColumn = findColumnByHeader(row, sheet.columnCount, '쇼핑몰명')
    const skuColumn = findColumnByHeader(row, sheet.columnCount, '사방넷 상품코드')
    const outgoingQuantityColumn = findColumnByHeader(row, sheet.columnCount, '실 출고수량')
    if (marketplaceColumn && skuColumn && outgoingQuantityColumn) return rowNumber
  }
  return null
}

function findColumnByHeader(row: ExcelJS.Row, columnCount: number, header: string) {
  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    if (cellText(row.getCell(columnNumber)) === header) return columnNumber
  }
  return null
}

function buildSpecialBulkOutgoingAdjustment(input: {
  row: ExcelJS.Row
  internalSku: string
  rawThreeMonthAverageOutgoing: number
  monthlySourceColumns: MonthlySourceColumn[]
  specialBulkOutgoingBySku: Map<string, Map<string, number>>
}): MonthlySalesBulkOutgoingAdjustment | null {
  if (input.monthlySourceColumns.length !== MONTHLY_AVERAGE_SOURCE_MONTH_COUNT) return null

  const specialBulkBySourceMonth = input.specialBulkOutgoingBySku.get(input.internalSku)
  if (!specialBulkBySourceMonth) return null

  const specialBulkQuantities = input.monthlySourceColumns.map((source) => {
    const monthlyOutgoing = Math.max(0, cellNumber(input.row.getCell(source.mainColumn)))
    const specialBulkOutgoing = Math.max(0, specialBulkBySourceMonth.get(source.sheetName) ?? 0)
    return Math.min(monthlyOutgoing, specialBulkOutgoing)
  })
  const specialBulkQuantity = specialBulkQuantities.reduce((total, quantity) => total + quantity, 0)
  if (specialBulkQuantity <= 0) return null

  const specialBulkMonthCount = specialBulkQuantities.filter((quantity) => quantity > 0).length
  const specialBulkIncludedQuantity = specialBulkMonthCount >= SPECIAL_BULK_RECURRING_MONTH_THRESHOLD
    ? specialBulkQuantity * SPECIAL_BULK_RECURRING_REFLECTION_RATE
    : 0
  const specialBulkExcludedQuantity = specialBulkQuantity - specialBulkIncludedQuantity
  const adjustedThreeMonthAverageOutgoing = roundOneDecimal(Math.max(
    0,
    input.rawThreeMonthAverageOutgoing - specialBulkExcludedQuantity / MONTHLY_AVERAGE_SOURCE_MONTH_COUNT,
  ))

  return {
    specialMall: SPECIAL_BULK_MALL_NAME,
    policy: SPECIAL_BULK_POLICY,
    sourceMonths: input.monthlySourceColumns.map((source) => source.sheetName),
    rawThreeMonthAverageOutgoing: input.rawThreeMonthAverageOutgoing,
    specialBulkQuantity: roundOneDecimal(specialBulkQuantity),
    specialBulkMonthCount,
    specialBulkIncludedQuantity: roundOneDecimal(specialBulkIncludedQuantity),
    specialBulkExcludedQuantity: roundOneDecimal(specialBulkExcludedQuantity),
    adjustedThreeMonthAverageOutgoing,
  }
}

function excelColumnToIndex(column: string) {
  return column.split('').reduce((result, character) => result * 26 + character.charCodeAt(0) - 64, 0)
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, '').trim()
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
