import ExcelJS from 'exceljs'
import {
  calculateChinaOutboundBoxCbm,
  dimensionNumber,
} from './china-outbound-dimensions'

export const CHINA_OUTBOUND_WORKBOOK_SHEETS = {
  guide: '작업안내',
  items: '출고상품',
  boxSplits: '박스분할',
  palletLoads: '파렛트적재',
} as const

export type ChinaOutboundWorkbookDetail = {
  shipment: {
    shipmentNo: string
    displayName?: string | null
    status: string
    destinationName: string | null
    plannedOutboundDate: string | null
  }
  items: Array<{
    id: string
    warehouseCode: string
    sku: string
    productName: string
    optionName: string | null
    reservedQuantity: number
    packedQuantity: number
  }>
  pallets: Array<{ id: string; palletNo: string }>
  boxes: Array<{
    id: string
    palletId: string | null
    boxNo: string
    lengthCm?: number | string | null
    widthCm?: number | string | null
    heightCm?: number | string | null
  }>
  boxItems: Array<{
    id: string
    boxId: string
    shipmentItemId: string
    quantity: number
  }>
}

export type ChinaOutboundWorkbookBoxSplit = {
  shipmentItemId: string
  allocations: Array<{
    boxNo: string
    quantity: number
    lengthCm?: number | null
    widthCm?: number | null
    heightCm?: number | null
  }>
}

export type ChinaOutboundWorkbookPalletAssignment = {
  boxNo: string
  palletNo: string | null
}

export type ChinaOutboundWorkbookPreview = {
  boxSplits: ChinaOutboundWorkbookBoxSplit[]
  palletAssignments: ChinaOutboundWorkbookPalletAssignment[]
  summary: {
    boxSplitItemCount: number
    boxSplitRowCount: number
    palletAssignmentCount: number
    boxCount: number
  }
  errors: Array<{ sheet: string; row: number; message: string }>
}

const BOX_SPLIT_HEADERS = [
  '출고상품ID',
  '품목코드',
  '상품명',
  '옵션명',
  '출고창고',
  '출고수량',
  '박스번호',
  '박스 적재수량',
  '가로(cm)',
  '세로(cm)',
  '높이(cm)',
  'CBM',
  '진행상태',
] as const

const PALLET_LOAD_HEADERS = [
  '박스번호',
  '파렛트번호',
  '박스 적재수량',
  '가로(cm)',
  '세로(cm)',
  '높이(cm)',
  'CBM',
  '적재상품',
] as const

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

