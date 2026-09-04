import ExcelJS from 'exceljs'

export type DiscontinuedProductAction = {
  sku: string
  productName: string | null
  action: 'discontinued' | 'active'
  reason: string | null
  discontinuedDate: string | null
  note: string | null
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

const SKU_HEADERS = ['품목코드', '상품코드', 'SKU', '사방넷코드']
const STATUS_HEADERS = ['단종여부', '단종 상태', '단종상태', '단종']
const PRODUCT_NAME_HEADERS = ['품목명', '상품명', '상품 이름']
const REASON_HEADERS = ['단종사유', '단종 사유', '사유']
const DATE_HEADERS = ['단종일', '단종 일자', '단종일자']
const NOTE_HEADERS = ['비고', '메모', '참고사항']

const DISCONTINUED_VALUES = new Set(['단종', 'y', 'yes', 'true', '1', '종결', '사용안함'])
const ACTIVE_VALUES = new Set(['해제', '정상', '재개', 'n', 'no', 'false', '0', '사용'])

/**
 * Reads the optional discontinued-product raw-data workbook. This is a patch
 * file: each listed SKU changes state, while omitted SKUs keep their state.
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
    throw new Error(`${input.fileName}: 단종상품 양식이 아닙니다. 1~20행에 "품목코드"와 "단종여부" 열이 있어야 합니다.`)
  }

  const actionsBySku = new Map<string, DiscontinuedProductAction>()
  const duplicateSkus = new Set<string>()
  const invalidStatusRows: Array<{ rowNumber: number; value: string }> = []
  let totalDataRows = 0

  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const sku = cellText(row.getCell(header.skuColumn).value)
    if (!sku) continue

    totalDataRows += 1
    const action = parseAction(cellText(row.getCell(header.statusColumn).value))
    if (!action) {
      invalidStatusRows.push({
        rowNumber,
        value: cellText(row.getCell(header.statusColumn).value),
      })
      continue
    }

    if (actionsBySku.has(sku)) duplicateSkus.add(sku)
    actionsBySku.set(sku, {
      sku,
      productName: optionalText(row, header.productNameColumn),
      action,
      reason: optionalText(row, header.reasonColumn),
      discontinuedDate: optionalText(row, header.dateColumn),
      note: optionalText(row, header.noteColumn),
      sourceRowNumber: rowNumber,
    })
  }

  if (invalidStatusRows.length > 0) {
    const samples = invalidStatusRows.slice(0, 5)
      .map((row) => `${row.rowNumber}행${row.value ? ` (${row.value})` : ''}`)
      .join(', ')
    throw new Error(`${input.fileName}: 단종여부에는 "단종" 또는 "해제"를 입력해주세요. 오류: ${samples}`)
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
    { key: 'status', width: 14 },
    { key: 'reason', width: 28 },
    { key: 'date', width: 14 },
    { key: 'note', width: 34 },
  ]
  sheet.getCell('A1').value = '작성 방법: 단종할 품목은 "단종", 다시 발주 가능하게 할 품목은 "해제"로 입력하세요. 파일에 없는 품목은 변경되지 않습니다.'
  sheet.mergeCells('A1:F1')
  sheet.getCell('A1').font = { italic: true, color: { argb: 'FF666666' } }
  sheet.getCell('A1').alignment = { wrapText: true }
  sheet.getRow(1).height = 34
  sheet.addRow([])
  const headerRow = sheet.addRow(['품목코드', '품목명', '단종여부', '단종사유', '단종일', '비고'])
  headerRow.height = 24
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet.autoFilter = 'A3:F3'
  sheet.views = [{ state: 'frozen', ySplit: 3 }]
  sheet.getColumn('C').eachCell({ includeEmpty: true }, (cell) => {
    cell.alignment = { horizontal: 'center' }
  })
  return Buffer.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array)
}

function findHeader(sheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const headers = new Map<string, number>()
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const value = normalizeHeader(cellText(cell.value))
      if (value && !headers.has(value)) headers.set(value, columnNumber)
    })
    const skuColumn = findColumn(headers, SKU_HEADERS)
    const statusColumn = findColumn(headers, STATUS_HEADERS)
    if (!skuColumn || !statusColumn) continue
    return {
      rowNumber,
      skuColumn,
      statusColumn,
      productNameColumn: findColumn(headers, PRODUCT_NAME_HEADERS),
      reasonColumn: findColumn(headers, REASON_HEADERS),
      dateColumn: findColumn(headers, DATE_HEADERS),
      noteColumn: findColumn(headers, NOTE_HEADERS),
    }
  }
  return null
}

function findColumn(headers: Map<string, number>, aliases: string[]) {
  return aliases.map(normalizeHeader).map((header) => headers.get(header)).find(Boolean) ?? null
}

function parseAction(value: string): DiscontinuedProductAction['action'] | null {
  const normalized = value.replace(/\s+/g, '').toLowerCase()
  if (DISCONTINUED_VALUES.has(normalized)) return 'discontinued'
  if (ACTIVE_VALUES.has(normalized)) return 'active'
  return null
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
