import ExcelJS from 'exceljs'

export const SAAS_CHINA_INVENTORY_EXCEL_SHEET = 'SaaS 중국재고'
export const SAAS_CHINA_INVENTORY_EXCEL_HEADERS = [
  '중국창고',
  '품목코드',
  '상품명',
  '옵션명',
  '현재고',
  '메모',
] as const

export const SAAS_CHINA_INVENTORY_ID_HEADER = 'SaaS재고ID'

export const DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE = '중국창고'

export type SaasChinaInventoryWorkbookSource = 'saas_china_inventory' | 'inventory_status_report'

export type SaasChinaInventoryExcelRow = {
  rowNumber: number
  inventoryId: string | null
  warehouseCode: string
  sku: string
  productName: string | null
  optionName: string | null
  optionKey: string
  onHandQuantity: number | null
  /** Set when a blank `중국창고` report cell is automatically read as zero. */
  reportBlankQuantity?: boolean
  note: string | null
  errors: string[]
}

export type SaasChinaInventoryWorkbookParseError = {
  row: number
  message: string
}

export type SaasChinaInventoryWorkbookParseResult = {
  rows: SaasChinaInventoryExcelRow[]
  errors: SaasChinaInventoryWorkbookParseError[]
  totalRows: number
  skippedRows: number
  source: SaasChinaInventoryWorkbookSource
  /** Number of item rows whose inventory-status `중국창고` cell was blank. */
  reportBlankQuantityRowCount: number
}

export type SaasChinaInventoryExcelExportRow = {
  id: string
  warehouseCode: string
  sku: string
  productName: string
  optionName: string | null
  onHandQuantity: number
  reservedQuantity?: number
  availableQuantity?: number
  lastReceivedAt?: Date | string | null
}

const HEADER_ALIASES = {
  inventoryId: [SAAS_CHINA_INVENTORY_ID_HEADER, '재고ID', 'inventoryid'],
  warehouseCode: ['중국창고', '창고', '창고코드', 'warehouse', 'warehousecode'],
  sku: ['품목코드', '상품코드', 'sku'],
  productName: ['상품명', '품목명', 'productname'],
  optionName: ['옵션명', '옵션', '규격', 'optionname'],
  onHandQuantity: ['현재고', '재고수량', '재고', '수량', 'onhandquantity'],
  note: ['메모', '비고', 'note'],
} as const

// The apply service writes an inventory row and, when its quantity changes, an
// audit movement in one locked transaction. Keeping the import bounded avoids
// holding that workspace lock long enough to exhaust a serverless request.
const MAX_DATA_ROWS = 1_000
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DDEBF7' } }
const INPUT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2CC' } }
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'D9E2F3' } },
  left: { style: 'thin', color: { argb: 'D9E2F3' } },
  right: { style: 'thin', color: { argb: 'D9E2F3' } },
  bottom: { style: 'thin', color: { argb: 'D9E2F3' } },
}

/**
 * Reads the editable SaaS China inventory workbook. Quantity is intentionally
 * nullable: a blank current-stock cell in the SaaS template means "leave this
 * existing row's quantity as-is." A recognized inventory-status report is a
 * snapshot, so its blank `중국창고` cells are read as zero instead.
 */
export async function parseSaasChinaInventoryWorkbook(
  fileBuffer: ArrayBuffer | Uint8Array,
): Promise<SaasChinaInventoryWorkbookParseResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('엑셀 시트를 찾을 수 없습니다.')

  const header = findHeaderRow(sheet)
  if (!header) {
    throw new Error('엑셀에서 품목코드와 현재고 헤더를 찾을 수 없습니다.')
  }
  const { rowNumber: headerRowNumber, columns } = header
  if (!columns.sku || !columns.onHandQuantity) {
    throw new Error('필수 열이 없습니다: 품목코드, 현재고')
  }

  const rows: SaasChinaInventoryExcelRow[] = []
  let totalRows = 0
  let skippedRows = 0
  let reportBlankQuantityRowCount = 0
  const lastRow = Math.min(sheet.rowCount, headerRowNumber + MAX_DATA_ROWS)
  for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const inventoryStatusReportBlankQuantity = isInventoryStatusReportBlankQuantityRow(row, columns)
    if (inventoryStatusReportBlankQuantity) reportBlankQuantityRowCount += 1
    if (isEmptyRow(row) || shouldSkipInventoryStatusReportRow(row, columns)) {
      skippedRows += 1
      continue
    }
    totalRows += 1
    rows.push(parseRow(row, rowNumber, columns, inventoryStatusReportBlankQuantity))
  }
  if (sheet.rowCount > lastRow) {
    const overflow = sheet.rowCount - lastRow
    rows.push({
      rowNumber: lastRow + 1,
      inventoryId: null,
      warehouseCode: DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE,
      sku: '',
      productName: null,
      optionName: null,
      optionKey: '',
      onHandQuantity: null,
      reportBlankQuantity: false,
      note: null,
      errors: [`엑셀은 ${MAX_DATA_ROWS.toLocaleString('ko-KR')}행 이하만 업로드할 수 있습니다. ${overflow.toLocaleString('ko-KR')}행을 확인해주세요.`],
    })
  }

  addDuplicateIdentityErrors(rows)
  return {
    rows,
    errors: rows.flatMap((row) => row.errors.map((message) => ({ row: row.rowNumber, message }))),
    totalRows,
    skippedRows,
    source: columns.source,
    reportBlankQuantityRowCount,
  }
}

export async function exportSaasChinaInventoryTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()
  const sheet = createSheet(workbook, SAAS_CHINA_INVENTORY_EXCEL_SHEET, SAAS_CHINA_INVENTORY_EXCEL_HEADERS, [18, 20, 38, 28, 14, 36])
  const input = sheet.getRow(2)
  input.height = 20
  for (let column = 1; column <= SAAS_CHINA_INVENTORY_EXCEL_HEADERS.length; column += 1) {
    const cell = input.getCell(column)
    cell.border = THIN_BORDER
    cell.fill = INPUT_FILL
  }
  input.getCell(5).numFmt = '#,##0'

  const guide = workbook.addWorksheet('작성안내')
  guide.columns = [{ width: 22 }, { width: 90 }]
  guide.addRow(['항목', '입력 방법'])
  guide.addRow(['중국창고', `비우면 ${DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE}로 처리합니다.`])
  guide.addRow(['품목코드', '필수입니다. 중국창고·품목코드·옵션명 조합으로 기존 재고를 찾습니다.'])
  guide.addRow(['상품명', '기존 재고는 비우면 기존 상품명을 유지합니다. 새 재고는 반드시 입력합니다.'])
  guide.addRow(['옵션명', '중국창고·품목코드·옵션명은 재고 식별키입니다. 새 행의 키를 정확히 입력하세요. 현재 목록 파일에서는 이 세 항목을 변경할 수 없으며, 다른 키의 재고는 새 행으로 추가합니다.'])
  guide.addRow(['현재고', '기존 재고는 절대 수량으로 변경합니다. 비우면 현재 수량을 유지합니다. 새 재고는 1개 이상 필요합니다.'])
  guide.addRow(['메모', '현재고 변경 또는 신규 등록 시 재고 이력에 남습니다. 수량이나 상품명 변경 없이 메모만 저장할 수는 없습니다.'])
  guide.addRow(['주의', '이 양식은 부분 변경용입니다. 엑셀에 없는 재고 행은 유지됩니다. 재고현황 보고서는 중국창고 전체 최신 목록으로 반영되며, 파일에 없는 행은 목록에서 제외됩니다. 출고 예약 또는 발주 연동 수량보다 적게 줄일 수 없습니다.'])
  guide.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = { bold: true }
    cell.border = THIN_BORDER
  })
  guide.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.eachCell((cell) => {
      cell.border = THIN_BORDER
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
  })
  return toBuffer(workbook)
}

/** Exports the current editable list. Extra read-only columns are ignored on re-upload. */
export async function exportSaasChinaInventoryWorkbook(rows: readonly SaasChinaInventoryExcelExportRow[]) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()
  const headers = [SAAS_CHINA_INVENTORY_ID_HEADER, ...SAAS_CHINA_INVENTORY_EXCEL_HEADERS, '출고 예약', '작업 가능', '최근 입고']
  const sheet = createSheet(workbook, SAAS_CHINA_INVENTORY_EXCEL_SHEET, headers, [38, 18, 20, 38, 28, 14, 36, 14, 14, 21])
  sheet.getColumn(1).hidden = true

  for (const value of rows) {
    const row = sheet.addRow([
      value.id,
      value.warehouseCode,
      value.sku,
      value.productName,
      value.optionName ?? '',
      value.onHandQuantity,
      '',
      value.reservedQuantity ?? 0,
      value.availableQuantity ?? value.onHandQuantity,
      normalizeDate(value.lastReceivedAt),
    ])
    styleDataRow(row, new Set([4, 6, 7]), new Set([1, 2, 3, 5, 8, 9, 10]))
    for (const column of [6, 8, 9]) row.getCell(column).numFmt = '#,##0'
    row.getCell(10).numFmt = 'yyyy-mm-dd hh:mm'
  }
  return toBuffer(workbook)
}