export async function exportChinaOutboundWorkWorkbook(detail: ChinaOutboundWorkbookDetail): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()

  const itemById = new Map(detail.items.map((item) => [item.id, item]))
  const boxById = new Map(detail.boxes.map((box) => [box.id, box]))
  const palletById = new Map(detail.pallets.map((pallet) => [pallet.id, pallet]))
  const allocationsByItem = new Map(detail.items.map((item) => [
    item.id,
    detail.boxItems.filter((allocation) => allocation.shipmentItemId === item.id),
  ]))
  const allocationsByBox = new Map(detail.boxes.map((box) => [
    box.id,
    detail.boxItems.filter((allocation) => allocation.boxId === box.id),
  ]))

  addGuideSheet(workbook, detail)
  addItemsSheet(workbook, detail)

  const boxSheet = createSheet(workbook, CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits, BOX_SPLIT_HEADERS, [38, 18, 34, 20, 16, 14, 16, 18, 12, 12, 12, 14, 12])
  const sortedItems = [...detail.items].sort(compareShipmentItems)
  for (const item of sortedItems) {
    const allocations = allocationsByItem.get(item.id) ?? []
    for (const allocation of allocations) {
      const box = boxById.get(allocation.boxId)
      addBoxSplitRow(boxSheet, item, box, allocation.quantity)
    }
    // A blank continuation line means an operator can add another box without
    // having to copy identifiers from a different row.
    addBoxSplitRow(boxSheet, item, undefined, undefined)
  }

  const palletSheet = createSheet(workbook, CHINA_OUTBOUND_WORKBOOK_SHEETS.palletLoads, PALLET_LOAD_HEADERS, [16, 16, 18, 12, 12, 12, 14, 52])
  const boxesWithItems = detail.boxes.filter((box) => (allocationsByBox.get(box.id)?.length ?? 0) > 0)
    .sort((left, right) => left.boxNo.localeCompare(right.boxNo, 'ko-KR', { numeric: true }))
  for (const box of boxesWithItems) {
    const allocations = allocationsByBox.get(box.id) ?? []
    const packedQuantity = allocations.reduce((total, allocation) => total + allocation.quantity, 0)
    const products = allocations.map((allocation) => {
      const item = itemById.get(allocation.shipmentItemId)
      return item ? `${item.sku} ${item.productName}${item.optionName ? ` · ${item.optionName}` : ''} (${allocation.quantity.toLocaleString('ko-KR')}개)` : ''
    }).filter(Boolean).join('\n')
    const pallet = box.palletId ? palletById.get(box.palletId) : null
    const cbm = calculateChinaOutboundBoxCbm(box)
    addDataRow(palletSheet, [
      box.boxNo,
      pallet?.palletNo ?? '',
      packedQuantity,
      dimensionNumber(box.lengthCm) ?? '',
      dimensionNumber(box.widthCm) ?? '',
      dimensionNumber(box.heightCm) ?? '',
      cbm ?? '',
      products,
    ], new Set([2]))
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function parseChinaOutboundWorkWorkbook(input: {
  fileBuffer: ArrayBuffer
  detail: ChinaOutboundWorkbookDetail
}): Promise<ChinaOutboundWorkbookPreview> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(input.fileBuffer as ExcelJS.Buffer)
  const errors: ChinaOutboundWorkbookPreview['errors'] = []
  const boxSplitSheet = workbook.getWorksheet(CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits)
  const palletSheet = workbook.getWorksheet(CHINA_OUTBOUND_WORKBOOK_SHEETS.palletLoads)

  if (!boxSplitSheet) {
    errors.push({ sheet: CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits, row: 0, message: '박스분할 시트를 찾을 수 없습니다.' })
  }
  if (!palletSheet) {
    errors.push({ sheet: CHINA_OUTBOUND_WORKBOOK_SHEETS.palletLoads, row: 0, message: '파렛트적재 시트를 찾을 수 없습니다.' })
  }

  const itemsById = new Map(input.detail.items.map((item) => [item.id, item]))
  const itemsBySource = new Map<string, typeof input.detail.items>()
  for (const item of input.detail.items) {
    const key = shipmentItemSourceKey(item)
    itemsBySource.set(key, [...(itemsBySource.get(key) ?? []), item])
  }

  const rawAllocationsByItemId = new Map<string, ChinaOutboundWorkbookBoxSplit['allocations']>()
  const seenItemIds = new Set<string>()
  if (boxSplitSheet) {
    const columns = headerColumns(boxSplitSheet, BOX_SPLIT_HEADERS, errors)
    if (columns) {
      for (let rowNumber = 2; rowNumber <= boxSplitSheet.rowCount; rowNumber += 1) {
        const row = boxSplitSheet.getRow(rowNumber)
        if (isEmptyRow(row)) continue
        const item = resolveShipmentItem(row, columns, itemsById, itemsBySource, errors, CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits, rowNumber)
        if (!item) continue
        seenItemIds.add(item.id)

        const boxNo = cellText(row.getCell(columns.get('박스번호')!)).trim()
        const quantityText = cellText(row.getCell(columns.get('박스 적재수량')!)).trim()
        if (!boxNo && !quantityText) continue
        if (!boxNo || !quantityText) {
          errors.push({ sheet: CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits, row: rowNumber, message: '박스번호와 박스 적재수량은 함께 입력해주세요.' })
          continue
        }
        const quantity = positiveInteger(quantityText)
        if (quantity == null) {
          errors.push({ sheet: CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits, row: rowNumber, message: '박스 적재수량은 1 이상의 정수여야 합니다.' })
          continue
        }
        const dimensions = parseDimensions(row, columns, errors, CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits, rowNumber)
        if (dimensions === 'invalid') continue
        rawAllocationsByItemId.set(item.id, [
          ...(rawAllocationsByItemId.get(item.id) ?? []),
          { boxNo, quantity, ...(dimensions ?? {}) },
        ])
      }
    }
  }

  const boxSplits: ChinaOutboundWorkbookBoxSplit[] = []
  const knownBoxNos = new Set(input.detail.boxes.map((box) => box.boxNo))
  for (const itemId of seenItemIds) {
    const item = itemsById.get(itemId)
    if (!item) continue
    const allocations = mergeBoxAllocations(rawAllocationsByItemId.get(itemId) ?? [], errors, item.sku)
    const totalQuantity = allocations.reduce((total, allocation) => total + allocation.quantity, 0)
    if (totalQuantity > item.reservedQuantity) {
      errors.push({ sheet: CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits, row: 0, message: `${item.sku}의 박스 분할수량 ${totalQuantity.toLocaleString('ko-KR')}개가 출고수량 ${item.reservedQuantity.toLocaleString('ko-KR')}개를 넘습니다.` })
    }
    allocations.forEach((allocation) => knownBoxNos.add(allocation.boxNo))
    boxSplits.push({ shipmentItemId: itemId, allocations })
  }

  const palletAssignments = new Map<string, string | null>()
  if (palletSheet) {
    const columns = headerColumns(palletSheet, PALLET_LOAD_HEADERS, errors)
    if (columns) {
      for (let rowNumber = 2; rowNumber <= palletSheet.rowCount; rowNumber += 1) {
        const row = palletSheet.getRow(rowNumber)
        if (isEmptyRow(row)) continue
        const boxNo = cellText(row.getCell(columns.get('박스번호')!)).trim()
        if (!boxNo) continue
        if (!knownBoxNos.has(boxNo)) {
          errors.push({ sheet: CHINA_OUTBOUND_WORKBOOK_SHEETS.palletLoads, row: rowNumber, message: `${boxNo}을(를) 박스분할 시트에서 찾을 수 없습니다.` })
          continue
        }
        const palletNo = cellText(row.getCell(columns.get('파렛트번호')!)).trim() || null
        const current = palletAssignments.get(boxNo)
        if (current !== undefined && current !== palletNo) {
          errors.push({ sheet: CHINA_OUTBOUND_WORKBOOK_SHEETS.palletLoads, row: rowNumber, message: `${boxNo}에 서로 다른 파렛트 번호가 입력되었습니다.` })
          continue
        }
        palletAssignments.set(boxNo, palletNo)
      }
    }
  }

  return {
    boxSplits,
    palletAssignments: [...palletAssignments.entries()].map(([boxNo, palletNo]) => ({ boxNo, palletNo })),
    summary: {
      boxSplitItemCount: boxSplits.length,
      boxSplitRowCount: boxSplits.reduce((total, split) => total + split.allocations.length, 0),
      palletAssignmentCount: palletAssignments.size,
      boxCount: knownBoxNos.size,
    },
    errors,
  }
}

