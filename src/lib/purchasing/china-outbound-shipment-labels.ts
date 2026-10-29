import ExcelJS from 'exceljs'
import type { ChinaOutboundPackingExportDetail } from './china-outbound-packing-export'

export const CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS = {
  boxes: '装箱标签',
  pallets: '托盘标签',
} as const

export type ChinaOutboundShipmentLabelDetail = Omit<ChinaOutboundPackingExportDetail, 'items'> & {
  items: Array<ChinaOutboundPackingExportDetail['items'][number] & { location?: string | null }>
}

export type ChinaOutboundShipmentLabelWorkbookOptions = {
  /** Restrict box label sheets to these saved box IDs. */
  boxIds?: readonly string[]
  /** Include pallet label sheets. Defaults to true for the bulk download. */
  includePalletLabels?: boolean
}

type LabelRow = Array<string | number>
type LabelProductRow = {
  sku: string
  productName: string
  optionName: string | null
  location: string
  quantity: number
}

const DARK_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E78' },
}

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9EAF7' },
}

const INPUT_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF2CC' },
}

const ALL_BORDERS: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF7F8C8D' } },
  bottom: { style: 'thin', color: { argb: 'FF7F8C8D' } },
  left: { style: 'thin', color: { argb: 'FF7F8C8D' } },
  right: { style: 'thin', color: { argb: 'FF7F8C8D' } },
}

const PRINT_MARGINS = {
  top: 0.35,
  bottom: 0.35,
  left: 0.3,
  right: 0.3,
  header: 0.15,
  footer: 0.15,
}

/**
 * Produces a separately printable workbook for labels that are attached to
 * physical boxes and pallets. Yellow cells deliberately remain editable in
 * Excel so Chinese names can be entered and item-master locations corrected.
 */
export function createChinaOutboundShipmentLabelWorkbook(
  detail: ChinaOutboundShipmentLabelDetail,
  options: ChinaOutboundShipmentLabelWorkbookOptions = {},
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()

  const itemById = new Map(detail.items.map((item) => [item.id, item]))
  const palletById = new Map(detail.pallets.map((pallet) => [pallet.id, pallet]))
  const boxItemsByBoxId = groupBoxItemsByBox(detail)
  const includePalletLabels = options.includePalletLabels !== false

  addBoxLabelSheets(workbook, detail, itemById, boxItemsByBoxId, options.boxIds)
  if (includePalletLabels) {
    addPalletLabelSheets(workbook, detail, itemById, palletById, boxItemsByBoxId)
  }

  return workbook
}

export async function exportChinaOutboundShipmentLabelWorkbook(
  detail: ChinaOutboundShipmentLabelDetail,
  options: ChinaOutboundShipmentLabelWorkbookOptions = {},
): Promise<Buffer> {
  const workbook = createChinaOutboundShipmentLabelWorkbook(detail, options)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export function chinaOutboundShipmentLabelFilename(shipmentNo: string, now = new Date()) {
  return `${safeFilenameSegment(shipmentNo, '중국출고')}_부착용쉽먼트_${labelFilenameDate(now)}.xlsx`
}

export function chinaOutboundShipmentBoxLabelFilename(shipmentNo: string, boxNo: string, now = new Date()) {
  return `${safeFilenameSegment(shipmentNo, '중국출고')}_${safeFilenameSegment(boxNo, '박스')}_부착용쉽먼트_${labelFilenameDate(now)}.xlsx`
}

function labelFilenameDate(now: Date) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  return date
}

function safeFilenameSegment(value: string, fallback: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || fallback
}

