import { createHash, randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { CHINA_OUTBOUND_DESTINATIONS } from './china-outbound-destinations'

/**
 * This is the shared China-outbound workbook layout. It creates new outbound
 * tasks from Excel and is also used as the prefilled working workbook for an
 * outbound task that already exists.
 */
export const CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS = {
  shipment: '출고정보',
  items: '출고상품',
  boxes: '박스 쉽먼트',
  inventory: '현재 중국재고(当前中国库存)',
} as const

// This sheet is deliberately hidden from the operator-facing template. Excel
// data validation cannot reliably point at another sheet directly, so it owns
// the named range used by the three 출고창고 dropdowns.
export const CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_SHEET = '출고창고목록'
export const CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_NAME = 'ChinaOutboundWarehouseOptions'

export const CHINA_OUTBOUND_REGISTRATION_SHIPMENT_HEADERS = [
  '엑셀등록번호',
  '출고작업명',
  '도착지',
  '출고창고',
  '출고예정일',
  '메모',
] as const

export const CHINA_OUTBOUND_REGISTRATION_ITEM_HEADERS = [
  '출고창고',
  '품목코드',
  '상품명',
  '옵션명',
  '출고수량',
] as const

export const CHINA_OUTBOUND_REGISTRATION_BOX_HEADERS = [
  '출고창고',
  '품목코드',
  '상품명',
  '옵션명',
  '박스번호',
  '박스 적재수량',
  '가로(cm)',
  '세로(cm)',
  '높이(cm)',
  '파렛트번호',
] as const

// Keep the Korean-only headers above as the canonical import keys. New files
// show both languages so Korean and Chinese operators can use the same sheet.
// headerColumns() maps these display labels back to their Korean counterparts
// and also continues to accept templates downloaded before this change.
export const CHINA_OUTBOUND_REGISTRATION_SHIPMENT_DISPLAY_HEADERS = [
  '엑셀등록번호 / Excel登记编号',
  '출고작업명 / 出库作业名称',
  '도착지 / 目的地',
  '출고창고 / 出库仓库',
  '출고예정일 / 预计出库日期',
  '메모 / 备注',
] as const

export const CHINA_OUTBOUND_REGISTRATION_ITEM_DISPLAY_HEADERS = [
  '출고창고 / 出库仓库',
  '품목코드 / 商品编码',
  '상품명 / 商品名称',
  '옵션명 / 规格',
  '출고수량 / 出库数量',
] as const

export const CHINA_OUTBOUND_REGISTRATION_BOX_DISPLAY_HEADERS = [
  '출고창고 / 出库仓库',
  '품목코드 / 商品编码',
  '상품명 / 商品名称',
  '옵션명 / 规格',
  '박스번호 / 箱号',
  '박스 적재수량 / 装箱数量',
  '가로(cm) / 长(cm)',
  '세로(cm) / 宽(cm)',
  '높이(cm) / 高(cm)',
  '파렛트번호 / 托盘号',
] as const

export const CHINA_OUTBOUND_REGISTRATION_INVENTORY_HEADERS = [
  '출고창고 / 出库仓库',
  '품목코드 / 商品编码',
  '상품명(한국어) / 商品名称（韩文）',
  '옵션명(한국어) / 规格（韩文）',
  '품목구분 / 品目分类',
  '현재고 / 当前库存',
  '예약수량 / 已预留',
  '출고가능수량 / 可出库数量',
  '최종 입고일 / 最近入库日',
  '최종 출고일 / 最近出库日',
] as const

export type ChinaOutboundRegistrationWorkbookError = {
  sheet: string
  row: number | null
  message: string
}

export type ChinaOutboundRegistrationWorkbookItem = {
  rowNumber: number
  warehouseCode: string
  sku: string
  optionName: string | null
  quantity: number
}

export type ChinaOutboundRegistrationWorkbookBoxAllocation = {
  rowNumber: number
  warehouseCode: string
  sku: string
  optionName: string | null
  boxNo: string
  quantity: number
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
  palletNo: string | null
}

export type ChinaOutboundRegistrationWorkbook = {
  importKey: string
  displayName: string | null
  destinationName: string | null
  defaultWarehouseCode: string | null
  plannedOutboundDate: string | null
  memo: string | null
  items: ChinaOutboundRegistrationWorkbookItem[]
  boxAllocations: ChinaOutboundRegistrationWorkbookBoxAllocation[]
  errors: ChinaOutboundRegistrationWorkbookError[]
}

export type ChinaOutboundRegistrationCurrentInventoryRow = {
  warehouseCode: string
  sku: string
  productName: string
  optionName: string | null
  itemCategory: string | null
  onHandQuantity: number
  reservedQuantity: number
  availableQuantity: number
  lastReceivedAt: Date | string | null
  lastOutboundAt: Date | string | null
}

export type ChinaOutboundRegistrationWorkbookPrefilledItem = {
  warehouseCode: string
  sku: string
  productName?: string | null
  optionName?: string | null
  quantity: number
}

export type ChinaOutboundRegistrationWorkbookPrefilledBoxAllocation = {
  warehouseCode: string
  sku: string
  productName?: string | null
  optionName?: string | null
  boxNo: string
  quantity: number
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
  palletNo?: string | null
}

export type ChinaOutboundRegistrationWorkbookParseOptions = {
  /** New-shipment registration requires a complete packing allocation when any box is entered. */
  requireCompleteBoxAllocations?: boolean
  /** Accept blank starter rows from workbooks downloaded before packing was saved. */
  ignoreBlankBoxPlaceholders?: boolean
  /** Existing shipments can be packed even if a legacy shipment has no destination snapshot. */
  requireDestination?: boolean
  /** Working uploads do not apply header changes, so legacy destination labels remain acceptable. */
  validateDestination?: boolean
}

const MAX_ITEM_ROWS = 1_000
const MAX_BOX_ROWS = 5_000
const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF5' },
}
const INPUT_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF7D6' },
}
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin', color: { argb: 'FFD4D4D8' } },
}
const CHINA_OUTBOUND_REGISTRATION_HEADER_ALIASES = createHeaderAliases([
  [CHINA_OUTBOUND_REGISTRATION_SHIPMENT_HEADERS, CHINA_OUTBOUND_REGISTRATION_SHIPMENT_DISPLAY_HEADERS],
  [CHINA_OUTBOUND_REGISTRATION_ITEM_HEADERS, CHINA_OUTBOUND_REGISTRATION_ITEM_DISPLAY_HEADERS],
  [CHINA_OUTBOUND_REGISTRATION_BOX_HEADERS, CHINA_OUTBOUND_REGISTRATION_BOX_DISPLAY_HEADERS],
])
type WorksheetWithDataValidations = ExcelJS.Worksheet & {
  dataValidations: {
    add(range: string, validation: ExcelJS.DataValidation): void
  }
}