export function chinaOutboundWorkFilename(shipmentNo: string, now = new Date()) {
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('')
  const safeShipmentNo = shipmentNo.replace(/[\\/:*?"<>|]/g, '_').trim() || '중국출고'
  return `${safeShipmentNo}_박스파렛트작업_${date}.xlsx`
}

function addGuideSheet(workbook: ExcelJS.Workbook, detail: ChinaOutboundWorkbookDetail) {
  const sheet = workbook.addWorksheet(CHINA_OUTBOUND_WORKBOOK_SHEETS.guide)
  sheet.columns = [{ width: 24 }, { width: 74 }]
  sheet.mergeCells('A1:B1')
  sheet.getCell('A1').value = '중국출고 박스·파렛트 작업용 엑셀'
  sheet.getCell('A1').font = { bold: true, size: 14 }
  sheet.getRow(1).height = 26
  const rows: Array<[string, string]> = [
    ['출고번호', detail.shipment.shipmentNo],
    ['출고작업명', detail.shipment.displayName ?? ''],
    ['도착지', detail.shipment.destinationName ?? ''],
    ['출고예정일', detail.shipment.plannedOutboundDate ?? ''],
    ['작업 순서', '1. 박스분할 시트에서 상품별 박스번호·수량·규격을 입력합니다.'],
    ['작업 순서', '2. 박스분할 업로드 후 다시 다운로드하여 파렛트적재 시트에 파렛트번호를 입력합니다.'],
    ['주의', '박스번호와 파렛트번호는 직접 입력합니다. 빈 규격은 기존 규격을 유지합니다.'],
    ['주의', '출고상품ID·품목코드·출고수량은 수정하지 마세요.'],
  ]
  for (const [label, value] of rows) {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true, size: 10 }
    row.getCell(1).fill = HEADER_FILL
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = THIN_BORDER
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
  }
}

function addItemsSheet(workbook: ExcelJS.Workbook, detail: ChinaOutboundWorkbookDetail) {
  const headers = ['출고상품ID', '품목코드', '상품명', '옵션명', '출고창고', '출고수량', '박스분할수량', '진행상태']
  const sheet = createSheet(workbook, CHINA_OUTBOUND_WORKBOOK_SHEETS.items, headers, [38, 18, 34, 20, 16, 14, 16, 12])
  for (const item of [...detail.items].sort(compareShipmentItems)) {
    addDataRow(sheet, [
      item.id,
      item.sku,
      item.productName,
      item.optionName ?? '',
      item.warehouseCode,
      item.reservedQuantity,
      item.packedQuantity,
      item.packedQuantity === item.reservedQuantity ? '완료' : '진행',
    ])
  }
}

function addBoxSplitRow(
  sheet: ExcelJS.Worksheet,
  item: ChinaOutboundWorkbookDetail['items'][number],
  box: ChinaOutboundWorkbookDetail['boxes'][number] | undefined,
  quantity: number | undefined,
) {
  const cbm = box ? calculateChinaOutboundBoxCbm(box) : null
  addDataRow(sheet, [
    item.id,
    item.sku,
    item.productName,
    item.optionName ?? '',
    item.warehouseCode,
    item.reservedQuantity,
    box?.boxNo ?? '',
    quantity ?? '',
    box ? dimensionNumber(box.lengthCm) ?? '' : '',
    box ? dimensionNumber(box.widthCm) ?? '' : '',
    box ? dimensionNumber(box.heightCm) ?? '' : '',
    cbm ?? '',
    item.packedQuantity === item.reservedQuantity ? '완료' : '진행',
  ], new Set([7, 8, 9, 10, 11]))
}

function createSheet(workbook: ExcelJS.Workbook, name: string, headers: readonly string[], widths: number[]) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = widths.map((width) => ({ width }))
  const row = sheet.addRow([...headers])
  row.height = 28
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: headers.length } }
  return sheet
}

