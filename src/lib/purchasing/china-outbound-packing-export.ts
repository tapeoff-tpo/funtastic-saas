import ExcelJS from 'exceljs'
import {
  calculateChinaOutboundBoxCbm,
  dimensionNumber,
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
    optionName: string | null
    reservedQuantity: number
    packedQuantity: number
  }>
  pallets: Array<{
    id: string
    palletNo: string
  }>
  boxes: Array<{
    id: string
    palletId: string | null
    boxNo: string
    status: string
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

const shipmentStatusLabels: Record<string, string> = {
  draft: '작성중',
  packing: '포장중',
  ready: '포장완료',
  dispatched: '출고완료',
  cancelled: '취소',
}

export async function exportChinaOutboundPackingWorkbook(detail: ChinaOutboundPackingExportDetail): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()

  const itemById = new Map(detail.items.map((item) => [item.id, item]))
  const boxById = new Map(detail.boxes.map((box) => [box.id, box]))
  const palletById = new Map(detail.pallets.map((pallet) => [pallet.id, pallet]))
  const boxItemsByBox = new Map(detail.boxes.map((box) => [box.id, detail.boxItems.filter((item) => item.boxId === box.id)]))
  const boxItemsByShipmentItem = new Map(detail.items.map((item) => [item.id, detail.boxItems.filter((boxItem) => boxItem.shipmentItemId === item.id)]))
  const totalOutboundQuantity = detail.items.reduce((total, item) => total + item.reservedQuantity, 0)
  const totalPackedQuantity = detail.boxItems.reduce((total, item) => total + item.quantity, 0)
  const cbmByBoxId = new Map(detail.boxes.map((box) => [box.id, calculateChinaOutboundBoxCbm(box)]))
  const boxesWithCbm = [...cbmByBoxId.values()].filter((cbm): cbm is number => cbm != null)
  const totalCbm = boxesWithCbm.reduce((total, cbm) => total + cbm, 0)

  addSummarySheet(workbook, detail, totalOutboundQuantity, totalPackedQuantity, boxesWithCbm.length, totalCbm)

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

  const boxSheet = createListSheet(workbook, '박스별 적재', [
    'No.',
    '파렛트',
    '박스',
    '상태',
    '상품코드',
    '상품명',
    '옵션명',
    '가로 (cm)',
    '세로 (cm)',
    '높이 (cm)',
    '박스 CBM',
    '상품 전체 출고수량',
    '박스 적재수량',
  ], [6, 16, 14, 12, 18, 34, 22, 12, 12, 12, 14, 18, 16])

  let boxRowNo = 1
  for (const box of detail.boxes) {
    const packedItems = boxItemsByBox.get(box.id) ?? []
    const rows = packedItems.length === 0 ? [null] : packedItems
    const pallet = box.palletId ? palletById.get(box.palletId) : null

    for (const packedItem of rows) {
      const item = packedItem ? itemById.get(packedItem.shipmentItemId) : null
      addDataRow(boxSheet, [
        boxRowNo++,
        pallet?.palletNo ?? '미지정',
        box.boxNo,
        box.status,
        item?.sku ?? '',
        item?.productName ?? '',
        item?.optionName ?? '',
        dimensionNumber(box.lengthCm) ?? '',
        dimensionNumber(box.widthCm) ?? '',
        dimensionNumber(box.heightCm) ?? '',
        cbmByBoxId.get(box.id) ?? '',
        item?.reservedQuantity ?? 0,
        packedItem?.quantity ?? 0,
      ])
    }
  }

  const palletSheet = createListSheet(workbook, '파렛트별 적재', [
    'No.',
    '파렛트',
    '파렛트 박스 수',
    '파렛트 총 적재수량',
    '파렛트 총 CBM',
    '박스',
    '박스 규격 (cm)',
    '박스 CBM',
    '상품코드',
    '상품명',
    '옵션명',
    '박스 적재수량',
  ], [6, 16, 16, 20, 16, 14, 24, 14, 18, 34, 22, 16])

  let palletRowNo = 1
  for (const pallet of detail.pallets) {
    const palletBoxes = detail.boxes.filter((box) => box.palletId === pallet.id)
    const palletPackedQuantity = palletBoxes.reduce((total, box) => total + (boxItemsByBox.get(box.id) ?? []).reduce((boxTotal, item) => boxTotal + item.quantity, 0), 0)
    const palletCbms = palletBoxes.map((box) => cbmByBoxId.get(box.id)).filter((cbm): cbm is number => cbm != null)
    const palletCbm = palletCbms.length > 0 ? palletCbms.reduce((total, cbm) => total + cbm, 0) : ''
    const rows = palletBoxes.length === 0 ? [null] : palletBoxes

    for (const box of rows) {
      const packedItems = box ? boxItemsByBox.get(box.id) ?? [] : []
      const itemRows = packedItems.length === 0 ? [null] : packedItems

      for (const packedItem of itemRows) {
        const item = packedItem ? itemById.get(packedItem.shipmentItemId) : null
        addDataRow(palletSheet, [
          palletRowNo++,
          pallet.palletNo,
          palletBoxes.length,
          palletPackedQuantity,
          palletCbm,
          box?.boxNo ?? '',
          box ? formatChinaOutboundBoxDimensions(box) ?? '' : '',
          box ? cbmByBoxId.get(box.id) ?? '' : '',
          item?.sku ?? '',
          item?.productName ?? '',
          item?.optionName ?? '',
          packedItem?.quantity ?? 0,
        ])
      }
    }
  }

  const unassignedBoxes = detail.boxes.filter((box) => !box.palletId)
  if (unassignedBoxes.length > 0) {
    const unassignedSheet = createListSheet(workbook, '파렛트 미지정', [
      'No.',
      '박스',
      '상태',
      '상품코드',
      '상품명',
      '옵션명',
      '박스 규격 (cm)',
      '박스 CBM',
      '박스 적재수량',
    ], [6, 14, 12, 18, 34, 22, 24, 14, 16])

    let unassignedRowNo = 1
    for (const box of unassignedBoxes) {
      const packedItems = boxItemsByBox.get(box.id) ?? []
      const rows = packedItems.length === 0 ? [null] : packedItems
      for (const packedItem of rows) {
        const item = packedItem ? itemById.get(packedItem.shipmentItemId) : null
        addDataRow(unassignedSheet, [
          unassignedRowNo++,
          box.boxNo,
          box.status,
          item?.sku ?? '',
          item?.productName ?? '',
          item?.optionName ?? '',
          formatChinaOutboundBoxDimensions(box) ?? '',
          cbmByBoxId.get(box.id) ?? '',
          packedItem?.quantity ?? 0,
        ])
      }
    }
  }

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

function addSummarySheet(workbook: ExcelJS.Workbook, detail: ChinaOutboundPackingExportDetail, totalOutboundQuantity: number, totalPackedQuantity: number, boxesWithCbmCount: number, totalCbm: number) {
  const sheet = workbook.addWorksheet('요약')
  sheet.columns = [{ width: 22 }, { width: 42 }]
  sheet.mergeCells('A1:B1')
  sheet.getCell('A1').value = '중국출고 적재현황'
  sheet.getCell('A1').font = { bold: true, size: 14 }
  sheet.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' }
  sheet.getRow(1).height = 26

  const rows: Array<[string, string | number]> = [
    ['출고번호', detail.shipment.shipmentNo],
    ['상태', shipmentStatusLabels[detail.shipment.status] ?? detail.shipment.status],
    ['출고 창고', detail.shipment.originWarehouseCode],
    ['도착지', detail.shipment.destinationName ?? '미입력'],
    ['출고예정일', detail.shipment.plannedOutboundDate ?? '미입력'],
    ['상품 종류', detail.items.length],
    ['전체 출고수량', totalOutboundQuantity],
    ['포장수량', totalPackedQuantity],
    ['미포장수량', Math.max(0, totalOutboundQuantity - totalPackedQuantity)],
    ['파렛트 수', detail.pallets.length],
    ['박스 수', detail.boxes.length],
    ['CBM 입력 박스 수', boxesWithCbmCount],
    ['총 CBM', totalCbm],
    ['등록일', formatDateTime(detail.shipment.createdAt)],
    ['내보낸 시각', formatDateTime(new Date())],
  ]

  for (const [label, value] of rows) {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true, size: 10 }
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F5' } }
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...cell.font, size: 10 }
      cell.alignment = { vertical: 'middle' }
      cell.border = THIN_BORDER
    })
    if (typeof value === 'number') row.getCell(2).numFmt = label === '총 CBM' ? '#,##0.0000' : '#,##0'
  }
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
    cell.alignment = { vertical: 'middle', wrapText: columnNumber === 3 || columnNumber === 6 || columnNumber === 7 }
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

function formatDateTime(value: Date | string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
