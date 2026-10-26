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

export const SAAS_CHINA_INVENTORY_STATUS_SHEET = '재고현황'
export const SAAS_CHINA_INVENTORY_STATUS_HEADERS = [
  '품목코드',
  '품목명',
  '규격',
  '품목구분',
  '합계',
] as const

// Keep the standard Ecount inventory-status order. Extra warehouses are
// appended by the exporter, so a new warehouse is never omitted from a
// downloadable full snapshot.
export const SAAS_CHINA_INVENTORY_STATUS_WAREHOUSE_CODES = [
  '부품관리',
  '브랜드',
  '스마일배송(개인个人1688)',
  '원재료 창고',
  '중국발생비용 (中国产生费用)',
  '중국창고',
  '쿠팡',
] as const

export const DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE = '중국창고'

export type SaasChinaInventoryWorkbookSource = 'saas_china_inventory' | 'inventory_status_report'

export type SaasChinaInventoryExcelRow = {
  rowNumber: number
  inventoryId: string | null
  warehouseCode: string
  sku: string
  productName: string | null
  optionName: string | null
  itemCategory: string | null
  optionKey: string
  onHandQuantity: number | null
  /** Kept for compatibility with legacy single-warehouse report rows. */
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
  /** Blank or zero quantity cells omitted from the replacement snapshot. */
  reportEmptyQuantityCellCount: number
}