/**
 * The import key doubles as the immutable shipment number. Retrying the same
 * workbook therefore returns the already-created shipment instead of making a
 * second reservation when a network response is lost.
 */
export function createChinaOutboundRegistrationImportKey(now = new Date(), token = randomUUID()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value
  const date = `${part('year')}${part('month')}${part('day')}`
  const suffix = token.replaceAll(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() || 'UPLOAD'
  return `CN-${date}-XLSX-${suffix}`
}

/**
 * A registration number alone prevents accidental duplicate submission, but a
 * copied template can retain that number. Store a semantic fingerprint too so
 * a retry of the same file is safe while a changed file must use a new template.
 */
export function createChinaOutboundRegistrationWorkbookFingerprint(workbook: ChinaOutboundRegistrationWorkbook) {
  const content = JSON.stringify({
    version: 1,
    importKey: workbook.importKey,
    displayName: workbook.displayName,
    destinationName: workbook.destinationName,
    plannedOutboundDate: workbook.plannedOutboundDate,
    memo: workbook.memo,
    items: workbook.items
      .map(({ warehouseCode, sku, optionName, quantity }) => ({ warehouseCode, sku, optionName, quantity }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en')),
    boxAllocations: workbook.boxAllocations
      .map(({ warehouseCode, sku, optionName, boxNo, quantity, lengthCm, widthCm, heightCm, palletNo }) => ({
        warehouseCode, sku, optionName, boxNo, quantity, lengthCm, widthCm, heightCm, palletNo,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en')),
  })
  return `excel-registration:v1:${createHash('sha256').update(content).digest('hex')}`
}

export async function exportChinaOutboundRegistrationTemplateWorkbook(input: {
  importKey?: string
  defaultWarehouseCode?: string | null
  warehouseCodes?: readonly string[]
  currentInventory?: readonly ChinaOutboundRegistrationCurrentInventoryRow[]
  prefilledShipment?: {
    displayName?: string | null
    destinationName?: string | null
    plannedOutboundDate?: string | null
    memo?: string | null
  }
  prefilledItems?: readonly ChinaOutboundRegistrationWorkbookPrefilledItem[]
  prefilledBoxAllocations?: readonly ChinaOutboundRegistrationWorkbookPrefilledBoxAllocation[]
  includeBlankBoxPlaceholders?: boolean
} = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()
  const defaultWarehouseCode = input.defaultWarehouseCode?.trim() ?? ''
  const warehouseCodes = normalizeWarehouseCodes(defaultWarehouseCode, input.warehouseCodes ?? [])
  const prefilledShipment = input.prefilledShipment
  const prefilledItems = input.prefilledItems ?? []
  const prefilledBoxAllocations = input.prefilledBoxAllocations ?? []

  const shipment = createSheet(
    workbook,
    CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment,
    CHINA_OUTBOUND_REGISTRATION_SHIPMENT_DISPLAY_HEADERS,
    [28, 32, 16, 22, 16, 48],
  )
  addInputRow(shipment, [
    input.importKey ?? createChinaOutboundRegistrationImportKey(),
    prefilledShipment?.displayName?.trim() ?? '',
    prefilledShipment?.destinationName?.trim() ?? '',
    defaultWarehouseCode,
    prefilledShipment?.plannedOutboundDate?.trim() ?? '',
    prefilledShipment?.memo?.trim() ?? '',
  ])

  const items = createSheet(
    workbook,
    CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items,
    CHINA_OUTBOUND_REGISTRATION_ITEM_DISPLAY_HEADERS,
    [22, 22, 40, 28, 16],
  )
  if (prefilledItems.length > 0) {
    for (const item of prefilledItems) {
      addInputRow(items, [
        item.warehouseCode.trim(),
        item.sku.trim(),
        item.productName?.trim() ?? '',
        item.optionName?.trim() ?? '',
        item.quantity,
      ])
    }
  } else {
    addInputRow(items, ['', '', '', '', ''])
  }

  const boxes = createSheet(
    workbook,
    CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes,
    CHINA_OUTBOUND_REGISTRATION_BOX_DISPLAY_HEADERS,
    [22, 22, 40, 28, 18, 18, 16, 16, 16, 18],
  )
  for (const allocation of prefilledBoxAllocations) {
    addInputRow(boxes, [
      allocation.warehouseCode.trim(),
      allocation.sku.trim(),
      allocation.productName?.trim() ?? '',
      allocation.optionName?.trim() ?? '',
      allocation.boxNo.trim(),
      allocation.quantity,
      allocation.lengthCm ?? '',
      allocation.widthCm ?? '',
      allocation.heightCm ?? '',
      allocation.palletNo?.trim() ?? '',
    ])
  }
  if (input.includeBlankBoxPlaceholders && prefilledItems.length > 0) {
    // Saved allocations already provide editable rows. Add a starter row only
    // for items without any saved box, so repeated downloads do not grow rows.
    const allocatedItems = new Set(prefilledBoxAllocations.map((allocation) => sourceKey({
      warehouseCode: allocation.warehouseCode.trim(),
      sku: allocation.sku.trim(),
      optionName: allocation.optionName?.trim() || null,
    })))
    for (const item of prefilledItems) {
      if (allocatedItems.has(sourceKey({
        warehouseCode: item.warehouseCode.trim(),
        sku: item.sku.trim(),
        optionName: item.optionName?.trim() || null,
      }))) continue
      addInputRow(boxes, [
        item.warehouseCode.trim(),
        item.sku.trim(),
        item.productName?.trim() ?? '',
        item.optionName?.trim() ?? '',
        '',
        '',
        '',
        '',
        '',
        '',
      ])
    }
  } else if (prefilledBoxAllocations.length === 0) {
    addInputRow(boxes, ['', '', '', '', '', '', '', '', '', ''])
  }

  addCurrentInventorySheet(workbook, input.currentInventory ?? [])

  if (warehouseCodes.length > 0) {
    addWarehouseOptionsSheet(workbook, warehouseCodes)
    addWarehouseDropdown(shipment, 'D2')
    addWarehouseDropdown(items, `A2:A${MAX_ITEM_ROWS + 1}`)
    addWarehouseDropdown(boxes, `A2:A${MAX_BOX_ROWS + 1}`)
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function parseChinaOutboundRegistrationWorkbook(
  fileBuffer: ArrayBuffer | Uint8Array,
  options: ChinaOutboundRegistrationWorkbookParseOptions = {},
): Promise<ChinaOutboundRegistrationWorkbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer as ExcelJS.Buffer)
  const errors: ChinaOutboundRegistrationWorkbookError[] = []

  const shipment = parseShipmentSheet(
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment),
    errors,
    options.requireDestination ?? true,
    options.validateDestination ?? true,
  )
  const items = parseItemsSheet(
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items),
    shipment.defaultWarehouseCode,
    errors,
  )
  const boxAllocations = parseBoxesSheet(
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes),
    shipment.defaultWarehouseCode,
    errors,
    options.ignoreBlankBoxPlaceholders ?? false,
  )
  const normalizedBoxAllocations = validateRelationships(
    items,
    boxAllocations,
    errors,
    options.requireCompleteBoxAllocations ?? true,
  )

  return {
    ...shipment,
    items,
    boxAllocations: normalizedBoxAllocations,
    errors,
  }
}

function createSheet(workbook: ExcelJS.Workbook, name: string, headers: readonly string[], widths: number[]) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = widths.map((width) => ({ width }))
  const header = sheet.addRow([...headers])
  header.height = 36
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

function addInputRow(sheet: ExcelJS.Worksheet, values: Array<string | number>) {
  const row = sheet.addRow(values)
  row.height = 20
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = THIN_BORDER
    cell.fill = INPUT_FILL
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
}

function addCurrentInventorySheet(
  workbook: ExcelJS.Workbook,
  inventory: readonly ChinaOutboundRegistrationCurrentInventoryRow[],
) {
  const sheet = workbook.addWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.inventory)
  sheet.columns = [22, 22, 42, 30, 18, 14, 14, 18, 18, 18].map((width) => ({ width }))
  const header = sheet.addRow([...CHINA_OUTBOUND_REGISTRATION_INVENTORY_HEADERS])
  header.height = 36
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = {
    from: 'A1',
    to: { row: 1, column: CHINA_OUTBOUND_REGISTRATION_INVENTORY_HEADERS.length },
  }

  for (const item of inventory) {
    const row = sheet.addRow([
      item.warehouseCode,
      item.sku,
      item.productName,
      item.optionName ?? '',
      bilingualItemCategory(item.itemCategory),
      item.onHandQuantity,
      item.reservedQuantity,
      item.availableQuantity,
      formatSeoulDate(item.lastReceivedAt),
      formatSeoulDate(item.lastOutboundAt),
    ])
    row.height = 20
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.border = THIN_BORDER
      cell.alignment = {
        vertical: 'middle',
        wrapText: columnNumber === 3 || columnNumber === 4 || columnNumber === 5,
      }
      if (columnNumber >= 6 && columnNumber <= 8) cell.numFmt = '#,##0'
    })
  }
}