function addBoxLabelSheets(
  workbook: ExcelJS.Workbook,
  detail: ChinaOutboundShipmentLabelDetail,
  itemById: Map<string, ChinaOutboundShipmentLabelDetail['items'][number]>,
  boxItemsByBoxId: Map<string, ChinaOutboundShipmentLabelDetail['boxItems']>,
  scopedBoxIds?: readonly string[],
) {
  const scopedBoxIdSet = scopedBoxIds ? new Set(scopedBoxIds) : null
  const boxes = [...detail.boxes]
    .filter((box) => !scopedBoxIdSet || scopedBoxIdSet.has(box.id))
    .filter((box) => (boxItemsByBoxId.get(box.id)?.length ?? 0) > 0)
    .sort((left, right) => left.boxNo.localeCompare(right.boxNo, 'ko-KR', { numeric: true }))

  if (boxes.length === 0) {
    const sheet = workbook.addWorksheet(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.boxes)
    sheet.columns = [{ width: 17 }, { width: 36 }, { width: 28 }, { width: 11 }, { width: 20 }]
    configureLabelSheet(sheet, 'E')
    addEmptyLabelMessage(sheet, '暂无已装箱商品。', 'E')
    return
  }

  for (const [index, box] of boxes.entries()) {
    const sheet = workbook.addWorksheet(labelSheetName(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.boxes, index))
    sheet.columns = [{ width: 17 }, { width: 36 }, { width: 28 }, { width: 11 }, { width: 20 }]
    configureLabelSheet(sheet, 'E')
    const rows = aggregateBoxLabelRows(boxItemsByBoxId.get(box.id) ?? [], itemById, box.boxNo)
    addLabelBlock({
      sheet,
      lastColumn: 'E',
      title: `装箱标签 · ${box.boxNo}`,
      headers: ['箱号', '商品名称（韩文）', '商品名称（中文）', '数量', '库位'],
      rows,
      inputColumns: new Set([3, 5]),
      quantityColumns: new Set([4]),
    })
  }
}

function addPalletLabelSheets(
  workbook: ExcelJS.Workbook,
  detail: ChinaOutboundShipmentLabelDetail,
  itemById: Map<string, ChinaOutboundShipmentLabelDetail['items'][number]>,
  palletById: Map<string, ChinaOutboundShipmentLabelDetail['pallets'][number]>,
  boxItemsByBoxId: Map<string, ChinaOutboundShipmentLabelDetail['boxItems']>,
) {
  const boxesByPalletId = new Map<string, ChinaOutboundShipmentLabelDetail['boxes']>()
  for (const box of detail.boxes) {
    if (!box.palletId || !palletById.has(box.palletId)) continue
    if ((boxItemsByBoxId.get(box.id)?.length ?? 0) === 0) continue
    boxesByPalletId.set(box.palletId, [...(boxesByPalletId.get(box.palletId) ?? []), box])
  }

  const pallets = [...detail.pallets]
    .filter((pallet) => (boxesByPalletId.get(pallet.id)?.length ?? 0) > 0)
    .sort((left, right) => left.palletNo.localeCompare(right.palletNo, 'ko-KR', { numeric: true }))

  if (pallets.length === 0) {
    const sheet = workbook.addWorksheet(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.pallets)
    sheet.columns = [{ width: 14 }, { width: 14 }, { width: 20 }, { width: 34 }, { width: 28 }, { width: 24 }, { width: 12 }]
    configureLabelSheet(sheet, 'G')
    addEmptyLabelMessage(sheet, '暂无已分配到托盘的箱子。', 'G')
    return
  }

  for (const [index, pallet] of pallets.entries()) {
    const sheet = workbook.addWorksheet(labelSheetName(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.pallets, index))
    sheet.columns = [{ width: 14 }, { width: 14 }, { width: 20 }, { width: 34 }, { width: 28 }, { width: 24 }, { width: 12 }]
    configureLabelSheet(sheet, 'G')
    const boxes = boxesByPalletId.get(pallet.id) ?? []
    const rows = aggregatePalletLabelRows(boxes, boxItemsByBoxId, itemById, pallet.palletNo)
    addLabelBlock({
      sheet,
      lastColumn: 'G',
      title: `托盘标签 · ${pallet.palletNo}`,
      headers: ['托盘号', '箱数', '库位', '商品名称（韩文）', '商品名称（中文）', '规格', '数量'],
      rows,
      inputColumns: new Set([3, 5]),
      quantityColumns: new Set([2, 7]),
    })
  }
}

function groupBoxItemsByBox(detail: ChinaOutboundShipmentLabelDetail) {
  const grouped = new Map<string, ChinaOutboundShipmentLabelDetail['boxItems']>()
  for (const boxItem of detail.boxItems) {
    grouped.set(boxItem.boxId, [...(grouped.get(boxItem.boxId) ?? []), boxItem])
  }
  return grouped
}

function aggregateBoxLabelRows(
  allocations: ChinaOutboundShipmentLabelDetail['boxItems'],
  itemById: Map<string, ChinaOutboundShipmentLabelDetail['items'][number]>,
  boxNo: string,
): LabelRow[] {
  return aggregateLabelProducts(allocations, itemById)
    .map((row) => [boxNo, koreanProductName(row.productName, row.optionName), '', row.quantity, row.location])
}

