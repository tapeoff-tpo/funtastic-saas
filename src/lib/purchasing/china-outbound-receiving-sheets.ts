import type ExcelJS from 'exceljs'
import type { ChinaOutboundPackingExportDetail } from './china-outbound-packing-export'
import { calculateChinaOutboundBoxCbm, dimensionNumber } from './china-outbound-dimensions'
import { calculateChinaOutboundPalletWeight } from './china-outbound-pallet-weight'

type Detail = ChinaOutboundPackingExportDetail
type ProductRow = {
  sku: string
  productName: string
  optionName: string
  location: string
  quantity: number
  boxIds: Set<string>
  boxNumbers: Set<string>
  quantitiesByWarehouse: Map<string, number>
}

const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })

/** Receiving lists describe products; counts and measurements describe physical packages. */
export function addChinaOutboundReceivingSheets(workbook: ExcelJS.Workbook, detail: Detail) {
  const itemById = new Map(detail.items.map((item) => [item.id, item]))
  const boxIds = new Set(detail.boxes.map((box) => box.id))
  const allocationsByBox = new Map<string, Detail['boxItems']>()
  const loadedItemIds = new Set<string>()
  for (const allocation of detail.boxItems) {
    if (!itemById.has(allocation.shipmentItemId) || !boxIds.has(allocation.boxId) || !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0) continue
    const allocations = allocationsByBox.get(allocation.boxId) ?? []
    allocations.push(allocation)
    allocationsByBox.set(allocation.boxId, allocations)
    loadedItemIds.add(allocation.shipmentItemId)
  }
  const warehouseFor = (item: Detail['items'][number]) => item.warehouseCode.trim() || detail.shipment.originWarehouseCode.trim() || '미지정'
  const warehouses = [...new Set(detail.items.filter((item) => loadedItemIds.has(item.id)).map(warehouseFor))]
  const loadedBoxes = detail.boxes.filter((box) => allocationsByBox.has(box.id))

  function productsFor(boxes: Detail['boxes']) {
    const products = new Map<string, ProductRow>()
    for (const box of boxes) {
      for (const allocation of allocationsByBox.get(box.id) ?? []) {
        const item = itemById.get(allocation.shipmentItemId)!
        const sku = item.sku.trim()
        const optionName = item.optionName ?? ''
        const location = item.location?.trim() ?? ''
        const key = JSON.stringify([sku, item.productName, optionName, location])
        const row = products.get(key) ?? {
          sku, productName: item.productName, optionName, location, quantity: 0,
          boxIds: new Set<string>(), boxNumbers: new Set<string>(), quantitiesByWarehouse: new Map<string, number>(),
        }
        row.quantity += allocation.quantity
        row.boxIds.add(box.id)
        row.boxNumbers.add(box.boxNo)
        const warehouse = warehouseFor(item)
        row.quantitiesByWarehouse.set(warehouse, (row.quantitiesByWarehouse.get(warehouse) ?? 0) + allocation.quantity)
        products.set(key, row)
      }
    }
    return [...products.values()].sort((left, right) => collator.compare(left.sku, right.sku)
      || collator.compare(left.productName, right.productName)
      || collator.compare(left.optionName, right.optionName)
      || collator.compare(left.location, right.location))
  }

  function warehouseValues(product: ProductRow) {
    return [
      ...warehouses.map((warehouse) => product.quantitiesByWarehouse.get(warehouse) ?? 0),
      warehouses.filter((warehouse) => product.quantitiesByWarehouse.has(warehouse)).join(', '),
    ]
  }

  const boxHeaders = ['박스번호', '박스수량', '상품코드', '상품명', '옵션명', '입고수량', ...warehouses, '창고구분', '무게(kg)', 'CBM', '로케이션']
  const boxWidths = [20, 12, 20, 34, 22, 14, ...warehouses.map(() => 16), 26, 16, 16, 22]
  function addBoxesSheet(name: string, boxes: Detail['boxes']) {
    const sheet = createReceivingSheet(workbook, name, boxHeaders, boxWidths)
    for (const box of boxes) {
      for (const [index, product] of productsFor([box]).entries()) {
        addReceivingRow(sheet, [
          box.boxNo, product.boxIds.size, product.sku, product.productName, product.optionName, product.quantity,
          ...warehouseValues(product),
          index === 0 ? dimensionNumber(box.grossWeightKg) ?? '' : '',
          index === 0 ? calculateChinaOutboundBoxCbm(box) ?? '' : '',
          product.location,
        ])
      }
    }
    finishReceivingSheet(sheet)
  }

  addBoxesSheet('박스별 적재', loadedBoxes)
  const palletSheet = createReceivingSheet(workbook, '파렛트별 적재', [
    '파렛트', '파렛트박스수량', '박스번호', '상품코드', '상품명', '옵션', '입고수량',
    ...warehouses, '창고구분', '무게(kg)', 'CBM', '로케이션',
  ], [16, 20, 26, 20, 34, 22, 14, ...warehouses.map(() => 16), 26, 16, 16, 22])
  for (const pallet of detail.pallets) {
    const boxes = loadedBoxes.filter((box) => box.palletId === pallet.id)
    if (!boxes.length) continue
    const weight = calculateChinaOutboundPalletWeight(boxes, pallet.tareWeightKg).grossWeightKg
    for (const [index, product] of productsFor(boxes).entries()) {
      addReceivingRow(palletSheet, [
        pallet.palletNo, product.boxIds.size, [...product.boxNumbers].sort(collator.compare).join(', '),
        product.sku, product.productName, product.optionName, product.quantity,
        ...warehouseValues(product), index === 0 ? weight ?? '' : '',
        index === 0 ? calculateChinaOutboundBoxCbm(pallet) ?? '' : '', product.location,
      ])
    }
  }
  finishReceivingSheet(palletSheet)
  const unassigned = loadedBoxes.filter((box) => !box.palletId)
  if (unassigned.length) addBoxesSheet('파렛트 미지정', unassigned)
}

