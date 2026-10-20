import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'

export type DiscontinuedProductAction = {
  sku: string
  productName: string | null
  optionName: string | null
  sourceRowNumber: number
}

export type ParsedDiscontinuedProductFile = {
  fileName: string
  totalDataRows: number
  actions: DiscontinuedProductAction[]
  duplicateSkus: string[]
}

export type DiscontinuedProductUpload = {
  fileName: string
  fileBuffer: ArrayBuffer
}

const SKU_HEADER = '품목코드'
const PRODUCT_NAME_HEADERS = ['품목명', '상품명']
const OPTION_HEADER = '옵션'

/**
 * Reads the optional discontinued-product raw-data workbook. This is a patch
 * file: every listed SKU becomes discontinued, while omitted SKUs keep their state.
 */
export async function parseDiscontinuedProductFile(
  input: DiscontinuedProductUpload,
): Promise<ParsedDiscontinuedProductFile> {
  const workbook = XLSX.read(Buffer.from(input.fileBuffer), { type: 'buffer', cellDates: true })
  const matchedSheet = findSheetWithHeader(workbook)
  if (!matchedSheet) {
    throw new Error(`${input.fileName}: 단종상품 양식이 아닙니다. 모든 시트의 1~20행에 "품목코드", "품목명" 또는 "상품명", "옵션" 열이 모두 있어야 합니다.`)
  }

  const actionsBySku = new Map<string, DiscontinuedProductAction>()
  const duplicateSkus = new Set<string>()
  let totalDataRows = 0

  for (let rowIndex = matchedSheet.header.rowIndex + 1; rowIndex < matchedSheet.rows.length; rowIndex += 1) {
    const row = matchedSheet.rows[rowIndex] ?? []
    const sku = cellText(row[matchedSheet.header.skuColumn - 1])
    if (!sku) continue

    totalDataRows += 1
    if (actionsBySku.has(sku)) duplicateSkus.add(sku)
    actionsBySku.set(sku, {
      sku,
      productName: optionalText(row, matchedSheet.header.productNameColumn),
      optionName: optionalText(row, matchedSheet.header.optionNameColumn),
      sourceRowNumber: matchedSheet.firstRowNumber + rowIndex,
    })
  }

  return {
    fileName: input.fileName,
    totalDataRows,
    actions: [...actionsBySku.values()],
    duplicateSkus: [...duplicateSkus].sort((left, right) => left.localeCompare(right)),
  }
}

export async function createDiscontinuedProductTemplate() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('단종상품')
  sheet.columns = [
    { key: 'sku', width: 18 },
    { key: 'productName', width: 32 },
    { key: 'optionName', width: 28 },
  ]
  sheet.getCell('A1').value = '작성 방법: 단종할 품목을 행별로 입력하세요. 파일에 적힌 모든 SKU가 단종 처리되며, 파일에 없는 품목은 변경되지 않습니다.'
  sheet.mergeCells('A1:C1')
  sheet.getCell('A1').font = { italic: true, color: { argb: 'FF666666' } }
  sheet.getCell('A1').alignment = { wrapText: true }
  sheet.getRow(1).height = 34
  sheet.addRow([])
  const headerRow = sheet.addRow(['품목코드', '품목명', '옵션'])
  headerRow.height = 24
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet.autoFilter = 'A3:C3'
  sheet.views = [{ state: 'frozen', ySplit: 3 }]
  return Buffer.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array)
}

type DiscontinuedHeader = {
  rowIndex: number
  skuColumn: number
  productNameColumn: number
  optionNameColumn: number
}

type MatchedDiscontinuedSheet = {
  header: DiscontinuedHeader
  rows: unknown[][]
  firstRowNumber: number
}

function findSheetWithHeader(workbook: XLSX.WorkBook): MatchedDiscontinuedSheet | null {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true,
    })
    const firstRowNumber = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1').s.r + 1
    const header = findHeader(rows)
    if (header) return { header, rows, firstRowNumber }
  }
  return null
}

function findHeader(rows: unknown[][]): DiscontinuedHeader | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
    const headers = new Map<string, number>()
    for (let columnIndex = 0; columnIndex < (rows[rowIndex]?.length ?? 0); columnIndex += 1) {
      const value = normalizeHeader(cellText(rows[rowIndex]?.[columnIndex]))
      const columnNumber = columnIndex + 1
      if (value && !headers.has(value)) headers.set(value, columnNumber)
    }
    const skuColumn = findColumn(headers, SKU_HEADER)
    const productNameColumn = findFirstColumn(headers, PRODUCT_NAME_HEADERS)
    const optionNameColumn = findColumn(headers, OPTION_HEADER)
    if (!skuColumn || !productNameColumn || !optionNameColumn) continue
    return {
      rowIndex,
      skuColumn,
      productNameColumn,
      optionNameColumn,
    }
  }
  return null
}

function findColumn(headers: Map<string, number>, header: string) {
  return headers.get(normalizeHeader(header)) ?? null
}

function findFirstColumn(headers: Map<string, number>, headersToFind: string[]) {
  for (const header of headersToFind) {
    const column = findColumn(headers, header)
    if (column) return column
  }
  return null
}

function optionalText(row: unknown[], columnNumber: number | null) {
  if (!columnNumber) return null
  const value = cellText(row[columnNumber - 1])
  return value || null
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function cellText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return formatDate(value)
  return String(value).trim()
}

function formatDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
