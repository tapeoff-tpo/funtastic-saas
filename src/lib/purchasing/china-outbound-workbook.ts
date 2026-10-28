import ExcelJS from 'exceljs'
import { dimensionNumber } from './china-outbound-dimensions'
import {
  CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS,
  exportChinaOutboundRegistrationTemplateWorkbook,
  parseChinaOutboundRegistrationWorkbook,
  type ChinaOutboundRegistrationCurrentInventoryRow,
} from './china-outbound-registration-workbook'

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

export type ChinaOutboundWorkWorkbookExportOptions = {
  warehouseCodes?: readonly string[]
  currentInventory?: readonly ChinaOutboundRegistrationCurrentInventoryRow[]
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

/**
 * A work workbook deliberately reuses the registration workbook layout. The
 * selection is prefilled from an existing shipment; only its box/pallet work
 * may be applied again on upload.
 */
export async function exportChinaOutboundWorkWorkbook(
  detail: ChinaOutboundWorkbookDetail,
  options: ChinaOutboundWorkWorkbookExportOptions = {},
): Promise<Buffer> {
  const boxById = new Map(detail.boxes.map((box) => [box.id, box]))
  const palletById = new Map(detail.pallets.map((pallet) => [pallet.id, pallet]))
  const allocationsByItem = new Map(detail.items.map((item) => [
    item.id,
    detail.boxItems.filter((allocation) => allocation.shipmentItemId === item.id),
  ]))
  const sortedItems = [...detail.items].sort(compareShipmentItems)
  const prefilledBoxAllocations = sortedItems.flatMap((item) => (allocationsByItem.get(item.id) ?? []).flatMap((allocation) => {
    const box = boxById.get(allocation.boxId)
    if (!box) return []
    const pallet = box.palletId ? palletById.get(box.palletId) : null
    return [{
      warehouseCode: item.warehouseCode,
      sku: item.sku,
      optionName: item.optionName,
      boxNo: box.boxNo,
      quantity: allocation.quantity,
      lengthCm: dimensionNumber(box.lengthCm),
      widthCm: dimensionNumber(box.widthCm),
      heightCm: dimensionNumber(box.heightCm),
      palletNo: pallet?.palletNo ?? null,
    }]
  }))
  // A shipment preserves its warehouse snapshot. Keep an old selected name
  // available in the dropdown even when the editable warehouse catalog was
  // later renamed or cleaned up.
  const warehouseCodes = [
    ...(options.warehouseCodes ?? []),
    ...sortedItems.map((item) => item.warehouseCode),
  ]
  const uniqueWarehouseCodes = [...new Set(sortedItems.map((item) => item.warehouseCode))]

  return exportChinaOutboundRegistrationTemplateWorkbook({
    importKey: detail.shipment.shipmentNo,
    defaultWarehouseCode: uniqueWarehouseCodes.length === 1 ? uniqueWarehouseCodes[0] : null,
    warehouseCodes,
    currentInventory: options.currentInventory ?? [],
    prefilledShipment: {
      displayName: detail.shipment.displayName,
      destinationName: detail.shipment.destinationName,
      plannedOutboundDate: detail.shipment.plannedOutboundDate,
    },
    prefilledItems: sortedItems.map((item) => ({
      warehouseCode: item.warehouseCode,
      sku: item.sku,
      optionName: item.optionName,
      quantity: item.reservedQuantity,
    })),
    prefilledBoxAllocations,
    includeBlankBoxPlaceholders: true,
  })
}

export async function parseChinaOutboundWorkWorkbook(input: {
  fileBuffer: ArrayBuffer
  detail: ChinaOutboundWorkbookDetail
}): Promise<ChinaOutboundWorkbookPreview> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(input.fileBuffer as ExcelJS.Buffer)
  if (workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)) {
    return parseChinaOutboundRegistrationWorkWorkbook(input)
  }

  return parseLegacyChinaOutboundWorkWorkbook(input, workbook)
}