function createReceivingSheet(workbook: ExcelJS.Workbook, name: string, headers: string[], widths: number[]) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = widths.map((width) => ({ width }))
  const header = sheet.addRow(headers)
  header.eachCell((cell, column) => {
    cell.font = { name: '맑은 고딕', size: 10, bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EDF2' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD4D4D8' } } }
    const label = headers[column - 1]
    if (label === 'CBM') sheet.getColumn(column).numFmt = '#,##0.0000'
    if (label === '무게(kg)') sheet.getColumn(column).numFmt = '#,##0.000'
  })
  header.height = Math.max(30, ...headers.map((label, index) => textLines(label, widths[index]) * 14 + 8))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' }
  return sheet
}

function addReceivingRow(sheet: ExcelJS.Worksheet, values: Array<string | number>) {
  const row = sheet.addRow(values)
  let lines = 1
  row.eachCell({ includeEmpty: true }, (cell, column) => {
    cell.font = { name: '맑은 고딕', size: 10 }
    cell.alignment = { vertical: 'middle', horizontal: typeof cell.value === 'number' ? 'right' : 'left', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD4D4D8' } } }
    if (typeof cell.value === 'number') cell.numFmt = sheet.getColumn(column).numFmt ?? '#,##0'
    lines = Math.max(lines, textLines(String(cell.value ?? ''), sheet.getColumn(column).width ?? 16))
  })
  row.height = Math.max(24, lines * 14 + 8)
}

function textLines(value: string, width: number) {
  return value.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil([...line].reduce((length, character) => length + (/[^\x00-\x7F]/.test(character) ? 2 : 1), 0) / Math.max(1, width - 2))), 0)
}

function finishReceivingSheet(sheet: ExcelJS.Worksheet) {
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } }
}
