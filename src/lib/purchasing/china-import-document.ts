import ExcelJS from 'exceljs'
import { clearBlankExcelCells } from '../excel/empty-cells'
import { calculateChinaOutboundBoxCbm, dimensionNumber } from './china-outbound-dimensions'
import type { ChinaOutboundPackingExportDetail } from './china-outbound-packing-export'

export type ImportItemMetadata = { englishName: string; chineseName: string; hsCode: string; material: string; unitPriceCny: number | null }
export type ImportDocumentOptions = {
  invoiceNo: string; invoiceDate: string; sailingDate: string
  exporter: string; importer: string; importerAddress: string
  loadingPort: string; destinationPort: string; paymentTerms: string
  palletTareKg: number; palletExtraCbm: number
  items: Record<string, { englishName: string; unitPriceCny: number }>
  boxes: Record<string, { grossWeightKg: number; cbm: number }>
}
export type ImportDocumentDetail = Omit<ChinaOutboundPackingExportDetail, 'boxes'> & {
  boxes: Array<ChinaOutboundPackingExportDetail['boxes'][number] & { grossWeightKg?: string | number | null }>
}

export function importUnitPriceCny(data: Record<string, string | null>) {
  for (const key of ['특가(元)', '신규원가(元)']) {
    const value = data[key]?.replaceAll(',', '').trim()
    if (value && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0) return Number(value)
  }
  return null
}

export function prepareImportDocument(detail: ImportDocumentDetail, metadata: Map<string, ImportItemMetadata>) {
  if (detail.shipment.status === 'cancelled') throw new Error('취소된 출고작업은 수입문서를 만들 수 없습니다.')
  if (!detail.items.length) throw new Error('출고상품을 먼저 등록해주세요.')
  const itemById = new Map(detail.items.map((item) => [item.id, item]))
  const boxById = new Map(detail.boxes.map((box) => [box.id, box]))
  const quantityByItem = new Map<string, number>()
  for (const allocation of detail.boxItems) {
    if (!itemById.has(allocation.shipmentItemId) || !boxById.has(allocation.boxId)
      || !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0) {
      throw new Error('저장된 박스와 출고상품 연결정보를 확인해주세요.')
    }
    quantityByItem.set(allocation.shipmentItemId, (quantityByItem.get(allocation.shipmentItemId) ?? 0) + allocation.quantity)
  }
  for (const item of detail.items) {
    if (quantityByItem.get(item.id) !== item.reservedQuantity) {
      throw new Error(`${item.sku}: 박스에 저장된 수량이 출고수량과 같아야 수입문서를 만들 수 있습니다.`)
    }
  }
  const packedBoxIds = new Set(detail.boxItems.map((allocation) => allocation.boxId))
  const boxes = detail.boxes.filter((box) => packedBoxIds.has(box.id))
  const palletById = new Map(detail.pallets.map((pallet) => [pallet.id, pallet]))
  if (boxes.some((box) => box.palletId && !palletById.has(box.palletId))) throw new Error('박스의 파렛트 배정정보를 확인해주세요.')
  const usedPalletIds = new Set(boxes.flatMap((box) => box.palletId ? [box.palletId] : []))
  const pallets = detail.pallets.filter((pallet) => usedPalletIds.has(pallet.id))
  const looseBoxCount = boxes.filter((box) => !box.palletId).length
  return {
    shipmentNo: detail.shipment.shipmentNo,
    plannedOutboundDate: detail.shipment.plannedOutboundDate,
    items: detail.items.map((item) => ({
      ...item, quantity: quantityByItem.get(item.id)!,
      ...(metadata.get(item.sku.trim()) ?? { englishName: '', chineseName: '', hsCode: '', material: '', unitPriceCny: null }),
    })),
    boxes: boxes.map((box) => ({
      id: box.id, boxNo: box.boxNo, palletId: box.palletId,
      palletNo: box.palletId ? palletById.get(box.palletId)!.palletNo : null,
      grossWeightKg: dimensionNumber(box.grossWeightKg), cbm: calculateChinaOutboundBoxCbm(box),
    })),
    pallets,
    boxCount: boxes.length, palletCount: pallets.length, looseBoxCount,
    packageCount: pallets.length + looseBoxCount,
  }
}