export function saasChinaInventoryTemplateFilename() {
  return 'SaaS_중국재고_업로드양식.xlsx'
}

export function saasChinaInventoryExportFilename(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value
  const date = `${part('year')}${part('month')}${part('day')}`
  return `SaaS_중국재고_현재목록_${date}.xlsx`
}

function findHeaderRow(sheet: ExcelJS.Worksheet): { rowNumber: number; columns: HeaderColumns } | null {
  const maxRow = Math.min(sheet.rowCount, 20)
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const columns = headerColumns(sheet.getRow(rowNumber))
    if (columns.sku && columns.onHandQuantity) return { rowNumber, columns }
  }
  return null
}

type HeaderColumns = Partial<Record<keyof typeof HEADER_ALIASES, number>> & {
  source: SaasChinaInventoryWorkbookSource
}

function headerColumns(row: ExcelJS.Row): HeaderColumns {
  const columns: HeaderColumns = { source: 'saas_china_inventory' }
  let chinaWarehouseColumn: number | undefined
  let hasTotalHeader = false
  let hasItemCategoryHeader = false
  row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const normalized = normalizeHeader(cellText(cell.value))
    if (!normalized) return
    if (normalized === normalizeHeader('중국창고')) chinaWarehouseColumn = columnNumber
    if (normalized === normalizeHeader('합계')) hasTotalHeader = true
    if (normalized === normalizeHeader('품목구분')) hasItemCategoryHeader = true
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[keyof typeof HEADER_ALIASES, readonly string[]]>) {
      if (!columns[field] && aliases.some((alias) => normalizeHeader(alias) === normalized)) {
        columns[field] = columnNumber
        return
      }
    }
  })
  // This report's `중국창고` is the current-stock column. In the SaaS
  // template the same label identifies the warehouse, so recognize the
  // report only when its neighboring inventory-status headers are present.
  if (!columns.onHandQuantity && columns.sku && columns.productName && columns.optionName && chinaWarehouseColumn && hasTotalHeader && hasItemCategoryHeader) {
    columns.onHandQuantity = chinaWarehouseColumn
    delete columns.warehouseCode
    columns.source = 'inventory_status_report'
  }
  return columns
}

function parseRow(
  row: ExcelJS.Row,
  rowNumber: number,
  columns: HeaderColumns,
  reportBlankQuantity = false,
): SaasChinaInventoryExcelRow {
  const errors: string[] = []
  const valueAt = (field: keyof typeof HEADER_ALIASES) => (
    columns[field] ? cellText(row.getCell(columns[field]!).value).trim() : ''
  )
  const warehouseCode = valueAt('warehouseCode') || DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE
  const inventoryId = valueAt('inventoryId') || null
  const sku = valueAt('sku')
  const productName = valueAt('productName') || null
  const optionName = valueAt('optionName') || null
  const optionKey = optionName ?? ''
  const quantityText = valueAt('onHandQuantity')
  const note = valueAt('note') || null
  const onHandQuantity = quantityText
    ? parseNonNegativeInteger(quantityText)
    : reportBlankQuantity
      ? 0
      : null

  if (!sku) errors.push('품목코드를 입력해주세요.')
  if (columns.source === 'inventory_status_report' && !productName) {
    errors.push('재고현황의 품목명을 입력해주세요.')
  }
  if (inventoryId && !isUuid(inventoryId)) errors.push('SaaS재고ID를 확인해주세요.')
  if (warehouseCode.length > 100) errors.push('중국창고는 100자 이하로 입력해주세요.')
  if (sku.length > 100) errors.push('품목코드는 100자 이하로 입력해주세요.')
  if (productName && productName.length > 1_000) errors.push('상품명은 1,000자 이하로 입력해주세요.')
  if (optionName && optionName.length > 200) errors.push('옵션명은 200자 이하로 입력해주세요.')
  if (note && note.length > 2_000) errors.push('메모는 2,000자 이하로 입력해주세요.')
  if (quantityText && onHandQuantity == null) errors.push('현재고는 0 이상의 정수로 입력해주세요.')

  return {
    rowNumber,
    inventoryId,
    warehouseCode,
    sku,
    productName,
    optionName,
    optionKey,
    onHandQuantity,
    ...(reportBlankQuantity ? { reportBlankQuantity: true } : {}),
    note,
    errors,
  }
}