function addDataRow(sheet: ExcelJS.Worksheet, values: Array<string | number>, editableColumns = new Set<number>()) {
  const row = sheet.addRow(values)
  row.height = 20
  row.eachCell({ includeEmpty: true }, (cell, index) => {
    cell.border = THIN_BORDER
    cell.alignment = { vertical: 'middle', wrapText: index === 3 || index === 8 }
    if (editableColumns.has(index)) cell.fill = INPUT_FILL
    if (typeof cell.value === 'number') cell.numFmt = index === 12 || index === 7 ? '#,##0.0000' : '#,##0'
  })
}

function headerColumns(sheet: ExcelJS.Worksheet, expected: readonly string[], errors: ChinaOutboundWorkbookPreview['errors']) {
  const header = sheet.getRow(1)
  const columns = new Map<string, number>()
  header.eachCell((cell, column) => {
    const text = cellText(cell).trim()
    if (text && !columns.has(text)) columns.set(text, column)
  })
  const missing = expected.filter((value) => !columns.has(value))
  if (missing.length > 0) {
    errors.push({ sheet: sheet.name, row: 1, message: `필수 열이 없습니다: ${missing.join(', ')}` })
    return null
  }
  return columns
}

function resolveShipmentItem(
  row: ExcelJS.Row,
  columns: Map<string, number>,
  itemsById: Map<string, ChinaOutboundWorkbookDetail['items'][number]>,
  itemsBySource: Map<string, ChinaOutboundWorkbookDetail['items']>,
  errors: ChinaOutboundWorkbookPreview['errors'],
  sheet: string,
  rowNumber: number,
) {
  const id = cellText(row.getCell(columns.get('출고상품ID')!)).trim()
  const sku = cellText(row.getCell(columns.get('품목코드')!)).trim()
  const warehouseCode = cellText(row.getCell(columns.get('출고창고')!)).trim()
  const optionName = cellText(row.getCell(columns.get('옵션명')!)).trim()
  const item = id ? itemsById.get(id) : resolveItemBySource(itemsBySource, sku, warehouseCode, optionName)
  if (!item) {
    errors.push({ sheet, row: rowNumber, message: '출고상품ID 또는 품목코드·출고창고·옵션 정보가 현재 출고상품과 일치하지 않습니다.' })
    return null
  }
  if (sku && item.sku !== sku) {
    errors.push({ sheet, row: rowNumber, message: '출고상품ID와 품목코드가 서로 일치하지 않습니다.' })
    return null
  }
  return item
}

