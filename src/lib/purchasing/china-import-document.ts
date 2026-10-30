import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  // The supplied INV/PL workbook owns every header, merge, width, font and
  // print setting. Only shipment values and the variable packing groups change.
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await readFile(join(process.cwd(), 'src/lib/purchasing/templates/china-invoice-packing-list.xlsx')) as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  const rowStyle = Array.from({ length: 25 }, (_, index) => structuredClone(sheet.getRow(20).getCell(index + 1).style))
  for (const range of [...sheet.model.merges]) {
    if (/^O\d+:O\d+$/.test(range) && Number(range.match(/\d+/)![0]) >= 20) sheet.unMergeCells(range)
  }
  const itemById = new Map(prepared.items.map((item) => [item.id, item]))
  type TradeRow = { itemId: string; quantity: number; marks: string[]; boxCount: number; gross: number }
  const groups = [...prepared.pallets.map((pallet) => ({ id: pallet.id as string | null, no: pallet.palletNo })), { id: null, no: 'box' }]
    .map((group) => {
      const rows = new Map<string, TradeRow>()
      for (const box of prepared.boxes.filter((box) => box.palletId === group.id)) {
        for (const [index, allocation] of detail.boxItems.filter((a) => a.boxId === box.id).entries()) {
          const row = rows.get(allocation.shipmentItemId) ?? { itemId: allocation.shipmentItemId, quantity: 0, marks: [], boxCount: 0, gross: 0 }
          row.quantity += allocation.quantity
          row.marks.push(box.boxNo)
          if (index === 0) { row.boxCount += 1; row.gross += options.boxes[box.id].grossWeightKg }
          rows.set(row.itemId, row)
        }
      }
      const values = [...rows.values()]
      if (group.id && values.length) values[0].gross += options.palletTareKg
      return { ...group, rows: values }
    }).filter((group) => group.rows.length)
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0)
  const extra = Math.max(0, count - 92)
  if (extra) sheet.duplicateRow(111, extra, true)
  const totalRow = 112 + extra
  // The reference was saved with product rows filtered out. Those old visibility
  // settings must not hide the new shipment's goods.
  sheet.autoFilter = undefined
  for (let row = 20; row <= totalRow; row++) sheet.getRow(row).hidden = false
  for (const [address, value] of Object.entries({
    A3: options.exporter, K3: options.exporter,
    E3: `${options.invoiceNo}/ ${options.invoiceDate}`, R3: `${options.invoiceNo}/ ${options.invoiceDate}`,
    A8: options.importer, K8: options.importer,
    A9: options.importerAddress.split('\n')[0], K9: options.importerAddress.split('\n')[0],
    A10: options.importerAddress.split('\n').slice(1).join(' '), K10: options.importerAddress.split('\n').slice(1).join(' '),
    E14: options.paymentTerms, A15: options.loadingPort, K15: options.loadingPort,
    O15: options.destinationPort,
    R14: `${prepared.palletCount}plt + ${prepared.looseBoxCount}ctn`, W14: prepared.packageCount, X14: 'CTN',
  })) sheet.getCell(address).value = value
  for (const address of ['C17', 'O17']) sheet.getCell(address).value = new Date(`${options.sailingDate}T00:00:00Z`)
  let nextRow = 20
  let totalAmount = 0
  for (const group of groups) {
    const start = nextRow
    for (const trade of group.rows) {
      const row = nextRow++
      const item = itemById.get(trade.itemId)!
      const source = options.items[item.id]
      const marks = [...new Set(trade.marks)]
      const markText = marks.join(', ')
      for (let column = 1; column <= 25; column++) sheet.getRow(row).getCell(column).style = structuredClone(rowStyle[column - 1])
      sheet.getRow(row).height = 21
      for (const column of ['A', 'K']) sheet.getCell(`${column}${row}`).value = markText.length > 60 ? `MULTIPLE (${marks.length} CTN)` : markText
      sheet.getCell(`B${row}`).value = group.no
      sheet.getCell(`C${row}`).value = source.englishName
      sheet.getCell(`E${row}`).value = trade.quantity
      sheet.getCell(`F${row}`).value = 'ea'
      sheet.getCell(`G${row}`).value = source.unitPriceCny
      const amount = money(trade.quantity * source.unitPriceCny)
      totalAmount += amount
      sheet.getCell(`J${row}`).value = { formula: `ROUND(G${row}*E${row},2)`, result: amount }
      sheet.getCell(`L${row}`).value = trade.boxCount || null
      sheet.getCell(`M${row}`).value = group.no
      sheet.getCell(`O${row}`).value = group.id ? (row === start ? 1 : null) : trade.boxCount || null
      sheet.getCell(`R${row}`).value = trade.quantity
      sheet.getCell(`S${row}`).value = 'ea'
      sheet.getCell(`V${row}`).value = trade.gross || null
      sheet.getCell(`W${row}`).value = 'kg'
      sheet.getCell(`Y${row}`).value = item.productName
    }
    if (group.id && nextRow - start > 1) sheet.mergeCells(`O${start}:O${nextRow - 1}`)
  }
  const totalQuantity = prepared.items.reduce((sum, item) => sum + item.quantity, 0)
  const grossWeight = prepared.boxes.reduce((sum, box) => sum + options.boxes[box.id].grossWeightKg, 0) + prepared.palletCount * options.palletTareKg
  const totalCbm = prepared.boxes.reduce((sum, box) => sum + options.boxes[box.id].cbm, 0) + prepared.palletCount * options.palletExtraCbm
  const totals: Record<string, number> = { E: totalQuantity, J: money(totalAmount), O: prepared.packageCount, V: grossWeight }
  for (const [column, result] of Object.entries(totals)) sheet.getCell(`${column}${totalRow}`).value = { formula: `SUM(${column}20:${column}${totalRow - 1})`, result }
  sheet.getCell(`A${totalRow}`).value = 'TOTAL'
  sheet.getCell(`I${totalRow}`).value = 'RMB'
  sheet.getCell(`P${totalRow}`).value = 'CTN'
  sheet.getCell(`W${totalRow}`).value = 'KG'
  sheet.getCell(`X${totalRow}`).value = totalCbm
  sheet.pageSetup.printArea = `A1:X${totalRow + 1}`
  clearBlankExcelCells(workbook)
  // ExcelJS resets the Normal font to Calibri on write. Excel measures column
  // widths using that font, so restore the reference's Dotum font as well.
  const archive = await JSZip.loadAsync(await workbook.xlsx.writeBuffer())
  const styles = await archive.file('xl/styles.xml')!.async('string')
  archive.file('xl/styles.xml', styles.replace(/(<fonts\b[^>]*>)<font>.*?<\/font>/s,
    '$1<font><sz val="11"/><color rgb="FF000000"/><name val="돋움"/><charset val="134"/></font>'))
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function money(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100 }