function addDuplicateIdentityErrors(rows: SaasChinaInventoryExcelRow[]) {
  const rowsByKey = new Map<string, SaasChinaInventoryExcelRow[]>()
  for (const row of rows) {
    if (!row.sku) continue
    const key = saasChinaInventoryIdentityKey(row)
    const matches = rowsByKey.get(key) ?? []
    matches.push(row)
    rowsByKey.set(key, matches)
  }
  for (const duplicateRows of rowsByKey.values()) {
    if (duplicateRows.length < 2) continue
    for (const row of duplicateRows) {
      row.errors.push('같은 중국창고·품목코드·옵션명 조합이 엑셀에 중복되어 있습니다.')
    }
  }
}

export function saasChinaInventoryIdentityKey(input: Pick<SaasChinaInventoryExcelRow, 'warehouseCode' | 'sku' | 'optionKey'>) {
  return `${input.warehouseCode}\u0000${input.sku}\u0000${input.optionKey}`
}

function parseNonNegativeInteger(value: string) {
  const normalized = value.replaceAll(',', '').trim()
  if (!/^\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function cellText(value: ExcelJS.CellValue) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
  }
  return String(value)
}

function normalizeHeader(value: string) {
  return value.replaceAll(/\s+/g, '').trim().toLocaleLowerCase('en-US')
}

function isEmptyRow(row: ExcelJS.Row) {
  const values = Array.isArray(row.values) ? row.values.slice(1) : Object.values(row.values)
  return !values.some((value) => cellText(value as ExcelJS.CellValue).trim())
}

function shouldSkipInventoryStatusReportRow(
  row: ExcelJS.Row,
  columns: HeaderColumns,
) {
  if (columns.source !== 'inventory_status_report') return false
  const sku = columns.sku ? cellText(row.getCell(columns.sku).value).trim() : ''
  if (sku === '합계') return true
  // The source report writes one timestamp-only footer below its total row.
  // Every other nonempty row must be parsed and validated so a malformed row
  // cannot silently turn into an omission in a full snapshot.
  const values = Array.isArray(row.values) ? row.values.slice(1) : Object.values(row.values)
  const nonEmptyValues = values
    .map((value) => cellText(value as ExcelJS.CellValue).trim())
    .filter(Boolean)
  return nonEmptyValues.length === 1
    && /^\d{8}\s+(?:오전|오후)\s+\d{1,2}:\d{2}(?::\d{2})?$/.test(nonEmptyValues[0])
}

function isInventoryStatusReportBlankQuantityRow(row: ExcelJS.Row, columns: HeaderColumns) {
  if (columns.source !== 'inventory_status_report') return false
  const sku = columns.sku ? cellText(row.getCell(columns.sku).value).trim() : ''
  const productName = columns.productName ? cellText(row.getCell(columns.productName).value).trim() : ''
  if (!sku || sku === '합계' || !productName) return false
  const quantity = columns.onHandQuantity ? cellText(row.getCell(columns.onHandQuantity).value).trim() : ''
  return !quantity
}

function createSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: readonly string[],
  widths: number[],
) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = widths.map((width) => ({ width }))
  const header = sheet.addRow([...headers])
  header.height = 28
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: headers.length } }
  return sheet
}

function styleDataRow(
  row: ExcelJS.Row,
  editableColumns: ReadonlySet<number>,
  referenceColumns: ReadonlySet<number> = new Set(),
) {
  row.height = 20
  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.border = THIN_BORDER
    cell.alignment = { vertical: 'middle', wrapText: columnNumber === 4 || columnNumber === 7 }
    if (editableColumns.has(columnNumber)) cell.fill = INPUT_FILL
    if (referenceColumns.has(columnNumber)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F2F2' } }
  })
}

function normalizeDate(value: Date | string | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date
}

async function toBuffer(workbook: ExcelJS.Workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
