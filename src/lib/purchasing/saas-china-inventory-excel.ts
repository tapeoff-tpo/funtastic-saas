import { clearBlankExcelCells } from '../excel/empty-cells'
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { normalizeChinaInventoryPackingGroup, proportionalInventoryPackingShare, type ChinaInventoryPackingGroup } from './china-inventory-packing-group'

export const SAAS_CHINA_INVENTORY_EXCEL_SHEET = 'SaaS 중국재고'
export const SAAS_CHINA_INVENTORY_EXCEL_HEADERS = [
  '중국창고',
  '총 박스수량',
  '품목코드',
  '상품명',
  '옵션명',
  '현재고',
  '가로',
  '세로',
  '높이',
  '무게',
  'cbm',
  '메모',
] as const

const PACKAGING_SHEET = '포장정보'
const PACKAGING_FIELDS = ['totalBoxCount', 'lengthCm', 'widthCm', 'heightCm', 'grossWeightKg', 'manualCbm'] as const
const PACKAGING_METADATA_FIELDS = [...PACKAGING_FIELDS, 'packagingReferenceQuantity'] as const
type PackagingMetadataField = typeof PACKAGING_METADATA_FIELDS[number]
type OptionalPackaging = Partial<Record<PackagingMetadataField, number | null>>
const TEMPLATE_WIDTHS = [18, 16, 20, 38, 28, 14, 14, 14, 14, 16, 16, 36]

export const SAAS_CHINA_INVENTORY_ID_HEADER = 'SaaS재고ID'

export const SAAS_CHINA_INVENTORY_STATUS_SHEET = '재고현황'
export const SAAS_CHINA_INVENTORY_STATUS_HEADERS = [
  '품목코드',
  '품목명',
  '규격',
  '품목구분',
  '합계',
] as const

// These are Ecount operational columns, not SaaS China-inventory locations.
// A source inventory-status workbook may retain them, but SaaS imports must
// ignore them so they cannot recreate retired warehouse stock.
export const SAAS_CHINA_INVENTORY_EXCLUDED_WAREHOUSE_CODES = [
  '부품관리',
  '브랜드',
  '원재료 창고',
] as const

export const SAAS_CHINA_INVENTORY_EXCLUDED_WAREHOUSE_ERROR = '부품관리, 브랜드, 원재료 창고는 SaaS 중국재고에서 사용하지 않습니다.'

const saasChinaInventoryExcludedWarehouseCodeSet = new Set(
  SAAS_CHINA_INVENTORY_EXCLUDED_WAREHOUSE_CODES.map((warehouseCode) => normalizeHeader(warehouseCode)),
)

export function isSaasChinaInventoryExcludedWarehouseCode(warehouseCode: string) {
  return saasChinaInventoryExcludedWarehouseCodeSet.has(normalizeHeader(warehouseCode))
}

// Keep the SaaS locations from the standard Ecount inventory-status order.
// Extra active warehouses are appended by the exporter, unless they are a
// retired Ecount-only location above.
export const SAAS_CHINA_INVENTORY_STATUS_WAREHOUSE_CODES = [
  '스마일배송(개인个人1688)',
  '중국발생비용 (中国产生费用)',
  '중국창고',
  '쿠팡',
] as const

export const DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE = '중국창고'

function resolveDefaultWarehouseCode(value: string | null | undefined) {
  return value?.trim() || DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE
}

export type SaasChinaInventoryWorkbookSource = 'saas_china_inventory' | 'inventory_status_report'

export type SaasChinaInventoryExcelRow = OptionalPackaging & {
  packagingGroup?: ChinaInventoryPackingGroup | null
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
  packagingGroup?: ChinaInventoryPackingGroup | null
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
} & Partial<Record<PackagingMetadataField, number | string | null>>

