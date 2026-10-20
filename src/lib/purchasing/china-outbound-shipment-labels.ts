import ExcelJS from 'exceljs'
import type { ChinaOutboundPackingExportDetail } from './china-outbound-packing-export'

export const CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS = {
  guide: '인쇄 안내',
  boxes: '박스 쉽먼트',
  pallets: '파렛트 쉽먼트',
} as const

export type ChinaOutboundShipmentLabelDetail = ChinaOutboundPackingExportDetail

type LabelRow = Array<string | number>

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
 * Excel because Chinese names and warehouse locations are not shipment data.
 */
export function createChinaOutboundShipmentLabelWorkbook(
  detail: ChinaOutboundShipmentLabelDetail,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Funtastic SaaS'
  workbook.created = new Date()

  const itemById = new Map(detail.items.map((item) => [item.id, item]))
  const palletById = new Map(detail.pallets.map((pallet) => [pallet.id, pallet]))
  const boxItemsByBoxId = groupBoxItemsByBox(detail)

  addGuideSheet(workbook, detail)
  addBoxLabelSheets(workbook, detail, itemById, boxItemsByBoxId)
  addPalletLabelSheets(workbook, detail, itemById, palletById, boxItemsByBoxId)

  return workbook
}

export async function exportChinaOutboundShipmentLabelWorkbook(
  detail: ChinaOutboundShipmentLabelDetail,
): Promise<Buffer> {
  const workbook = createChinaOutboundShipmentLabelWorkbook(detail)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export function chinaOutboundShipmentLabelFilename(shipmentNo: string, now = new Date()) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  const safeShipmentNo = shipmentNo.replace(/[\\/:*?"<>|]/g, '_').trim() || '중국출고'
  return `${safeShipmentNo}_부착용쉽먼트_${date}.xlsx`
}

function addGuideSheet(workbook: ExcelJS.Workbook, detail: ChinaOutboundShipmentLabelDetail) {
  const sheet = workbook.addWorksheet(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.guide)
  sheet.columns = [{ width: 24 }, { width: 82 }]
  sheet.views = [{ showGridLines: false }]
  sheet.mergeCells('A1:B1')
  sheet.getCell('A1').value = '중국출고 부착용 쉽먼트'
  sheet.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FF1F1F1F' } }
  sheet.getCell('A1').alignment = { vertical: 'middle' }
  sheet.getRow(1).height = 28

  const rows: Array<[string, string]> = [
    ['출고번호', detail.shipment.shipmentNo],
    ['출고 창고', detail.shipment.originWarehouseCode],
    ['도착지', detail.shipment.destinationName ?? '미입력'],
    ['출고예정일', detail.shipment.plannedOutboundDate ?? '미입력'],
    ['입력', '박스 쉽먼트의 중국어 상품명·로케이션, 파렛트 쉽먼트의 위치는 노란색 칸에 직접 입력하세요.'],
    ['출력 범위', '현재 내용이 저장된 박스만 박스 쉽먼트에, 현재 배정된 박스만 파렛트 쉽먼트에 포함됩니다. 박스 내용이나 파렛트 배정이 바뀌면 다시 내려받아 해당 시트를 인쇄하세요.'],
    ['인쇄', '박스와 파렛트 라벨은 각각 별도 시트이며, 한 시트가 한 장씩 인쇄되도록 설정되어 있습니다.'],
  ]

  for (const [label, value] of rows) {
    const row = sheet.addRow([label, value])
    row.height = label === '출력 범위' ? 46 : label === '입력' || label === '인쇄' ? 32 : 22
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = ALL_BORDERS
      cell.alignment = { vertical: 'middle', wrapText: true }
      cell.font = { size: 10 }
    })
    row.getCell(1).font = { bold: true, size: 10 }
    row.getCell(1).fill = HEADER_FILL
  }
}