function normalizeWarehouseCodes(defaultWarehouseCode: string, warehouseCodes: readonly string[]) {
  const seen = new Set<string>()
  return [defaultWarehouseCode, ...warehouseCodes].flatMap((warehouseCode) => {
    const normalized = warehouseCode.trim()
    if (!normalized || seen.has(normalized)) return []
    seen.add(normalized)
    return [normalized]
  })
}

function addWarehouseOptionsSheet(workbook: ExcelJS.Workbook, warehouseCodes: readonly string[]) {
  const sheet = workbook.addWorksheet(CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_SHEET)
  sheet.state = 'veryHidden'
  warehouseCodes.forEach((warehouseCode) => sheet.addRow([warehouseCode]))
  workbook.definedNames.add(
    `${sheet.name}!$A$1:$A$${warehouseCodes.length}`,
    CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_NAME,
  )
}

function addWarehouseDropdown(sheet: ExcelJS.Worksheet, range: string) {
  const sheetWithDataValidations = sheet as WorksheetWithDataValidations
  sheetWithDataValidations.dataValidations.add(range, {
    type: 'list',
    allowBlank: true,
    formulae: [`=${CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_NAME}`],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '출고창고 선택',
    error: '등록된 출고창고 목록에서 선택해주세요.',
    showInputMessage: true,
    promptTitle: '출고창고',
    prompt: '등록된 출고창고 목록에서 선택하세요. 빈칸은 출고정보의 기본 창고를 사용합니다.',
  })
}