const HEADER_ALIASES = {
  inventoryId: [SAAS_CHINA_INVENTORY_ID_HEADER, '재고ID', 'inventoryid'],
  warehouseCode: ['중국창고', '창고', '창고코드', 'warehouse', 'warehousecode'],
  sku: ['품목코드', '상품코드', 'sku'],
  productName: ['상품명', '품목명', 'productname'],
  optionName: ['옵션명', '옵션', '규격', 'optionname'],
  itemCategory: ['품목구분', '품목 분류', 'itemcategory'],
  onHandQuantity: ['현재고', '재고수량', '재고', '수량', 'onhandquantity'],
  totalBoxCount: ['총 박스수량', '총 박스수', '박스수량', 'totalboxcount'],
  lengthCm: ['가로', '가로(cm)', 'lengthcm'],
  widthCm: ['세로', '세로(cm)', 'widthcm'],
  heightCm: ['높이', '높이(cm)', 'heightcm'],
  grossWeightKg: ['무게', '무게(kg)', '총중량', '총중량(kg)', 'grossweightkg'],
  manualCbm: ['cbm', '체적(m3)', 'manualcbm'],
  packagingReferenceQuantity: ['포장기준수량', 'packagingreferencequantity'],
  packagingGroup: ['혼합포장정보', 'packaginggroup'],
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
  input: { defaultWarehouseCode?: string | null } = {},
): Promise<SaasChinaInventoryWorkbookParseResult> {
  const defaultWarehouseCode = resolveDefaultWarehouseCode(input.defaultWarehouseCode)
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
      const parsed = parseInventoryStatusReportRow(row, rowNumber, columns, defaultWarehouseCode)
      rows.push(...parsed.rows)
      reportEmptyQuantityCellCount += parsed.emptyQuantityCellCount
      continue
    }
    const parsed = parseRow(row, rowNumber, columns, defaultWarehouseCode)
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
      warehouseCode: defaultWarehouseCode,
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
      warehouseCode: defaultWarehouseCode,
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

  if (columns.source === 'inventory_status_report') applyPackagingSheet(workbook, rows, defaultWarehouseCode)
  else inferMixedInventoryPackingGroups(rows)
  validateMixedInventoryPackingGroups(rows)
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