function resolveItemBySource(
  itemsBySource: Map<string, ChinaOutboundWorkbookDetail['items']>,
  sku: string,
  warehouseCode: string,
  optionName: string,
) {
  const matches = itemsBySource.get(`${sku}\u0000${warehouseCode}\u0000${optionName}`) ?? []
  return matches.length === 1 ? matches[0] : null
}

function shipmentItemSourceKey(item: ChinaOutboundWorkbookDetail['items'][number]) {
  return `${item.sku}\u0000${item.warehouseCode}\u0000${item.optionName ?? ''}`
}

function parseDimensions(
  row: ExcelJS.Row,
  columns: Map<string, number>,
  errors: ChinaOutboundWorkbookPreview['errors'],
  sheet: string,
  rowNumber: number,
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

function mergeBoxAllocations(
  allocations: ChinaOutboundWorkbookBoxSplit['allocations'],
  errors: ChinaOutboundWorkbookPreview['errors'],
  sku: string,
) {
  const byBoxNo = new Map<string, ChinaOutboundWorkbookBoxSplit['allocations'][number]>()
  for (const allocation of allocations) {
    const current = byBoxNo.get(allocation.boxNo)
    if (!current) {
      byBoxNo.set(allocation.boxNo, allocation)
      continue
    }
    if (hasDimensions(current) && hasDimensions(allocation) && !sameDimensions(current, allocation)) {
      errors.push({ sheet: CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits, row: 0, message: `${sku}의 ${allocation.boxNo} 규격이 서로 다릅니다.` })
    }
    byBoxNo.set(allocation.boxNo, {
      ...current,
      quantity: current.quantity + allocation.quantity,
      ...(hasDimensions(current) ? {} : {
        lengthCm: allocation.lengthCm,
        widthCm: allocation.widthCm,
        heightCm: allocation.heightCm,
      }),
    })
  }
  return [...byBoxNo.values()]
}

function hasDimensions(value: ChinaOutboundWorkbookBoxSplit['allocations'][number]) {
  return value.lengthCm != null && value.widthCm != null && value.heightCm != null
}

function sameDimensions(
  left: ChinaOutboundWorkbookBoxSplit['allocations'][number],
  right: ChinaOutboundWorkbookBoxSplit['allocations'][number],
) {
  return left.lengthCm === right.lengthCm && left.widthCm === right.widthCm && left.heightCm === right.heightCm
}

function compareShipmentItems(
  left: ChinaOutboundWorkbookDetail['items'][number],
  right: ChinaOutboundWorkbookDetail['items'][number],
) {
  return left.sku.localeCompare(right.sku, 'ko-KR', { numeric: true })
    || left.productName.localeCompare(right.productName, 'ko-KR')
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value
  if (value == null) return ''
  if (typeof value === 'object') {
    if ('result' in value && value.result != null) return cellText({ value: value.result } as ExcelJS.Cell)
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
    if (value instanceof Date) return value.toISOString()
  }
  return String(value)
}

function isEmptyRow(row: ExcelJS.Row) {
  return !row.values.slice(1).some((value) => cellText({ value } as ExcelJS.Cell).trim())
}

function positiveInteger(value: string) {
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function positiveDecimal(value: string) {
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 9_999_999.99 ? Math.round(parsed * 100) / 100 : null
}
