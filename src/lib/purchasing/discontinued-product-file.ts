import ExcelJS from 'exceljs'

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
const PRODUCT_NAME_HEADER = '품목명'
const OPTION_HEADER = '옵션'

/**
 * Reads the optional discontinued-product raw-data workbook. This is a patch
 * file: every listed SKU becomes discontinued, while omitted SKUs keep their state.
 */
export async function parseDiscontinuedProductFile(
  input: DiscontinuedProductUpload,
): Promise<ParsedDiscontinuedProductFile> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(input.fileBuffer) as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error(`${input.fileName}: 시트를 찾을 수 없습니다.`)

  const header = findHeader(sheet)
  if (!header) {
    throw new Error(`${input.fileName}: 단종상품 양식이 아닙니다. 1~20행에 "품목코드", "품목명", "옵션" 열이 모두 있어야 합니다.`)
  }

  const actionsBySku = new Map<string, DiscontinuedProductAction>()
  const duplicateSkus = new Set<string>()
  let totalDataRows = 0

  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const sku = cellText(row.getCell(header.skuColumn).value)
    if (!sku) continue

    totalDataRows += 1
    if (actionsBySku.has(sku)) duplicateSkus.add(sku)
    actionsBySku.set(sku, {
      sku,
      productName: optionalText(row, header.productNameColumn),
      optionName: optionalText(row, header.optionNameColumn),
      sourceRowNumber: rowNumber,
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

function findHeader(sheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const headers = new Map<string, number>()
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const value = normalizeHeader(cellText(cell.value))
      if (value && !headers.has(value)) headers.set(value, columnNumber)
    })
    const skuColumn = findColumn(headers, SKU_HEADER)
    const productNameColumn = findColumn(headers, PRODUCT_NAME_HEADER)
    const optionNameColumn = findColumn(headers, OPTION_HEADER)
    if (!skuColumn || !productNameColumn || !optionNameColumn) continue
    return {
      rowNumber,
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

function optionalText(row: ExcelJS.Row, columnNumber: number | null) {
  if (!columnNumber) return null
  const value = cellText(row.getCell(columnNumber).value)
  return value || null
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return ''
  if (value instanceof Date) return formatDate(value)
  if (typeof value === 'object') {
    if ('result' in value && value.result != null) return cellText(value.result as ExcelJS.CellValue)
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim()
  }
  return String(value).trim()
}

function formatDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