export async function exportSaasChinaInventoryTemplateWorkbook(options: { defaultWarehouseCode?: string | null } = {}) {
  const defaultWarehouseCode = resolveDefaultWarehouseCode(options.defaultWarehouseCode)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()
  const sheet = createSheet(workbook, SAAS_CHINA_INVENTORY_EXCEL_SHEET, SAAS_CHINA_INVENTORY_EXCEL_HEADERS, TEMPLATE_WIDTHS)
  const input = sheet.getRow(2)
  input.height = 20
  for (let column = 1; column <= SAAS_CHINA_INVENTORY_EXCEL_HEADERS.length; column += 1) {
    const cell = input.getCell(column)
    cell.border = THIN_BORDER
    cell.fill = INPUT_FILL
  }
  input.getCell(1).value = defaultWarehouseCode
  input.getCell(2).numFmt = '#,##0'
  input.getCell(6).numFmt = '#,##0'
  for (let column = 7; column <= 11; column += 1) input.getCell(column).numFmt = '0.######'

  const guide = workbook.addWorksheet('작성안내')
  guide.columns = [{ width: 22 }, { width: 90 }]
  guide.addRow(['항목', '입력 방법'])
  guide.addRow(['중국창고', `비우면 ${defaultWarehouseCode}로 처리합니다.`])
  guide.addRow(['품목코드', '필수입니다. 중국창고·품목코드·옵션명 조합으로 새 활성 재고를 만듭니다.'])
  guide.addRow(['상품명', '필수입니다. 새 파일에 있는 모든 재고 행을 새로 생성합니다.'])
  guide.addRow(['옵션명', '중국창고·품목코드·옵션명은 재고 식별키입니다. 새 목록에 필요한 행을 모두 입력하세요.'])
  guide.addRow(['현재고', '현재 활성 재고로 만들 수량을 1개 이상 입력합니다. 0 재고는 행에서 제외하세요.'])
  guide.addRow(['총 박스수량', '선택 입력입니다. 출고 등록 시 이 수만큼 박스를 자동 생성합니다. 비워도 저장됩니다.'])
  guide.addRow(['가로·세로·높이', '선택 입력입니다. 박스 1개 기준 cm 단위로 입력하며 일부 또는 전부 비워도 저장됩니다.'])
  guide.addRow(['무게', '선택 입력입니다. 전체 박스 합계(kg)를 입력합니다. 출고 등록 시 박스 수로 나눠 적용합니다.'])
  guide.addRow(['cbm', '선택 입력입니다. 전체 박스 합계 부피를 입력합니다. 출고 등록 시 박스 수로 나눠 적용합니다.'])
  guide.addRow(['혼합적재 옵션', '같은 상품·창고의 옵션을 연속으로 적고, 첫 옵션에만 박스수량·전체 무게·CBM을 입력하세요. 아래 옵션의 해당 칸을 비우면 같은 박스를 공유하며 수량 비율로 배분합니다.'])
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
  const activeRows = rows.filter((row) => !isSaasChinaInventoryExcludedWarehouseCode(row.warehouseCode))
  const warehouseCodes = inventoryStatusWarehouseCodes(activeRows)
  const headers = [...SAAS_CHINA_INVENTORY_STATUS_HEADERS, ...warehouseCodes]
  const sheet = createSheet(
    workbook,
    SAAS_CHINA_INVENTORY_STATUS_SHEET,
    headers,
    [20, 38, 28, 16, 14, ...warehouseCodes.map(() => 22)],
  )

  const grouped = new Map<string, InventoryStatusExportRow>()
  for (const value of activeRows) {
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
  // The warehouse matrix aggregates identities across warehouses. Keep
  // warehouse-specific packaging separately so a download/upload round trip
  // never copies one warehouse's measurements to another warehouse's stock.
  const packagingRows = activeRows.filter((row) => row.packagingGroup || PACKAGING_FIELDS.some((field) => row[field] != null))
  if (packagingRows.length) {
    const packaging = createSheet(workbook, PACKAGING_SHEET, [...SAAS_CHINA_INVENTORY_EXCEL_HEADERS, '포장기준수량', '혼합포장정보'], [...TEMPLATE_WIDTHS, 18, 18])
    packaging.getColumn(13).hidden = true
    packaging.getColumn(14).hidden = true
    for (const value of packagingRows) {
      const numberAt = (field: PackagingMetadataField) => value[field] == null ? null : Number(value[field])
      const row = packaging.addRow([
        value.warehouseCode, numberAt('totalBoxCount'), value.sku, value.productName, value.optionName ?? '',
        value.onHandQuantity, numberAt('lengthCm'), numberAt('widthCm'), numberAt('heightCm'),
        numberAt('grossWeightKg'), numberAt('manualCbm'), '', numberAt('packagingReferenceQuantity'), value.packagingGroup ? JSON.stringify(value.packagingGroup) : '',
      ])
      styleDataRow(row, new Set([2, 7, 8, 9, 10, 11]))
      row.getCell(2).numFmt = '#,##0'
      row.getCell(6).numFmt = '#,##0'
      for (let column = 7; column <= 11; column += 1) row.getCell(column).numFmt = '0.######'
    }
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
    .filter((warehouseCode) => (
      warehouseCode
      && !standardSet.has(warehouseCode)
      && !isSaasChinaInventoryExcludedWarehouseCode(warehouseCode)
    )))]
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
    const packagingColumns = new Set([...PACKAGING_METADATA_FIELDS.map((field) => columns[field]), columns.packagingGroup])
    for (let columnNumber = itemCategoryColumn + 1; columnNumber <= row.cellCount; columnNumber += 1) {
      const warehouseCode = cellText(row.getCell(columnNumber).value).trim()
      if (
        !warehouseCode
        || packagingColumns.has(columnNumber)
        || normalizeHeader(warehouseCode) === normalizeHeader('합계')
        || isSaasChinaInventoryExcludedWarehouseCode(warehouseCode)
      ) continue
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
  defaultWarehouseCode: string,
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
    const warehouseCode = reportWarehouseColumns[0]?.warehouseCode ?? defaultWarehouseCode
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
  defaultWarehouseCode: string,
  reportBlankQuantity = false,
): SaasChinaInventoryExcelRow {
  const errors: string[] = []
  const valueAt = (field: keyof typeof HEADER_ALIASES) => (
    columns[field] ? cellText(row.getCell(columns[field]!).value).trim() : ''
  )
  const warehouseCode = valueAt('warehouseCode') || defaultWarehouseCode
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
  const packaging = parsePackaging(row, columns, errors)
  const packagingGroupText = valueAt('packagingGroup')
  let packagingGroup: ChinaInventoryPackingGroup | null | undefined
  if (columns.packagingGroup) {
    packagingGroup = null
    if (packagingGroupText) {
      try { packagingGroup = normalizeChinaInventoryPackingGroup(JSON.parse(packagingGroupText)) } catch { /* Report malformed metadata below. */ }
      if (!packagingGroup) errors.push('혼합포장정보를 확인해주세요. 새 양식을 사용하거나 포장정보를 다시 입력해주세요.')
    }
  }

  if (!sku) errors.push('품목코드를 입력해주세요.')
  if (columns.source === 'inventory_status_report' && !productName) {
    errors.push('재고현황의 품목명을 입력해주세요.')
  }
  if (inventoryId && !isUuid(inventoryId)) errors.push('SaaS재고ID를 확인해주세요.')
  if (isSaasChinaInventoryExcludedWarehouseCode(warehouseCode)) {
    errors.push(SAAS_CHINA_INVENTORY_EXCLUDED_WAREHOUSE_ERROR)
  }
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
    ...packaging,
    ...(packagingGroup !== undefined ? { packagingGroup } : {}),
    ...(reportBlankQuantity ? { reportBlankQuantity: true } : {}),
    note,
    errors,
  }
}