export type SaasChinaInventoryExcelExportRow = {
  id: string
  warehouseCode: string
  sku: string
  productName: string
  optionName: string | null
  itemCategory: string | null
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
  itemCategory: ['품목구분', '품목 분류', 'itemcategory'],
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
 * Reads the editable SaaS China inventory workbook. Every upload replaces the
 * active snapshot, so each provided row is a new active record. A recognized
 * inventory-status report expands each positive warehouse quantity into its
 * own record. Blank and zero warehouse cells leave no active inventory there.
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
  let reportEmptyQuantityCellCount = 0
  const lastRow = Math.min(sheet.rowCount, headerRowNumber + MAX_DATA_ROWS)
  for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    if (isEmptyRow(row) || shouldSkipInventoryStatusReportRow(row, columns)) {
      skippedRows += 1
      continue
    }
    totalRows += 1
    if (columns.source === 'inventory_status_report') {
      const parsed = parseInventoryStatusReportRow(row, rowNumber, columns)
      rows.push(...parsed.rows)
      reportEmptyQuantityCellCount += parsed.emptyQuantityCellCount
      continue
    }
    const parsed = parseRow(row, rowNumber, columns)
    // Every upload now creates a complete replacement snapshot. A blank or
    // literal zero quantity therefore means that this identity has no active
    // stock in the new snapshot, just like a blank/zero warehouse cell in an
    // inventory-status report. Keep malformed non-empty values in the preview
    // so they still block the replacement instead of being silently omitted.
    const quantityText = columns.onHandQuantity
      ? cellText(row.getCell(columns.onHandQuantity).value).trim()
      : ''
    if (!quantityText) {
      reportEmptyQuantityCellCount += 1
      continue
    }
    if (parsed.onHandQuantity === 0) {
      reportEmptyQuantityCellCount += 1
      continue
    }
    rows.push(parsed)
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
      itemCategory: null,
      optionKey: '',
      onHandQuantity: null,
      note: null,
      errors: [`엑셀은 ${MAX_DATA_ROWS.toLocaleString('ko-KR')}행 이하만 업로드할 수 있습니다. ${overflow.toLocaleString('ko-KR')}행을 확인해주세요.`],
    })
  }
  if (rows.length > MAX_DATA_ROWS) {
    const overflow = rows.length - MAX_DATA_ROWS
    rows.splice(MAX_DATA_ROWS)
    rows.push({
      rowNumber: headerRowNumber + 1,
      inventoryId: null,
      warehouseCode: DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE,
      sku: '',
      productName: null,
      optionName: null,
      itemCategory: null,
      optionKey: '',
      onHandQuantity: null,
      note: null,
      errors: [`재고현황 파일은 ${MAX_DATA_ROWS.toLocaleString('ko-KR')}개 재고 행 이하만 업로드할 수 있습니다. ${overflow.toLocaleString('ko-KR')}개 항목을 확인해주세요.`],
    })
  }

  addDuplicateIdentityErrors(rows)
  return {
    rows,
    errors: rows.flatMap((row) => row.errors.map((message) => ({ row: row.rowNumber, message }))),
    totalRows,
    skippedRows,
    source: columns.source,
    reportEmptyQuantityCellCount,
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
  guide.addRow(['품목코드', '필수입니다. 중국창고·품목코드·옵션명 조합으로 새 활성 재고를 만듭니다.'])
  guide.addRow(['상품명', '필수입니다. 새 파일에 있는 모든 재고 행을 새로 생성합니다.'])
  guide.addRow(['옵션명', '중국창고·품목코드·옵션명은 재고 식별키입니다. 새 목록에 필요한 행을 모두 입력하세요.'])
  guide.addRow(['현재고', '현재 활성 재고로 만들 수량을 1개 이상 입력합니다. 0 재고는 행에서 제외하세요.'])
  guide.addRow(['메모', '새로 생성한 재고의 시작 이력에 남습니다.'])
  guide.addRow(['주의', '이 양식도 전체 교체용입니다. 반영하면 기존 활성 재고를 전부 목록에서 삭제하고, 이 파일의 행만 새 활성 재고로 생성합니다. 출고 예약 또는 발주 연동 재고가 있으면 전체 교체가 차단됩니다.'])
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

/**
 * Exports the active ledger as an Ecount-shaped inventory-status snapshot.
 * A logical item becomes one row, with its on-hand stock split across
 * warehouse columns. The result can be uploaded again as a full snapshot.
 */
export async function exportSaasChinaInventoryWorkbook(rows: readonly SaasChinaInventoryExcelExportRow[]) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()
  const warehouseCodes = inventoryStatusWarehouseCodes(rows)
  const headers = [...SAAS_CHINA_INVENTORY_STATUS_HEADERS, ...warehouseCodes]
  const sheet = createSheet(
    workbook,
    SAAS_CHINA_INVENTORY_STATUS_SHEET,
    headers,
    [20, 38, 28, 16, 14, ...warehouseCodes.map(() => 22)],
  )

  const grouped = new Map<string, InventoryStatusExportRow>()
  for (const value of rows) {
    const sku = value.sku.trim()
    const productName = value.productName.trim()
    const optionName = value.optionName?.trim() || null
    const itemCategory = value.itemCategory?.trim() || null
    const warehouseCode = value.warehouseCode.trim()
    // Product names and categories should be consistent for a SKU/option. If
    // a historical row differs, retain it as a separate report row instead of
    // silently changing an item during a round trip.
    const key = [sku, productName, optionName ?? '', itemCategory ?? ''].join('\u0000')
    const group = grouped.get(key) ?? {
      sku,
      productName,
      optionName,
      itemCategory,
      totalQuantity: 0,
      quantitiesByWarehouse: new Map<string, number>(),
    }
    group.totalQuantity += value.onHandQuantity
    group.quantitiesByWarehouse.set(
      warehouseCode,
      (group.quantitiesByWarehouse.get(warehouseCode) ?? 0) + value.onHandQuantity,
    )
    grouped.set(key, group)
  }

  const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })
  const reportRows = [...grouped.values()].sort((left, right) => (
    inventoryStatusItemCategoryRank(left.itemCategory) - inventoryStatusItemCategoryRank(right.itemCategory)
    || collator.compare(left.sku, right.sku)
    || collator.compare(left.optionName ?? '', right.optionName ?? '')
    || collator.compare(left.productName, right.productName)
    || collator.compare(left.itemCategory ?? '', right.itemCategory ?? '')
  ))
  for (const value of reportRows) {
    const row = sheet.addRow([
      value.sku,
      value.productName,
      value.optionName ?? '',
      value.itemCategory ?? '',
      value.totalQuantity,
      ...warehouseCodes.map((warehouseCode) => value.quantitiesByWarehouse.get(warehouseCode) || ''),
    ])
    styleDataRow(row, new Set<number>())
    for (let column = 5; column <= headers.length; column += 1) row.getCell(column).numFmt = '#,##0'
  }
  return toBuffer(workbook)
}

