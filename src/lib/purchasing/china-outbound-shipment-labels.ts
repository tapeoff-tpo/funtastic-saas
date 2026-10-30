import { clearBlankExcelCells } from '../excel/empty-cells'
import ExcelJS from 'exceljs'
import type { ChinaOutboundPackingExportDetail } from './china-outbound-packing-export'

export const CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS = {
  boxes: '박스 쉽먼트(装箱标签)',
  pallets: '파렛트 쉽먼트(托盘标签)',
} as const

export type ChinaOutboundShipmentLabelDetail = Omit<ChinaOutboundPackingExportDetail, 'items'> & {
  items: Array<ChinaOutboundPackingExportDetail['items'][number] & { location?: string | null; chineseProductName?: string | null }>
}

export type ChinaOutboundShipmentLabelWorkbookOptions = {
  /** Restrict box label sheets to these saved box IDs. */
  boxIds?: readonly string[]
  /** Include box label sheets. Defaults to true. */
  includeBoxLabels?: boolean
  /** Include pallet label sheets. Defaults to true. */
  includePalletLabels?: boolean
}

type LabelProductRow = {
  sku: string
  productName: string
  chineseProductName: string
  optionName: string | null
  location: string
  quantity: number
}

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9EAF7' },
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
 * physical boxes and pallets. Chinese-name fields and location text remain
 * editable in Excel so operators can complete the printed label.
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

  if (options.includeBoxLabels !== false) {
    addBoxLabelSheets(workbook, detail, itemById, boxItemsByBoxId, options.boxIds)
  }
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
  clearBlankExcelCells(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export function chinaOutboundShipmentLabelFilename(shipmentNo: string, now = new Date()) {
  return `${safeFilenameSegment(shipmentNo, '중국출고')}_부착용쉽먼트_${labelFilenameDate(now)}.xlsx`
}

export function chinaOutboundShipmentBulkLabelFilename(shipmentNo: string, type: 'boxes' | 'pallets', now = new Date()) {
  const label = type === 'boxes' ? '박스쉽먼트' : '파렛트쉽먼트'
  return `${safeFilenameSegment(shipmentNo, '중국출고')}_${label}_${labelFilenameDate(now)}.xlsx`
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
    addEmptyLabelMessage(sheet, '포장된 상품이 없습니다. / 暂无已装箱商品。', 'E')
    return
  }

  for (const [index, box] of boxes.entries()) {
    const sheet = workbook.addWorksheet(labelSheetName(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.boxes, index))
    configureLabelSheet(sheet, 'F')
    // Use the full A4 landscape page for a physical carton label, not a small table.
    sheet.pageSetup.margins = { top: 0.2, bottom: 0.2, left: 0.2, right: 0.2, header: 0, footer: 0 }
    const products = aggregateLabelProducts(boxItemsByBoxId.get(box.id) ?? [], itemById)
    addLargeBoxLabel(sheet, box.boxNo, products)
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
    addEmptyLabelMessage(sheet, '파렛트에 배정된 박스가 없습니다. / 暂无已分配到托盘的箱子。', 'G')
    return
  }

  for (const [index, pallet] of pallets.entries()) {
    const sheet = workbook.addWorksheet(labelSheetName(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.pallets, index))
    configureLabelSheet(sheet, 'G')
    const boxes = boxesByPalletId.get(pallet.id) ?? []
    const rows = aggregatePalletLabelRows(boxes, boxItemsByBoxId, itemById)
    addLargePalletLabel(sheet, pallet.palletNo, detail.shipment.plannedOutboundDate, rows)
  }
}

function groupBoxItemsByBox(detail: ChinaOutboundShipmentLabelDetail) {
  const grouped = new Map<string, ChinaOutboundShipmentLabelDetail['boxItems']>()
  for (const boxItem of detail.boxItems) {
    grouped.set(boxItem.boxId, [...(grouped.get(boxItem.boxId) ?? []), boxItem])
  }
  return grouped
}

const BOX_LABEL_FILL: ExcelJS.FillPattern = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCFE8D0' },
}
const BOX_LABEL_EDGE: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } }

function addLargeBoxLabel(sheet: ExcelJS.Worksheet, boxNo: string, products: LabelProductRow[]) {
  sheet.columns = Array.from({ length: 6 }, () => ({ width: 24 }))
  const count = Math.max(1, products.length)
  const productFontSize = Math.max(14, Math.floor(40 / Math.sqrt(count)))
  const labelFontSize = Math.min(22, productFontSize)
  const lastRow = 3 * count + 3
  for (let row = 1; row <= lastRow; row += 1) {
    for (let column = 1; column <= 6; column += 1) {
      const cell = sheet.getCell(row, column)
      cell.fill = BOX_LABEL_FILL
      cell.font = { name: 'Arial', size: productFontSize, color: { argb: 'FF000000' } }
      cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
    }
  }
  sheet.mergeCells('A1:F1')
  sheet.getCell('A1').value = 'TAPEOFF'
  sheet.getCell('A1').font = { name: 'Times New Roman', size: 60, bold: true }
  sheet.getCell('A1').border = { top: BOX_LABEL_EDGE, left: BOX_LABEL_EDGE, right: BOX_LABEL_EDGE }
  sheet.getRow(1).height = 80

  for (const [index, product] of products.entries()) {
    const row = 2 + index * 3
    sheet.mergeCells(`A${row}:C${row}`)
    sheet.mergeCells(`D${row}:E${row}`)
    // The Chinese name and the reference's non-return note remain editable in Excel.
    sheet.getCell(`A${row}`).value = product.chineseProductName || null
    sheet.getCell(`A${row}`).dataValidation = {
      type: 'textLength', operator: 'lessThanOrEqual', formulae: [1000],
      showInputMessage: true, promptTitle: '중국어 상품명 / 中文品名',
      prompt: '중국어 상품명을 입력하세요. / 请输入中文品名。',
    }
    sheet.getCell(`D${row}`).value = product.quantity
    sheet.getCell(`D${row}`).numFmt = '#,##0" PC"'
    sheet.getCell(`D${row}`).alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getCell(`F${row}`).value = '不退'
    sheet.getCell(`F${row}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    sheet.getCell(`A${row}`).border = { left: BOX_LABEL_EDGE, bottom: BOX_LABEL_EDGE }
    sheet.getCell(`D${row}`).border = { bottom: BOX_LABEL_EDGE }
    sheet.getCell(`F${row}`).border = { right: BOX_LABEL_EDGE, bottom: BOX_LABEL_EDGE }
    sheet.getRow(row).height = Math.max(30, 100 / count)
    sheet.mergeCells(`A${row + 1}:F${row + 2}`)
    const name = sheet.getCell(`A${row + 1}`)
    name.value = { richText: [
      { text: '한국어 상품명 / 韩文名称: ', font: { name: 'Arial', size: labelFontSize } },
      { text: koreanProductName(product.productName, product.optionName), font: { name: 'Arial', size: productFontSize } },
      ...(product.location ? [{ text: `\n로케이션 / 库位: ${product.location}`, font: { name: 'Arial', size: labelFontSize } }] : []),
    ] }
    name.border = ALL_BORDERS
    sheet.getRow(row + 1).height = Math.max(24, 90 / count)
    sheet.getRow(row + 2).height = Math.max(24, 90 / count)
  }

  const boxRow = 3 * count + 2
  sheet.mergeCells(`A${boxRow}:C${boxRow + 1}`)
  sheet.mergeCells(`D${boxRow}:F${boxRow + 1}`)
  const boxLabel = sheet.getCell(`A${boxRow}`)
  boxLabel.value = '박스번호 / 箱子号:'
  boxLabel.font = { name: 'Arial', size: 34 }
  boxLabel.border = ALL_BORDERS
  const boxValue = sheet.getCell(`D${boxRow}`)
  boxValue.value = boxNo
  boxValue.font = { name: 'Arial', size: 40 }
  boxValue.border = ALL_BORDERS
  sheet.getRow(boxRow).height = 90
  sheet.getRow(boxRow + 1).height = 90
  sheet.pageSetup.printArea = `A1:F${lastRow}`
}

type PalletLabelProductRow = LabelProductRow & { boxCount: number }

function addLargePalletLabel(
  sheet: ExcelJS.Worksheet,
  palletNo: string,
  outboundDate: string | null,
  products: PalletLabelProductRow[],
) {
  const widths = [8, 18, 12, 18, 55, 22, 16]
  sheet.columns = widths.map((width) => ({ width }))
  sheet.pageSetup.margins = { top: 0.2, bottom: 0.2, left: 0.2, right: 0.2, header: 0, footer: 0 }
  sheet.mergeCells('A1:E1')
  const title = `TAPEOFF (${palletNo})`
  sheet.getCell('A1').value = title
  sheet.getCell('A1').font = { name: 'Arial', bold: true, size: Math.min(76, Math.floor(570 / textWidth(title))) }
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.mergeCells('F1:G1')
  sheet.getCell('F1').value = `출고일 / 出库日期\n${outboundDate ?? ''}`
  sheet.getCell('F1').font = { name: 'Arial', size: 18, bold: true }
  sheet.getCell('F1').alignment = { vertical: 'bottom', horizontal: 'center', wrapText: true }
  sheet.getRow(1).height = 100

  const headers = ['번호\n序号', '품목코드\nNO. / 编码', '박스수량\n箱数', '위치\n库位', '품명 / 品名', '옵션\n规格', '수량\n数量']
  const header = sheet.getRow(2)
  header.values = headers
  header.height = 52
  header.eachCell((cell, column) => {
    cell.font = { name: 'Arial', size: column === 2 ? 16 : 18 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = ALL_BORDERS
  })

  const count = Math.max(7, products.length)
  const rowHeight = 388 / count
  for (let index = 0; index < count; index += 1) {
    const product = products[index]
    const row = sheet.getRow(index + 3)
    row.height = rowHeight
    row.values = product
      ? [index + 1, product.sku, product.boxCount, product.location, [product.productName, product.chineseProductName].filter(Boolean).join('\n'), product.optionName, product.quantity]
      : [index + 1]
    for (let column = 1; column <= 7; column += 1) {
      const cell = row.getCell(column)
      cell.border = ALL_BORDERS
      cell.alignment = { horizontal: column === 5 ? 'left' : 'center', vertical: 'middle', wrapText: true }
      let size = Math.min(28, rowHeight * 0.7)
      const text = cell.text
      const availableWidth = widths[column - 1] * 5.25 - 8
      while (size > 10 && text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(textWidth(line) * size / availableWidth)), 0) * size * 1.2 > rowHeight - 5) size -= 1
      cell.font = { name: 'Arial', size }
      if ([1, 3, 7].includes(column)) cell.numFmt = '#,##0'
    }
  }
  sheet.pageSetup.printArea = `A1:G${count + 2}`
}

function textWidth(text: string) {
  return [...text].reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 1 : 0.6), 0)
}

function labelProductKey(item: Pick<LabelProductRow, 'sku' | 'productName' | 'optionName'> & { location?: string | null }) {
  return JSON.stringify([item.sku.trim(), item.productName, item.optionName ?? '', item.location ?? ''])
}

function aggregatePalletLabelRows(
  boxes: ChinaOutboundShipmentLabelDetail['boxes'],
  boxItemsByBoxId: Map<string, ChinaOutboundShipmentLabelDetail['boxItems']>,
  itemById: Map<string, ChinaOutboundShipmentLabelDetail['items'][number]>,
): PalletLabelProductRow[] {
  const boxIdsByProduct = new Map<string, Set<string>>()
  const allocations = boxes.flatMap((box) => {
    const contents = boxItemsByBoxId.get(box.id) ?? []
    for (const allocation of contents) {
      const item = itemById.get(allocation.shipmentItemId)
      if (!item) continue
      const key = labelProductKey(item)
      const ids = boxIdsByProduct.get(key) ?? new Set<string>()
      ids.add(box.id)
      boxIdsByProduct.set(key, ids)
    }
    return contents
  })
  return aggregateLabelProducts(allocations, itemById).map((product) => ({
    ...product, boxCount: boxIdsByProduct.get(labelProductKey(product))?.size ?? 0,
  }))
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
    const key = labelProductKey(item)
    const current = products.get(key)
    products.set(key, {
      sku,
      productName: item.productName,
      chineseProductName: item.chineseProductName?.trim() ?? '',
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

function labelSheetName(prefix: string, index: number) {
  return `${prefix} ${String(index + 1).padStart(2, '0')}`
}