function parsePackaging(row: ExcelJS.Row, columns: HeaderColumns, errors: string[]): OptionalPackaging {
  const result: OptionalPackaging = {}
  const labels: Record<PackagingMetadataField, string> = {
    totalBoxCount: '총 박스수량', lengthCm: '가로', widthCm: '세로', heightCm: '높이', grossWeightKg: '무게', manualCbm: 'CBM',
    packagingReferenceQuantity: '포장기준수량',
  }
  for (const field of PACKAGING_METADATA_FIELDS) {
    const column = columns[field]
    if (!column) continue
    const cell = row.getCell(column)
    // ExcelJS resolves merged children to their master's value. For packaging
    // inputs the child is deliberately blank, indicating a shared mixed carton.
    const text = cell.isMerged && cell.master.address !== cell.address ? '' : cellText(cell.value).trim().replaceAll(',', '')
    if (!text) { result[field] = null; continue }
    const value = Number(text)
    const isCount = field === 'totalBoxCount' || field === 'packagingReferenceQuantity'
    const maximum = isCount ? 2_147_483_647 : 999_999_999
    if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(value) || value < (field === 'packagingReferenceQuantity' ? 1 : 0) || value > maximum || (isCount && !Number.isInteger(value))) {
      errors.push(`${labels[field]}은(는) ${field === 'packagingReferenceQuantity' ? 1 : 0} 이상의 ${isCount ? '정수' : '숫자'}로 입력해주세요.`)
      result[field] = null
    } else result[field] = isCount ? value : Math.round(value * 1_000_000) / 1_000_000
  }
  return result
}

function applyPackagingSheet(workbook: ExcelJS.Workbook, rows: SaasChinaInventoryExcelRow[], defaultWarehouseCode: string) {
  const sheet = workbook.getWorksheet(PACKAGING_SHEET)
  if (!sheet) return
  const header = findHeaderRow(sheet)
  if (!header) throw new Error('포장정보 시트에서 품목코드와 현재고 헤더를 찾을 수 없습니다.')
  if (sheet.rowCount > header.rowNumber + MAX_DATA_ROWS) throw new Error('포장정보 시트는 1,000행 이하만 업로드할 수 있습니다.')
  const byIdentity = new Map(rows.map((row) => [saasChinaInventoryIdentityKey(row), row]))
  const seen = new Set<string>()
  const parsedRows: SaasChinaInventoryExcelRow[] = []
  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const raw = sheet.getRow(rowNumber)
    if (isEmptyRow(raw)) continue
    const parsed = parseRow(raw, rowNumber, header.columns, defaultWarehouseCode)
    parsedRows.push(parsed)
  }
  inferMixedInventoryPackingGroups(parsedRows)
  for (const parsed of parsedRows) {
    const key = saasChinaInventoryIdentityKey(parsed)
    const target = byIdentity.get(key)
    // The first sheet remains authoritative for active identities/quantities.
    // Packaging for a removed warehouse row does not re-create inventory.
    if (!target) continue
    if (seen.has(key)) target.errors.push('포장정보 시트에 같은 중국창고·품목코드·옵션명이 중복되어 있습니다.')
    seen.add(key)
    target.errors.push(...parsed.errors.map((message) => `포장정보 ${parsed.rowNumber}행: ${message}`))
    for (const field of PACKAGING_METADATA_FIELDS) {
      if (parsed[field] !== undefined) target[field] = parsed[field]
    }
    if (parsed.packagingGroup !== undefined) target.packagingGroup = parsed.packagingGroup
  }
}