type InventoryStatusExportRow = {
  sku: string
  productName: string
  optionName: string | null
  itemCategory: string | null
  totalQuantity: number
  quantitiesByWarehouse: Map<string, number>
}

function inventoryStatusWarehouseCodes(rows: readonly SaasChinaInventoryExcelExportRow[]) {
  const standardCodes = [...SAAS_CHINA_INVENTORY_STATUS_WAREHOUSE_CODES]
  const standardSet = new Set<string>(standardCodes)
  const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })
  const extraCodes = [...new Set(rows
    .map((row) => row.warehouseCode.trim())
    .filter((warehouseCode) => warehouseCode && !standardSet.has(warehouseCode)))]
    .sort(collator.compare)
  return [...standardCodes, ...extraCodes]
}

function inventoryStatusItemCategoryRank(itemCategory: string | null) {
  switch (itemCategory?.trim()) {
    case '[부재료]':
    case '부재료':
      return 0
    case '[원재료]':
    case '원재료':
      return 1
    case '[상품]':
    case '상품':
      return 2
    default:
      return 3
  }
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
  reportWarehouseColumns?: Array<{ warehouseCode: string; columnNumber: number }>
}

function headerColumns(row: ExcelJS.Row): HeaderColumns {
  const columns: HeaderColumns = { source: 'saas_china_inventory' }
  let chinaWarehouseColumn: number | undefined
  let hasTotalHeader = false
  row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const normalized = normalizeHeader(cellText(cell.value))
    if (!normalized) return
    if (normalized === normalizeHeader('중국창고')) chinaWarehouseColumn = columnNumber
    if (normalized === normalizeHeader('합계')) hasTotalHeader = true
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[keyof typeof HEADER_ALIASES, readonly string[]]>) {
      if (!columns[field] && aliases.some((alias) => normalizeHeader(alias) === normalized)) {
        columns[field] = columnNumber
        return
      }
    }
  })
  // This report's warehouse headers are quantity columns. In the SaaS
  // template `중국창고` identifies one warehouse, so recognize the report
  // only when its neighboring inventory-status headers and a post-category
  // China-warehouse quantity column are all present. This strict signature
  // prevents a similarly shaped partial-update workbook from becoming a
  // destructive full snapshot.
  const itemCategoryColumn = columns.itemCategory
  if (
    !columns.onHandQuantity
    && columns.sku
    && columns.productName
    && columns.optionName
    && chinaWarehouseColumn
    && hasTotalHeader
    && itemCategoryColumn
    && chinaWarehouseColumn > itemCategoryColumn
  ) {
    const reportWarehouseColumns: Array<{ warehouseCode: string; columnNumber: number }> = []
    for (let columnNumber = itemCategoryColumn + 1; columnNumber <= row.cellCount; columnNumber += 1) {
      const warehouseCode = cellText(row.getCell(columnNumber).value).trim()
      if (!warehouseCode || normalizeHeader(warehouseCode) === normalizeHeader('합계')) continue
      reportWarehouseColumns.push({ warehouseCode, columnNumber })
    }
    if (reportWarehouseColumns.length > 0) {
      columns.onHandQuantity = chinaWarehouseColumn
      delete columns.warehouseCode
      columns.source = 'inventory_status_report'
      columns.reportWarehouseColumns = reportWarehouseColumns
    }
  }
  return columns
}