export async function exportChinaImportDocument(
  detail: ImportDocumentDetail,
  metadata: Map<string, ImportItemMetadata>,
  options: ImportDocumentOptions,
) {
  const prepared = prepareImportDocument(detail, metadata)
  for (const item of prepared.items) {
    const override = options.items[item.id]
    if (!override?.englishName.trim() || !Number.isFinite(override.unitPriceCny) || override.unitPriceCny < 0) {
      throw new Error(`${item.sku}: 영문명과 위안화 단가를 확인해주세요.`)
    }
  }
  for (const box of prepared.boxes) {
    const override = options.boxes[box.id]
    if (!override || !Number.isFinite(override.grossWeightKg) || override.grossWeightKg <= 0
      || !Number.isFinite(override.cbm) || override.cbm <= 0) throw new Error(`${box.boxNo}: 총중량과 CBM을 입력해주세요.`)
  }
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'TAPEOFF'
  const sheet = workbook.addWorksheet('INVOICE & PACKING LIST')
  sheet.columns = Array.from({ length: 24 }, (_, i) => ({ width: [0, 10].includes(i) ? 18 : 10 }))
  sheet.getColumn('N').width = 20
  sheet.views = [{ showGridLines: false, state: 'frozen', ySplit: 19 }]
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  sheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.15, footer: 0.15 }
  sheet.pageSetup.printTitlesRow = '1:19'
  function merged(range: string, value: string, size = 11, bold = false) {
    sheet.mergeCells(range)
    const cell = sheet.getCell(range.split(':')[0])
    cell.value = value
    cell.font = { name: 'Arial', size, bold }
    cell.alignment = { vertical: 'middle', wrapText: true }
  }
  merged('A1:J1', 'COMMERCIAL INVOICE', 20, true)
  merged('K1:X1', 'PACKING LIST', 20, true)
  sheet.getRow(1).height = 34
  for (const [left, right] of [['A', 'K'], ['E', 'R']]) {
    const end = left === 'A' ? 'D' : 'J'
    const endRight = right === 'K' ? 'Q' : 'X'
    const fields: Array<[number, string]> = left === 'A' ? [
      [2, '1. Shipper / Exporter'], [3, options.exporter], [7, '2. Consignee'], [8, options.importer],
      [9, options.importerAddress], [12, '3. Notify Party'], [13, 'SAME AS CONSIGNEE'],
      [14, '4. Port of Loading'], [15, options.loadingPort], [16, 'Sailing Date'], [17, options.sailingDate],
    ] : [
      [2, 'Invoice No. & Date'], [3, `${options.invoiceNo} / ${options.invoiceDate}`],
      [7, 'Currency'], [8, 'CNY (RMB)'], [12, 'Payment Terms'], [13, options.paymentTerms],
      [14, 'Final Destination'], [15, options.destinationPort],
      [16, 'Packages'], [17, `${prepared.palletCount} PLT + ${prepared.looseBoxCount} CTN = ${prepared.packageCount} PACKAGES`],
    ]
    for (const [row, value] of fields) {
      merged(`${left}${row}:${end}${row}`, value)
      merged(`${right}${row}:${endRight}${row}`, value)
      sheet.getRow(row).height = [3, 9, 17].includes(row) ? 36 : 22
    }
  }
  const columns = [
    ['A18:A19', 'Marks / Box No.'], ['B18:B19', 'Pallet'], ['C18:D19', 'Description of Goods'],
    ['E18:E19', 'Quantity'], ['F18:F19', 'Unit'], ['G18:I19', 'Unit Price (CNY)'], ['J18:J19', 'Amount (CNY)'],
    ['K18:K19', 'Box No.'], ['L18:L19', 'CTN'], ['M18:M19', 'Pallet'], ['N18:N19', 'SKU'],
    ['O18:Q19', 'Description of Goods'], ['R18:R19', 'Quantity'], ['S18:S19', 'Unit'],
    ['T18:U19', "Net W't (KG)"], ['V18:W19', "Gross W't (KG)"], ['X18:X19', 'CBM'],
  ]
  for (const [range, value] of columns) {
    merged(range, value, 10, true)
    sheet.getCell(range.split(':')[0]).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } }
  }
  const allocationsByItem = new Map(prepared.items.map((item) => [item.id, detail.boxItems.filter((a) => a.shipmentItemId === item.id)]))
  const boxById = new Map(prepared.boxes.map((box) => [box.id, box]))
  const itemById = new Map(prepared.items.map((item) => [item.id, item]))
  for (const [index, item] of prepared.items.entries()) {
    const row = index + 20
    const source = options.items[item.id]
    const allocations = allocationsByItem.get(item.id)!
    const marks = [...new Set(allocations.map((a) => boxById.get(a.boxId)!.boxNo))]
    const markText = marks.join(', ')
    sheet.getCell(`A${row}`).value = markText.length > 60 ? `MULTIPLE (${marks.length} CTN)\nSEE PACKING LIST` : markText
    sheet.getCell(`B${row}`).value = [...new Set(allocations.map((a) => boxById.get(a.boxId)!.palletNo ?? 'BOX'))].join(', ')
    merged(`C${row}:D${row}`, `${source.englishName}\n${item.sku}${item.optionName ? ` / ${item.optionName}` : ''}`)
    sheet.getCell(`E${row}`).value = item.quantity
    sheet.getCell(`F${row}`).value = 'ea'
    merged(`G${row}:I${row}`, '')
    sheet.getCell(`G${row}`).value = source.unitPriceCny
    sheet.getCell(`G${row}`).numFmt = '0.00####'
    sheet.getCell(`J${row}`).value = { formula: `ROUND(E${row}*G${row},2)`, result: money(source.unitPriceCny * item.quantity) }
    sheet.getCell(`J${row}`).numFmt = '#,##0.00'
  }
  let packingRow = 20
  for (const box of prepared.boxes) {
    const allocations = detail.boxItems.filter((a) => a.boxId === box.id)
    for (const [index, allocation] of allocations.entries()) {
      const item = itemById.get(allocation.shipmentItemId)!
      const row = packingRow++
      sheet.getCell(`K${row}`).value = box.boxNo
      if (index === 0) sheet.getCell(`L${row}`).value = 1
      sheet.getCell(`M${row}`).value = box.palletNo ?? 'BOX'
      sheet.getCell(`N${row}`).value = item.sku
      merged(`O${row}:Q${row}`, `${options.items[item.id].englishName}\n${item.productName}${item.optionName ? ` / ${item.optionName}` : ''}`)
      sheet.getCell(`R${row}`).value = allocation.quantity
      sheet.getCell(`S${row}`).value = 'ea'
      merged(`T${row}:U${row}`, '')
      merged(`V${row}:W${row}`, '')
      if (index === 0) {
        sheet.getCell(`V${row}`).value = options.boxes[box.id].grossWeightKg
        sheet.getCell(`X${row}`).value = options.boxes[box.id].cbm
      }
    }
  }
  for (const pallet of prepared.pallets) {
    const row = packingRow++
    sheet.getCell(`M${row}`).value = pallet.palletNo
    merged(`O${row}:Q${row}`, 'PALLET PACKAGING / 托盘包装')
    merged(`V${row}:W${row}`, '')
    sheet.getCell(`V${row}`).value = options.palletTareKg
    sheet.getCell(`X${row}`).value = options.palletExtraCbm
  }
  const totalRow = Math.max(20 + prepared.items.length, packingRow)
  merged(`A${totalRow}:D${totalRow}`, 'TOTAL', 11, true)
  sheet.getCell(`K${totalRow}`).value = 'TOTAL'
  sheet.getCell(`K${totalRow}`).font = { name: 'Arial', bold: true, size: 11 }
  for (const col of ['E', 'J', 'L', 'R', 'V', 'X']) {
    const result = col === 'E' || col === 'R' ? prepared.items.reduce((n, item) => n + item.quantity, 0)
      : col === 'J' ? money(prepared.items.reduce((n, item) => n + money(item.quantity * options.items[item.id].unitPriceCny), 0))
        : col === 'L' ? prepared.boxCount
          : prepared.boxes.reduce((n, box) => n + (col === 'V' ? options.boxes[box.id].grossWeightKg : options.boxes[box.id].cbm), 0)
            + prepared.palletCount * (col === 'V' ? options.palletTareKg : options.palletExtraCbm)
    sheet.getCell(`${col}${totalRow}`).value = { formula: `SUM(${col}20:${col}${totalRow - 1})`, result }
    sheet.getCell(`${col}${totalRow}`).font = { name: 'Arial', bold: true, size: 11 }
  }
  for (let row = 20; row <= totalRow; row++) {
    const descriptionLength = Math.max(sheet.getCell(`C${row}`).text.length, sheet.getCell(`O${row}`).text.length)
    sheet.getRow(row).height = row === totalRow ? 28 : Math.max(42, Math.ceil(descriptionLength / 28) * 14)
    for (let col = 1; col <= 24; col++) {
      const cell = sheet.getRow(row).getCell(col)
      if (!cell.font?.name) cell.font = { name: 'Arial', size: 10 }
      cell.alignment = { ...cell.alignment, vertical: 'middle', wrapText: true }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD4D4D8' } } }
      if (col === 22) cell.numFmt = '#,##0.000'
      if (col === 24) cell.numFmt = '0.000000'
    }
  }
  sheet.pageSetup.printArea = `A1:X${totalRow + 1}`
  const master = workbook.addWorksheet('품목정보(商品信息)')
  master.addRow(['품목코드 / SKU', '한국어 상품명 / 韩文名称', '옵션 / 规格', '영문명 / 英文名称', '중국어명 / 中文名称', 'HS CODE', '재질 / 材质', '단가(CNY) / 单价', '실제 출고수량 / 实际出库数量'])
  for (const item of prepared.items) master.addRow([item.sku, item.productName, item.optionName, options.items[item.id].englishName, item.chineseName, item.hsCode, item.material, options.items[item.id].unitPriceCny, item.quantity])
  master.columns.forEach((column, index) => { column.width = index === 1 || index === 3 || index === 4 ? 32 : 20 })
  master.getRow(1).font = { bold: true, name: 'Arial', size: 10 }
  master.getRow(1).height = 32
  master.getRow(1).alignment = { wrapText: true, vertical: 'middle' }
  master.views = [{ state: 'frozen', ySplit: 1 }]
  clearBlankExcelCells(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function money(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100 }