function bilingualItemCategory(value: string | null) {
  const normalized = value?.trim() ?? ''
  const category = normalized.replaceAll(/^[\[]|[\]]$/g, '').trim()
  const chineseByCategory: Record<string, string> = {
    '부재료': '辅料',
    '원재료': '原材料',
    '상품': '商品',
  }
  const chinese = chineseByCategory[category]
  return chinese ? `${category} / ${chinese}` : normalized
}

function formatSeoulDate(value: Date | string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function parseShipmentSheet(
  sheet: ExcelJS.Worksheet | undefined,
  errors: ChinaOutboundRegistrationWorkbookError[],
  requireDestination: boolean,
  validateDestination: boolean,
): Pick<ChinaOutboundRegistrationWorkbook, 'importKey' | 'displayName' | 'destinationName' | 'defaultWarehouseCode' | 'plannedOutboundDate' | 'memo'> {
  const blank = {
    importKey: '',
    displayName: null,
    destinationName: null,
    defaultWarehouseCode: null,
    plannedOutboundDate: null,
    memo: null,
  }
  if (!sheet) {
    errors.push({ sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment, row: null, message: '출고정보 시트를 찾을 수 없습니다.' })
    return blank
  }
  const columns = headerColumns(
    sheet,
    CHINA_OUTBOUND_REGISTRATION_SHIPMENT_HEADERS.filter((header) => header !== '출고창고'),
    errors,
  )
  if (!columns) return blank
  const nonEmptyRows: Array<{ row: ExcelJS.Row; rowNumber: number }> = []
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    if (!isEmptyRow(row)) nonEmptyRows.push({ row, rowNumber })
  }
  const first = nonEmptyRows[0]
  if (!first) {
    errors.push({ sheet: sheet.name, row: 2, message: '출고정보를 한 행 입력해주세요.' })
    return blank
  }
  if (nonEmptyRows.length > 1) {
    for (const extra of nonEmptyRows.slice(1)) {
      errors.push({ sheet: sheet.name, row: extra.rowNumber, message: '한 파일에는 출고정보를 한 행만 입력할 수 있습니다.' })
    }
  }
  const importKey = cellText(first.row.getCell(columns.get('엑셀등록번호')!)).trim()
  const displayName = nullableText(first.row.getCell(columns.get('출고작업명')!))
  const destinationName = nullableText(first.row.getCell(columns.get('도착지')!))
  const defaultWarehouseCode = columns.has('출고창고')
    ? nullableText(first.row.getCell(columns.get('출고창고')!))
    : null
  const plannedOutboundDate = parseDate(first.row.getCell(columns.get('출고예정일')!), sheet.name, first.rowNumber, errors)
  const memo = nullableText(first.row.getCell(columns.get('메모')!))
  validateText(importKey, '엑셀등록번호', 100, sheet.name, first.rowNumber, errors, true)
  validateText(displayName, '출고작업명', 200, sheet.name, first.rowNumber, errors)
  validateText(defaultWarehouseCode, '출고창고', 100, sheet.name, first.rowNumber, errors)
  validateText(memo, '메모', 2_000, sheet.name, first.rowNumber, errors)
  if (!destinationName) {
    if (requireDestination) errors.push({ sheet: sheet.name, row: first.rowNumber, message: '도착지를 입력해주세요.' })
  } else if (validateDestination && !CHINA_OUTBOUND_DESTINATIONS.includes(destinationName as (typeof CHINA_OUTBOUND_DESTINATIONS)[number])) {
    errors.push({ sheet: sheet.name, row: first.rowNumber, message: `도착지는 ${CHINA_OUTBOUND_DESTINATIONS.join(', ')} 중 하나여야 합니다.` })
  }
  return { importKey, displayName, destinationName, defaultWarehouseCode, plannedOutboundDate, memo }
}