function aggregatePalletLabelRows(
  boxes: ChinaOutboundShipmentLabelDetail['boxes'],
  boxItemsByBoxId: Map<string, ChinaOutboundShipmentLabelDetail['boxItems']>,
  itemById: Map<string, ChinaOutboundShipmentLabelDetail['items'][number]>,
  palletNo: string,
): LabelRow[] {
  const allocations = boxes.flatMap((box) => boxItemsByBoxId.get(box.id) ?? [])
  const productRows = aggregateLabelProducts(allocations, itemById)
  if (productRows.length === 0) return [[palletNo, boxes.length, '', '', '', '', '']]
  return productRows.map((row) => [palletNo, boxes.length, row.location, row.productName, '', row.optionName ?? '', row.quantity])
}

function aggregateLabelProducts(
  allocations: ChinaOutboundShipmentLabelDetail['boxItems'],
  itemById: Map<string, ChinaOutboundShipmentLabelDetail['items'][number]>,
): LabelProductRow[] {
  const products = new Map<string, LabelProductRow>()
  for (const allocation of allocations) {
    const item = itemById.get(allocation.shipmentItemId)
    if (!item) continue
    const sku = item.sku.trim()
    const location = item.location ?? ''
    const key = JSON.stringify([sku, item.productName, item.optionName ?? '', location])
    const current = products.get(key)
    products.set(key, {
      sku,
      productName: item.productName,
      optionName: item.optionName,
      location,
      quantity: (current?.quantity ?? 0) + allocation.quantity,
    })
  }
  return [...products.values()].sort(compareProductRows)
}

function compareProductRows(left: LabelProductRow, right: LabelProductRow) {
  return left.productName.localeCompare(right.productName, 'ko-KR')
    || (left.optionName ?? '').localeCompare(right.optionName ?? '', 'ko-KR')
    || left.sku.localeCompare(right.sku, 'ko-KR')
    || left.location.localeCompare(right.location, 'ko-KR')
}

function koreanProductName(productName: string, optionName: string | null) {
  return optionName ? `${productName} (${optionName})` : productName
}

function configureLabelSheet(sheet: ExcelJS.Worksheet, lastColumn: string) {
  sheet.views = [{ showGridLines: false }]
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    margins: PRINT_MARGINS,
  }
  sheet.pageSetup.printArea = `A1:${lastColumn}1`
}

function addEmptyLabelMessage(sheet: ExcelJS.Worksheet, message: string, lastColumn: string) {
  sheet.mergeCells(`A1:${lastColumn}1`)
  const cell = sheet.getCell('A1')
  cell.value = message
  cell.font = { bold: true, size: 12 }
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
  cell.fill = HEADER_FILL
  cell.border = ALL_BORDERS
  sheet.getRow(1).height = 36
  sheet.pageSetup.printArea = `A1:${lastColumn}1`
}

function addLabelBlock(input: {
  sheet: ExcelJS.Worksheet
  lastColumn: string
  title: string
  headers: string[]
  rows: LabelRow[]
  inputColumns: Set<number>
  quantityColumns: Set<number>
}) {
  const titleRow = input.sheet.addRow([input.title])
  input.sheet.mergeCells(`A${titleRow.number}:${input.lastColumn}${titleRow.number}`)
  titleRow.height = 30
  styleMergedRow(titleRow, DARK_FILL, { bold: true, size: 16, color: { argb: 'FFFFFFFF' } })

  const headerRow = input.sheet.addRow(input.headers)
  headerRow.height = 28
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = ALL_BORDERS
  })

  const rows = input.rows.length > 0 ? input.rows : [input.headers.map(() => '')]
  for (const values of rows) {
    const row = input.sheet.addRow(values)
    row.height = 30
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { size: 11 }
      cell.alignment = {
        horizontal: input.quantityColumns.has(column) ? 'right' : 'left',
        vertical: 'middle',
        wrapText: true,
      }
      cell.border = ALL_BORDERS
      if (input.inputColumns.has(column)) cell.fill = INPUT_FILL
      if (input.quantityColumns.has(column) && typeof cell.value === 'number') cell.numFmt = '#,##0'
    })
  }

  input.sheet.pageSetup.printArea = `A1:${input.lastColumn}${input.sheet.rowCount}`
}

function labelSheetName(prefix: string, index: number) {
  return `${prefix} ${String(index + 1).padStart(2, '0')}`
}

function styleMergedRow(
  row: ExcelJS.Row,
  fill?: ExcelJS.FillPattern,
  font: Partial<ExcelJS.Font> = {},
) {
  const cell = row.getCell(1)
  if (fill) cell.fill = fill
  cell.font = font
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
  cell.border = ALL_BORDERS
}