function parseInventoryStatusReportRow(
  row: ExcelJS.Row,
  rowNumber: number,
  columns: HeaderColumns,
): { rows: SaasChinaInventoryExcelRow[]; emptyQuantityCellCount: number } {
  const valueAt = (field: keyof typeof HEADER_ALIASES) => (
    columns[field] ? cellText(row.getCell(columns[field]!).value).trim() : ''
  )
  const inventoryId = valueAt('inventoryId') || null
  const sku = valueAt('sku')
  const productName = valueAt('productName') || null
  const optionName = valueAt('optionName') || null
  const itemCategory = valueAt('itemCategory') || null
  const optionKey = optionName ?? ''
  const note = valueAt('note') || null
  const commonErrors: string[] = []

  if (!sku) commonErrors.push('품목코드를 입력해주세요.')
  if (!productName) commonErrors.push('재고현황의 품목명을 입력해주세요.')
  if (inventoryId && !isUuid(inventoryId)) commonErrors.push('SaaS재고ID를 확인해주세요.')
  if (sku.length > 100) commonErrors.push('품목코드는 100자 이하로 입력해주세요.')
  if (productName && productName.length > 1_000) commonErrors.push('상품명은 1,000자 이하로 입력해주세요.')
  if (optionName && optionName.length > 200) commonErrors.push('옵션명은 200자 이하로 입력해주세요.')
  if (itemCategory && itemCategory.length > 100) commonErrors.push('품목구분은 100자 이하로 입력해주세요.')
  if (note && note.length > 2_000) commonErrors.push('메모는 2,000자 이하로 입력해주세요.')

  const reportWarehouseColumns = columns.reportWarehouseColumns ?? []
  const parsedRows: SaasChinaInventoryExcelRow[] = []
  let emptyQuantityCellCount = 0

  for (const { warehouseCode, columnNumber } of reportWarehouseColumns) {
    const quantityText = cellText(row.getCell(columnNumber).value).trim()
    const quantity = quantityText ? parseNonNegativeInteger(quantityText) : null
    if (!quantityText || quantity === 0) {
      emptyQuantityCellCount += 1
      continue
    }

    const errors = [...commonErrors]
    if (warehouseCode.length > 100) errors.push('창고명은 100자 이하로 입력해주세요.')
    if (quantity == null) errors.push(`${warehouseCode} 재고는 0 이상의 정수로 입력해주세요.`)
    parsedRows.push({
      rowNumber,
      inventoryId,
      warehouseCode,
      sku,
      productName,
      optionName,
      itemCategory,
      optionKey,
      onHandQuantity: quantity,
      note,
      errors,
    })
  }

  // A malformed all-zero report row still has to block the full snapshot.
  // Otherwise it could silently omit a source identity and archive live stock.
  if (parsedRows.length === 0 && commonErrors.length > 0) {
    const warehouseCode = reportWarehouseColumns[0]?.warehouseCode ?? DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE
    parsedRows.push({
      rowNumber,
      inventoryId,
      warehouseCode,
      sku,
      productName,
      optionName,
      itemCategory,
      optionKey,
      onHandQuantity: null,
      note,
      errors: warehouseCode.length > 100
        ? [...commonErrors, '창고명은 100자 이하로 입력해주세요.']
        : commonErrors,
    })
  }

  return { rows: parsedRows, emptyQuantityCellCount }
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
  const itemCategory = valueAt('itemCategory') || null
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
  if (itemCategory && itemCategory.length > 100) errors.push('품목구분은 100자 이하로 입력해주세요.')
  if (note && note.length > 2_000) errors.push('메모는 2,000자 이하로 입력해주세요.')
  if (quantityText && onHandQuantity == null) errors.push('현재고는 0 이상의 정수로 입력해주세요.')

  return {
    rowNumber,
    inventoryId,
    warehouseCode,
    sku,
    productName,
    optionName,
    itemCategory,
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

async function toBuffer(workbook: ExcelJS.Workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