function parseItemsSheet(
  sheet: ExcelJS.Worksheet | undefined,
  defaultWarehouseCode: string | null,
  errors: ChinaOutboundRegistrationWorkbookError[],
) {
  const items: ChinaOutboundRegistrationWorkbookItem[] = []
  if (!sheet) {
    errors.push({ sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items, row: null, message: '출고상품 시트를 찾을 수 없습니다.' })
    return items
  }
  // Product names are reference text; older files without this column remain valid.
  const columns = headerColumns(sheet, CHINA_OUTBOUND_REGISTRATION_ITEM_HEADERS.filter((header) => header !== '상품명'), errors)
  if (!columns) return items
  const lastRow = Math.min(sheet.rowCount, MAX_ITEM_ROWS + 1)
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    if (isEmptyRow(row)) continue
    const warehouseCode = cellText(row.getCell(columns.get('출고창고')!)).trim() || defaultWarehouseCode || ''
    const sku = cellText(row.getCell(columns.get('품목코드')!)).trim()
    const optionName = nullableText(row.getCell(columns.get('옵션명')!))
    const quantity = positiveInteger(cellText(row.getCell(columns.get('출고수량')!)))
    const valid = validateText(warehouseCode, '출고창고', 100, sheet.name, rowNumber, errors, true)
      && validateText(sku, '품목코드', 100, sheet.name, rowNumber, errors, true)
      && validateText(optionName, '옵션명', 200, sheet.name, rowNumber, errors)
    if (quantity == null) errors.push({ sheet: sheet.name, row: rowNumber, message: '출고수량은 1 이상의 정수여야 합니다.' })
    if (valid && quantity != null) items.push({ rowNumber, warehouseCode, sku, optionName, quantity })
  }
  if (sheet.rowCount > lastRow) {
    errors.push({ sheet: sheet.name, row: lastRow + 1, message: `출고상품은 ${MAX_ITEM_ROWS.toLocaleString('ko-KR')}행 이하만 입력할 수 있습니다.` })
  }
  if (items.length === 0) errors.push({ sheet: sheet.name, row: 2, message: '출고할 상품을 한 행 이상 입력해주세요.' })
  return items
}

