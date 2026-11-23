import { resolveChinaLooseBoxes } from './china-pallet-number'
import { clearBlankExcelCells } from '../excel/empty-cells'
import ExcelJS from 'exceljs'
import { addChinaOutboundReceivingSheets } from './china-outbound-receiving-sheets'
import {
  calculateChinaOutboundBoxCbm,
  formatChinaOutboundBoxDimensions,
} from './china-outbound-dimensions'

export type ChinaOutboundPackingExportDetail = {
  shipment: {
    shipmentNo: string
    status: string
    originWarehouseCode: string
    destinationName: string | null
    plannedOutboundDate: string | null
    createdAt: Date | string
  }
  items: Array<{
    id: string
    warehouseCode: string
    sku: string
    productName: string
    chineseProductName?: string | null
    optionName: string | null
    location?: string | null
    reservedQuantity: number
    packedQuantity: number
  }>
  pallets: Array<{
    id: string
    palletNo: string
    grossWeightKg?: number | string | null
    tareWeightKg?: number | string | null
    manualCbm?: number | string | null
    lengthCm?: number | string | null
    widthCm?: number | string | null
    heightCm?: number | string | null
  }>
  boxes: Array<{
    id: string
    palletId: string | null
    boxNo: string
    status: string
    grossWeightKg?: number | string | null
    manualCbm?: number | string | null
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

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE9EDF2' },
}

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 10,
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin', color: { argb: 'FFD4D4D8' } },
}

export async function exportChinaOutboundPackingWorkbook(detail: ChinaOutboundPackingExportDetail): Promise<Buffer> {
  detail = { ...detail, ...resolveChinaLooseBoxes(detail.pallets, detail.boxes) }
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()

  const boxById = new Map(detail.boxes.map((box) => [box.id, box]))
  const palletById = new Map(detail.pallets.map((pallet) => [pallet.id, pallet]))
  const boxItemsByShipmentItem = new Map(detail.items.map((item) => [item.id, detail.boxItems.filter((boxItem) => boxItem.shipmentItemId === item.id)]))
  const cbmByBoxId = new Map(detail.boxes.map((box) => [box.id, calculateChinaOutboundBoxCbm(box)]))

  const productSheet = createListSheet(workbook, '상품별 분할', [
    'No.',
    '상품코드',
    '상품명',
    '옵션명',
    '출고 창고',
    '전체 출고수량',
    '포장수량',
    '미포장수량',
    '파렛트',
    '박스',
    '박스 규격 (cm)',
    '박스 CBM',
    '해당 박스 적재수량',
  ], [6, 18, 34, 22, 14, 14, 12, 12, 16, 14, 24, 14, 20])

  let productRowNo = 1
  for (const item of detail.items) {
    const allocations = boxItemsByShipmentItem.get(item.id) ?? []
    const rows = allocations.length === 0 ? [null] : allocations

    for (const allocation of rows) {
      const box = allocation ? boxById.get(allocation.boxId) : null
      const pallet = box?.palletId ? palletById.get(box.palletId) : null
      addDataRow(productSheet, [
        productRowNo++,
        item.sku,
        item.productName,
        item.optionName ?? '',
        item.warehouseCode,
        item.reservedQuantity,
        item.packedQuantity,
        Math.max(0, item.reservedQuantity - item.packedQuantity),
        pallet?.palletNo ?? (box ? '미지정' : ''),
        box?.boxNo ?? '',
        box ? formatChinaOutboundBoxDimensions(box) ?? '' : '',
        box ? cbmByBoxId.get(box.id) ?? '' : '',
        allocation?.quantity ?? 0,
      ])
    }
  }

  addChinaOutboundReceivingSheets(workbook, detail)

  clearBlankExcelCells(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export function chinaOutboundPackingFilename(shipmentNo: string, now = new Date()) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  const safeShipmentNo = shipmentNo.replace(/[\\/:*?"<>|]/g, '_').trim() || '중국출고'
  return `${safeShipmentNo}_적재현황_${date}.xlsx`
}

function createListSheet(workbook: ExcelJS.Workbook, name: string, headers: string[], widths: number[]) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = widths.map((width) => ({ width }))
  const headerRow = sheet.addRow(headers)
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  })
  headerRow.height = 28
  headers.forEach((header, index) => {
    if (header.includes('CBM')) sheet.getColumn(index + 1).numFmt = '#,##0.0000'
    if (header.endsWith('(kg)')) sheet.getColumn(index + 1).numFmt = '#,##0.000'
    if (header.endsWith('(cm)')) sheet.getColumn(index + 1).numFmt = '#,##0.00'
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: `${excelColumnName(headers.length)}1` }
  return sheet
}

function addDataRow(sheet: ExcelJS.Worksheet, values: Array<string | number>) {
  const row = sheet.addRow(values)
  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.font = { size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: columnNumber === 3 || columnNumber === 6 || columnNumber === 7 }
    cell.border = THIN_BORDER
    if (typeof cell.value === 'number') cell.numFmt = sheet.getColumn(columnNumber).numFmt ?? '#,##0'
  })
  row.height = 18
}

function excelColumnName(columnNumber: number) {
  let value = columnNumber
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}