function addBoxLabelSheets(
  workbook: ExcelJS.Workbook,
  detail: ChinaOutboundShipmentLabelDetail,
  itemById: Map<string, ChinaOutboundShipmentLabelDetail['items'][number]>,
  boxItemsByBoxId: Map<string, ChinaOutboundShipmentLabelDetail['boxItems']>,
) {
  const boxes = [...detail.boxes]
    .filter((box) => (boxItemsByBoxId.get(box.id)?.length ?? 0) > 0)
    .sort((left, right) => left.boxNo.localeCompare(right.boxNo, 'ko-KR', { numeric: true }))

  if (boxes.length === 0) {
    const sheet = workbook.addWorksheet(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.boxes)
    sheet.columns = [{ width: 28 }, { width: 11 }, { width: 36 }, { width: 17 }, { width: 20 }]
    configureLabelSheet(sheet, 'E')
    addEmptyLabelMessage(sheet, '포장된 박스가 없어 박스 쉽먼트를 만들 수 없습니다.', 'E')
    return
  }

  for (const [index, box] of boxes.entries()) {
    const sheet = workbook.addWorksheet(labelSheetName(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.boxes, index))
    sheet.columns = [{ width: 28 }, { width: 11 }, { width: 36 }, { width: 17 }, { width: 20 }]
    configureLabelSheet(sheet, 'E')
    const rows = aggregateBoxLabelRows(boxItemsByBoxId.get(box.id) ?? [], itemById, box.boxNo)
    addLabelBlock({
      sheet,
      lastColumn: 'E',
      title: `박스 쉽먼트 · ${box.boxNo}`,
      subtitle: `출고번호: ${detail.shipment.shipmentNo}`,
      inputNotice: '노란색 칸에 중국어 상품명과 로케이션을 입력한 뒤, 이 박스에 부착하세요.',
      headers: ['중국어 상품명', '수량', '한국어 상품명', '박스번호', '로케이션'],
      rows,
      inputColumns: new Set([1, 5]),
      quantityColumns: new Set([2]),
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
    sheet.columns = [{ width: 14 }, { width: 14 }, { width: 20 }, { width: 34 }, { width: 24 }, { width: 12 }]
    configureLabelSheet(sheet, 'F')
    addEmptyLabelMessage(sheet, '파렛트에 배정된 박스가 없어 파렛트 쉽먼트를 만들 수 없습니다.', 'F')
    return
  }

  for (const [index, pallet] of pallets.entries()) {
    const sheet = workbook.addWorksheet(labelSheetName(CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.pallets, index))
    sheet.columns = [{ width: 14 }, { width: 14 }, { width: 20 }, { width: 34 }, { width: 24 }, { width: 12 }]
    configureLabelSheet(sheet, 'F')
    const boxes = boxesByPalletId.get(pallet.id) ?? []
    const rows = aggregatePalletLabelRows(boxes, boxItemsByBoxId, itemById, pallet.palletNo)
    addLabelBlock({
      sheet,
      lastColumn: 'F',
      title: `파렛트 쉽먼트 · ${pallet.palletNo}`,
      subtitle: `출고번호: ${detail.shipment.shipmentNo}`,
      inputNotice: '노란색 위치 칸을 입력한 뒤, 이 파렛트에 부착하세요.',
      headers: ['번호', '박스수량', '위치', '품명', '옵션', '수량'],
      rows,
      inputColumns: new Set([3]),
      quantityColumns: new Set([2, 6]),
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
  const rows = new Map<string, { productName: string; optionName: string | null; quantity: number }>()
  for (const allocation of allocations) {
    const item = itemById.get(allocation.shipmentItemId)
    if (!item) continue
    const key = `${item.productName}\u0000${item.optionName ?? ''}`
    const current = rows.get(key)
    rows.set(key, {
      productName: item.productName,
      optionName: item.optionName,
      quantity: (current?.quantity ?? 0) + allocation.quantity,
    })
  }
  return [...rows.values()]
    .sort(compareProductRows)
    .map((row) => ['', row.quantity, koreanProductName(row.productName, row.optionName), boxNo, ''])
}

function aggregatePalletLabelRows(
  boxes: ChinaOutboundShipmentLabelDetail['boxes'],
  boxItemsByBoxId: Map<string, ChinaOutboundShipmentLabelDetail['boxItems']>,
  itemById: Map<string, ChinaOutboundShipmentLabelDetail['items'][number]>,
  palletNo: string,
): LabelRow[] {
  const products = new Map<string, { productName: string; optionName: string | null; quantity: number }>()
  for (const box of boxes) {
    for (const allocation of boxItemsByBoxId.get(box.id) ?? []) {
      const item = itemById.get(allocation.shipmentItemId)
      if (!item) continue
      const key = `${item.productName}\u0000${item.optionName ?? ''}`
      const current = products.get(key)
      products.set(key, {
        productName: item.productName,
        optionName: item.optionName,
        quantity: (current?.quantity ?? 0) + allocation.quantity,
      })
    }
  }

  const productRows = [...products.values()].sort(compareProductRows)
  if (productRows.length === 0) return [[palletNo, boxes.length, '', '', '', '']]
  return productRows.map((row) => [palletNo, boxes.length, '', row.productName, row.optionName ?? '', row.quantity])
}

function compareProductRows(
  left: { productName: string; optionName: string | null },
  right: { productName: string; optionName: string | null },
) {
  return left.productName.localeCompare(right.productName, 'ko-KR')
    || (left.optionName ?? '').localeCompare(right.optionName ?? '', 'ko-KR')
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
  sheet.headerFooter.oddFooter = '&CPage &P of &N'
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
  subtitle: string
  inputNotice: string
  headers: string[]
  rows: LabelRow[]
  inputColumns: Set<number>
  quantityColumns: Set<number>
}) {
  const titleRow = input.sheet.addRow([input.title])
  input.sheet.mergeCells(`A${titleRow.number}:${input.lastColumn}${titleRow.number}`)
  titleRow.height = 30
  styleMergedRow(titleRow, DARK_FILL, { bold: true, size: 16, color: { argb: 'FFFFFFFF' } })

  const subtitleRow = input.sheet.addRow([input.subtitle])
  input.sheet.mergeCells(`A${subtitleRow.number}:${input.lastColumn}${subtitleRow.number}`)
  subtitleRow.height = 18
  styleMergedRow(subtitleRow, undefined, { size: 9, color: { argb: 'FF4B5563' } })

  const noticeRow = input.sheet.addRow([input.inputNotice])
  input.sheet.mergeCells(`A${noticeRow.number}:${input.lastColumn}${noticeRow.number}`)
  noticeRow.height = 20
  styleMergedRow(noticeRow, INPUT_FILL, { italic: true, size: 9, color: { argb: 'FF6B4F00' } })

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

  const footerRow = input.sheet.addRow([''])
  input.sheet.mergeCells(`A${footerRow.number}:${input.lastColumn}${footerRow.number}`)
  footerRow.height = 8
  styleMergedRow(footerRow)
  input.sheet.pageSetup.printArea = `A1:${input.lastColumn}${footerRow.number}`
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