function parseBoxesSheet(
  sheet: ExcelJS.Worksheet | undefined,
  defaultWarehouseCode: string | null,
  errors: ChinaOutboundRegistrationWorkbookError[],
  ignoreBlankBoxPlaceholders: boolean,
) {
  const allocations: ChinaOutboundRegistrationWorkbookBoxAllocation[] = []
  if (!sheet) {
    errors.push({ sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes, row: null, message: '박스 쉽먼트 시트를 찾을 수 없습니다.' })
    return allocations
  }
  // Product names are reference text, so previously downloaded files remain valid.
  const columns = headerColumns(sheet, CHINA_OUTBOUND_REGISTRATION_BOX_HEADERS.filter((header) => header !== '상품명'), errors)
  if (!columns) return allocations
  const lastRow = Math.min(sheet.rowCount, MAX_BOX_ROWS + 1)
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    if (isEmptyRow(row)) continue
    const warehouseCode = cellText(row.getCell(columns.get('출고창고')!)).trim() || defaultWarehouseCode || ''
    const sku = cellText(row.getCell(columns.get('품목코드')!)).trim()
    const optionName = nullableText(row.getCell(columns.get('옵션명')!))
    const boxNo = cellText(row.getCell(columns.get('박스번호')!)).trim()
    const quantityText = cellText(row.getCell(columns.get('박스 적재수량')!)).trim()
    const palletNo = nullableText(row.getCell(columns.get('파렛트번호')!))
    const dimensionValues = ['가로(cm)', '세로(cm)', '높이(cm)']
      .map((header) => cellText(row.getCell(columns.get(header)!)).trim())
    if (ignoreBlankBoxPlaceholders && !boxNo && !quantityText && !palletNo && dimensionValues.every((value) => !value)) {
      continue
    }
    const quantity = positiveInteger(quantityText)
    const dimensions = parseDimensions(row, columns, sheet.name, rowNumber, errors)
    const valid = validateText(warehouseCode, '출고창고', 100, sheet.name, rowNumber, errors, true)
      && validateText(sku, '품목코드', 100, sheet.name, rowNumber, errors, true)
      && validateText(optionName, '옵션명', 200, sheet.name, rowNumber, errors)
      && validateText(boxNo, '박스번호', 100, sheet.name, rowNumber, errors, true)
      && validateText(palletNo, '파렛트번호', 100, sheet.name, rowNumber, errors)
    if (quantity == null) errors.push({ sheet: sheet.name, row: rowNumber, message: '박스 적재수량은 1 이상의 정수여야 합니다.' })
    if (valid && quantity != null && dimensions !== 'invalid') {
      allocations.push({
        rowNumber,
        warehouseCode,
        sku,
        optionName,
        boxNo,
        quantity,
        lengthCm: dimensions?.lengthCm ?? null,
        widthCm: dimensions?.widthCm ?? null,
        heightCm: dimensions?.heightCm ?? null,
        palletNo,
      })
    }
  }
  if (sheet.rowCount > lastRow) {
    errors.push({ sheet: sheet.name, row: lastRow + 1, message: `박스 쉽먼트는 ${MAX_BOX_ROWS.toLocaleString('ko-KR')}행 이하만 입력할 수 있습니다.` })
  }
  return allocations
}