async function parseChinaOutboundRegistrationWorkWorkbook(input: {
  fileBuffer: ArrayBuffer
  detail: ChinaOutboundWorkbookDetail
}): Promise<ChinaOutboundWorkbookPreview> {
  const registration = await parseChinaOutboundRegistrationWorkbook(input.fileBuffer, {
    requireCompleteBoxAllocations: false,
    ignoreBlankBoxPlaceholders: true,
    requireDestination: false,
    validateDestination: false,
  })
  const errors: ChinaOutboundWorkbookPreview['errors'] = registration.errors.map((error) => ({
    sheet: error.sheet,
    row: error.row ?? 0,
    message: error.message,
  }))
  const sourceItems = new Map<string, ChinaOutboundWorkbookDetail['items'][number]>()
  for (const item of input.detail.items) {
    const key = registrationItemSourceKey(item)
    if (sourceItems.has(key)) {
      errors.push({
        sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items,
        row: 0,
        message: `${item.sku}의 출고창고·품목코드·옵션 정보가 현재 출고상품에서 중복됩니다.`,
      })
      continue
    }
    sourceItems.set(key, item)
  }

  if (registration.importKey !== input.detail.shipment.shipmentNo) {
    errors.push({
      sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment,
      row: 2,
      message: '엑셀등록번호가 현재 중국출고 번호와 일치하지 않습니다.',
    })
  }

  const selectedItemIds = new Set<string>()
  for (const item of registration.items) {
    const shipmentItem = sourceItems.get(registrationItemSourceKey(item))
    if (!shipmentItem) {
      errors.push({
        sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items,
        row: item.rowNumber,
        message: '출고창고·품목코드·옵션명이 현재 중국출고의 선택 상품과 일치하지 않습니다.',
      })
      continue
    }
    if (shipmentItem.reservedQuantity !== item.quantity) {
      errors.push({
        sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items,
        row: item.rowNumber,
        message: `${item.sku}의 출고수량은 현재 선택된 ${shipmentItem.reservedQuantity.toLocaleString('ko-KR')}개와 같아야 합니다.`,
      })
      continue
    }
    if (selectedItemIds.has(shipmentItem.id)) {
      errors.push({
        sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items,
        row: item.rowNumber,
        message: '같은 출고상품을 두 번 입력할 수 없습니다.',
      })
      continue
    }
    selectedItemIds.add(shipmentItem.id)
  }
  for (const item of input.detail.items) {
    if (!selectedItemIds.has(item.id)) {
      errors.push({
        sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items,
        row: 0,
        message: `${item.sku} 출고상품이 누락되었습니다. 선택 상품·출고수량은 수정할 수 없습니다.`,
      })
    }
  }

  const allocationsByItemId = new Map<string, ChinaOutboundWorkbookBoxSplit['allocations']>()
  const palletAssignmentsByBoxNo = new Map<string, string | null>()
  const knownBoxNos = new Set(input.detail.boxes.map((box) => box.boxNo))
  for (const allocation of registration.boxAllocations) {
    const shipmentItem = sourceItems.get(registrationItemSourceKey(allocation))
    if (!shipmentItem) {
      errors.push({
        sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes,
        row: allocation.rowNumber,
        message: '박스 쉽먼트의 출고창고·품목코드·옵션명이 현재 출고상품과 일치하지 않습니다.',
      })
      continue
    }
    knownBoxNos.add(allocation.boxNo)
    allocationsByItemId.set(shipmentItem.id, [
      ...(allocationsByItemId.get(shipmentItem.id) ?? []),
      {
        boxNo: allocation.boxNo,
        quantity: allocation.quantity,
        lengthCm: allocation.lengthCm,
        widthCm: allocation.widthCm,
        heightCm: allocation.heightCm,
      },
    ])
    const previousPalletNo = palletAssignmentsByBoxNo.get(allocation.boxNo)
    if (previousPalletNo !== undefined && previousPalletNo !== allocation.palletNo) {
      errors.push({
        sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes,
        row: allocation.rowNumber,
        message: `${allocation.boxNo}에 서로 다른 파렛트번호가 입력되었습니다.`,
      })
      continue
    }
    palletAssignmentsByBoxNo.set(allocation.boxNo, allocation.palletNo)
  }

  // Include every original shipment item, even when not yet packed. This
  // preserves the work workbook's snapshot behavior: clearing a box row
  // intentionally clears that item's box allocation on apply.
  const boxSplits = input.detail.items.map((item) => {
    const allocations = allocationsByItemId.get(item.id) ?? []
    const totalQuantity = allocations.reduce((total, allocation) => total + allocation.quantity, 0)
    if (totalQuantity > item.reservedQuantity) {
      errors.push({
        sheet: CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes,
        row: 0,
        message: `${item.sku}의 박스 분할수량 ${totalQuantity.toLocaleString('ko-KR')}개가 출고수량 ${item.reservedQuantity.toLocaleString('ko-KR')}개를 넘습니다.`,
      })
    }
    return { shipmentItemId: item.id, allocations }
  })

  return {
    boxSplits,
    palletAssignments: [...palletAssignmentsByBoxNo.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'ko-KR', { numeric: true }))
      .map(([boxNo, palletNo]) => ({ boxNo, palletNo })),
    summary: {
      boxSplitItemCount: boxSplits.length,
      boxSplitRowCount: boxSplits.reduce((total, split) => total + split.allocations.length, 0),
      palletAssignmentCount: palletAssignmentsByBoxNo.size,
      boxCount: knownBoxNos.size,
    },
    errors,
  }
}

async function parseLegacyChinaOutboundWorkWorkbook(
  input: { fileBuffer: ArrayBuffer; detail: ChinaOutboundWorkbookDetail },
  workbook: ExcelJS.Workbook,
): Promise<ChinaOutboundWorkbookPreview> {
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

function registrationItemSourceKey(value: { warehouseCode: string; sku: string; optionName: string | null }) {
  return `${value.warehouseCode}\u0000${value.sku}\u0000${value.optionName ?? ''}`
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
  const values = Array.isArray(row.values) ? row.values.slice(1) : Object.values(row.values)
  return !values.some((value) => cellText({ value } as ExcelJS.Cell).trim())
}

function positiveInteger(value: string) {
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function positiveDecimal(value: string) {
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 9_999_999.99 ? Math.round(parsed * 100) / 100 : null
}