function inferMixedInventoryPackingGroups(rows: SaasChinaInventoryExcelRow[]) {
  const normalizedName = (row: SaasChinaInventoryExcelRow) => row.productName?.trim().replaceAll(/\s+/g, '').toLocaleLowerCase('ko-KR') || ''
  for (let index = 0; index < rows.length; index += 1) {
    const anchor = rows[index]
    if (anchor.packagingGroup || anchor.errors.length || !anchor.totalBoxCount || !anchor.onHandQuantity || !anchor.optionName?.trim() || !normalizedName(anchor)) continue
    const members = [anchor]
    for (let nextIndex = index + 1; nextIndex < rows.length; nextIndex += 1) {
      const next = rows[nextIndex]
      if (next.rowNumber !== members[members.length - 1].rowNumber + 1 || next.packagingGroup || next.errors.length || !next.onHandQuantity
        || next.warehouseCode !== anchor.warehouseCode || normalizedName(next) !== normalizedName(anchor)
        || !next.optionName?.trim() || next.optionKey === anchor.optionKey
        || next.totalBoxCount != null || next.grossWeightKg != null || next.manualCbm != null) break
      members.push(next)
    }
    if (members.length < 2) continue
    const referenceQuantity = members.reduce((sum, member) => sum + member.onHandQuantity!, 0)
    const group = normalizeChinaInventoryPackingGroup({
      version: 1,
      key: `mix-${createHash('sha256').update(members.map((member) => `${member.rowNumber}:${saasChinaInventoryIdentityKey(member)}`).join('\n')).digest('hex').slice(0, 40)}`,
      totalBoxCount: anchor.totalBoxCount, referenceQuantity, memberStartQuantity: 0,
      grossWeightKg: anchor.grossWeightKg ?? null, manualCbm: anchor.manualCbm ?? null,
      lengthCm: anchor.lengthCm ?? null, widthCm: anchor.widthCm ?? null, heightCm: anchor.heightCm ?? null,
    })
    if (!group) { anchor.errors.push('혼합적재 묶음의 박스수량과 전체 수량을 확인해주세요.'); continue }
    let startQuantity = 0
    for (const member of members) {
      member.packagingGroup = { ...group, memberStartQuantity: startQuantity }
      member.packagingReferenceQuantity = member.onHandQuantity
      member.grossWeightKg = proportionalInventoryPackingShare(group.grossWeightKg, referenceQuantity, startQuantity, member.onHandQuantity!, 1_000)
      member.manualCbm = proportionalInventoryPackingShare(group.manualCbm, referenceQuantity, startQuantity, member.onHandQuantity!, 1_000_000)
      for (const field of ['lengthCm', 'widthCm', 'heightCm'] as const) if (member[field] == null) member[field] = group[field]
      startQuantity += member.onHandQuantity!
    }
    index += members.length - 1
  }
}

function validateMixedInventoryPackingGroups(rows: SaasChinaInventoryExcelRow[]) {
  const groups = new Map<string, SaasChinaInventoryExcelRow[]>()
  for (const row of rows) {
    if (!row.packagingGroup) continue
    groups.set(row.packagingGroup.key, [...(groups.get(row.packagingGroup.key) ?? []), row])
  }
  for (const members of groups.values()) {
    const first = members[0]
    const commonFields = ['version', 'key', 'totalBoxCount', 'referenceQuantity', 'grossWeightKg', 'manualCbm', 'lengthCm', 'widthCm', 'heightCm'] as const
    const normalizedName = (row: SaasChinaInventoryExcelRow) => row.productName?.replaceAll(/\s+/g, '').toLocaleLowerCase('ko-KR') ?? ''
    const mismatch = members.some((row) => row.warehouseCode !== first.warehouseCode || normalizedName(row) !== normalizedName(first)
      || commonFields.some((field) => row.packagingGroup![field] !== first.packagingGroup![field]))
    const intervals = members.map((row) => ({ start: row.packagingGroup!.memberStartQuantity, quantity: row.packagingReferenceQuantity ?? row.onHandQuantity ?? 0 }))
      .sort((left, right) => left.start - right.start)
    const invalidRange = intervals.some((range, index) => !Number.isSafeInteger(range.quantity) || range.quantity < 1
      || range.start + range.quantity > first.packagingGroup!.referenceQuantity
      || (index > 0 && range.start < intervals[index - 1].start + intervals[index - 1].quantity))
    if (mismatch || invalidRange) for (const row of members) row.errors.push('혼합포장정보의 상품·창고·전체 합계 또는 옵션별 기준 수량이 일치하지 않습니다.')
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
  clearBlankExcelCells(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