function validateRelationships(
  items: ChinaOutboundRegistrationWorkbookItem[],
  allocations: ChinaOutboundRegistrationWorkbookBoxAllocation[],
  errors: ChinaOutboundRegistrationWorkbookError[],
  requireCompleteBoxAllocations: boolean,
) {
  const itemByIdentity = new Map<string, ChinaOutboundRegistrationWorkbookItem>()
  for (const item of items) {
    const key = sourceKey(item)
    const previous = itemByIdentity.get(key)
    if (previous) {
      errors.push({ sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items, row: item.rowNumber, message: `출고창고·품목코드·옵션명이 ${previous.rowNumber}행과 중복됩니다.` })
      continue
    }
    itemByIdentity.set(key, item)
  }

  const uniqueAllocations: ChinaOutboundRegistrationWorkbookBoxAllocation[] = []
  const allocationByItemAndBox = new Map<string, ChinaOutboundRegistrationWorkbookBoxAllocation>()
  const dimensionsByBox = new Map<string, Pick<ChinaOutboundRegistrationWorkbookBoxAllocation, 'lengthCm' | 'widthCm' | 'heightCm'>>()
  const palletByBox = new Map<string, string | null>()
  for (const allocation of allocations) {
    const identity = sourceKey(allocation)
    if (!itemByIdentity.has(identity)) {
      errors.push({ sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes, row: allocation.rowNumber, message: '출고창고·품목코드·옵션명이 출고상품 시트와 일치하지 않습니다.' })
      continue
    }
    const allocationKey = `${identity}\u0000${allocation.boxNo}`
    if (allocationByItemAndBox.has(allocationKey)) {
      errors.push({ sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes, row: allocation.rowNumber, message: '같은 출고상품을 같은 박스번호에 두 번 입력할 수 없습니다.' })
      continue
    }
    allocationByItemAndBox.set(allocationKey, allocation)
    uniqueAllocations.push(allocation)

    if (hasDimensions(allocation)) {
      const previousDimensions = dimensionsByBox.get(allocation.boxNo)
      if (previousDimensions && !sameDimensions(previousDimensions, allocation)) {
        errors.push({ sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes, row: allocation.rowNumber, message: `${allocation.boxNo}에 서로 다른 박스 규격이 입력되었습니다.` })
      } else if (!previousDimensions) {
        dimensionsByBox.set(allocation.boxNo, allocation)
      }
    }
    if (allocation.palletNo) {
      const previousPallet = palletByBox.get(allocation.boxNo)
      if (previousPallet && previousPallet !== allocation.palletNo) {
        errors.push({ sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes, row: allocation.rowNumber, message: `${allocation.boxNo}에 서로 다른 파렛트번호가 입력되었습니다.` })
      } else if (!previousPallet) {
        palletByBox.set(allocation.boxNo, allocation.palletNo)
      }
    } else if (!palletByBox.has(allocation.boxNo)) {
      palletByBox.set(allocation.boxNo, null)
    }
  }

  if (requireCompleteBoxAllocations && uniqueAllocations.length > 0) {
    for (const item of itemByIdentity.values()) {
      const packedQuantity = uniqueAllocations
        .filter((allocation) => sourceKey(allocation) === sourceKey(item))
        .reduce((total, allocation) => total + allocation.quantity, 0)
      if (packedQuantity !== item.quantity) {
        errors.push({
          sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items,
          row: item.rowNumber,
          message: `박스 쉽먼트 적재수량 합계 ${packedQuantity.toLocaleString('ko-KR')}개가 출고수량 ${item.quantity.toLocaleString('ko-KR')}개와 같아야 합니다.`,
        })
      }
    }
  }

  return uniqueAllocations.map((allocation) => {
    const dimensions = dimensionsByBox.get(allocation.boxNo)
    return {
      ...allocation,
      lengthCm: dimensions?.lengthCm ?? null,
      widthCm: dimensions?.widthCm ?? null,
      heightCm: dimensions?.heightCm ?? null,
      palletNo: palletByBox.get(allocation.boxNo) ?? null,
    }
  })
}

function parseDimensions(
  row: ExcelJS.Row,
  columns: Map<string, number>,
  sheet: string,
  rowNumber: number,
  errors: ChinaOutboundRegistrationWorkbookError[],
) {
  const values = ['가로(cm)', '세로(cm)', '높이(cm)'].map((header) => cellText(row.getCell(columns.get(header)!)).trim())
  const filledCount = values.filter(Boolean).length
  if (filledCount === 0) return null
  if (filledCount !== values.length) {
    errors.push({ sheet, row: rowNumber, message: '가로·세로·높이는 모두 입력하거나 모두 비워주세요.' })
    return 'invalid' as const
  }
  const numbers = values.map(positiveDecimal)
  if (numbers.some((value) => value == null)) {
    errors.push({ sheet, row: rowNumber, message: '가로·세로·높이는 0보다 큰 숫자로 입력해주세요.' })
    return 'invalid' as const
  }
  return { lengthCm: numbers[0]!, widthCm: numbers[1]!, heightCm: numbers[2]! }
}

function headerColumns(sheet: ExcelJS.Worksheet, expected: readonly string[], errors: ChinaOutboundRegistrationWorkbookError[]) {
  const columns = new Map<string, number>()
  sheet.getRow(1).eachCell((cell, column) => {
    const text = CHINA_OUTBOUND_REGISTRATION_HEADER_ALIASES.get(cellText(cell).trim()) ?? cellText(cell).trim()
    if (text && !columns.has(text)) columns.set(text, column)
  })
  const missing = expected.filter((header) => !columns.has(header))
  if (missing.length > 0) {
    errors.push({ sheet: sheet.name, row: 1, message: `필수 열이 없습니다: ${missing.join(', ')}` })
    return null
  }
  return columns
}

function createHeaderAliases(headerSets: ReadonlyArray<readonly [readonly string[], readonly string[]]>) {
  const aliases = new Map<string, string>()
  for (const [canonicalHeaders, displayHeaders] of headerSets) {
    canonicalHeaders.forEach((header, index) => {
      aliases.set(header, header)
      const displayHeader = displayHeaders[index]
      if (displayHeader) aliases.set(displayHeader, header)
    })
  }
  return aliases
}

function validateText(
  value: string | null,
  label: string,
  maximum: number,
  sheet: string,
  row: number,
  errors: ChinaOutboundRegistrationWorkbookError[],
  required = false,
) {
  if (!value) {
    if (required) errors.push({ sheet, row, message: `${label}을(를) 입력해주세요.` })
    return !required
  }
  if (value.length > maximum) {
    errors.push({ sheet, row, message: `${label}은(는) ${maximum.toLocaleString('ko-KR')}자 이하로 입력해주세요.` })
    return false
  }
  return true
}

function parseDate(cell: ExcelJS.Cell, sheet: string, row: number, errors: ChinaOutboundRegistrationWorkbookError[]) {
  const value = cell.value
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : cellText(cell).trim()
  if (!raw) return null
  const normalized = raw.replaceAll('.', '-').replaceAll('/', '-').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    errors.push({ sheet, row, message: '출고예정일은 YYYY-MM-DD 형식으로 입력해주세요.' })
    return null
  }
  const [year, month, day] = normalized.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) {
    errors.push({ sheet, row, message: '출고예정일을 확인해주세요.' })
    return null
  }
  return normalized
}

function sourceKey(value: Pick<ChinaOutboundRegistrationWorkbookItem, 'warehouseCode' | 'sku' | 'optionName'>) {
  return `${value.warehouseCode}\u0000${value.sku}\u0000${value.optionName ?? ''}`
}

function hasDimensions(value: Pick<ChinaOutboundRegistrationWorkbookBoxAllocation, 'lengthCm' | 'widthCm' | 'heightCm'>) {
  return value.lengthCm != null && value.widthCm != null && value.heightCm != null
}

function sameDimensions(
  left: Pick<ChinaOutboundRegistrationWorkbookBoxAllocation, 'lengthCm' | 'widthCm' | 'heightCm'>,
  right: Pick<ChinaOutboundRegistrationWorkbookBoxAllocation, 'lengthCm' | 'widthCm' | 'heightCm'>,
) {
  return left.lengthCm === right.lengthCm && left.widthCm === right.widthCm && left.heightCm === right.heightCm
}

function nullableText(cell: ExcelJS.Cell) {
  const value = cellText(cell).trim()
  return value || null
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value
  if (value == null) return ''
  if (typeof value === 'object') {
    if ('result' in value && value.result != null) return cellText({ value: value.result } as ExcelJS.Cell)
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
    if (value instanceof Date) return value.toISOString().slice(0, 10)
  }
  return String(value)
}

function isEmptyRow(row: ExcelJS.Row) {
  const values = Array.isArray(row.values) ? row.values.slice(1) : Object.values(row.values)
  return !values.some((value) => cellText({ value } as ExcelJS.Cell).trim())
}

function positiveInteger(value: string) {
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function positiveDecimal(value: string) {
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 9_999_999.99
    ? Math.round(parsed * 100) / 100
    : null
}
