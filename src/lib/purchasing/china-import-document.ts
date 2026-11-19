import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clearBlankExcelCells } from '../excel/empty-cells'
import { calculateChinaOutboundBoxCbm, dimensionNumber } from './china-outbound-dimensions'
import { calculateChinaOutboundPalletWeight, palletTareWeightKg } from './china-outbound-pallet-weight'
import type { ChinaOutboundPackingExportDetail } from './china-outbound-packing-export'
import { addImportDocumentHsSheets, type ImportDocumentSupplements } from './china-import-hs-sheets'

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

/** Compress a consecutive sequence of numeric carton numbers for the invoice. */
export function formatBoxMarks(marks: readonly string[]) {
  const normalized = marks.map((mark) => mark.trim()).filter(Boolean)
  const numbers = normalized.map((mark) => /^\d+$/.test(mark) ? Number(mark) : null)
  const numericMarks = numbers.filter((number): number is number => number !== null)
  if (numericMarks.length !== normalized.length) return normalized.join(', ')

  const sorted = [...new Set(numericMarks)].sort((left, right) => left - right)
  if (!sorted.length) return ''

  const ranges: string[] = []
  let start = sorted[0]!
  let end = start
  for (const number of sorted.slice(1)) {
    if (number === end + 1) {
      end = number
      continue
    }
    ranges.push(start === end ? String(start) : `${start}~${end}`)
    start = number
    end = number
  }
  ranges.push(start === end ? String(start) : `${start}~${end}`)
  return ranges.join(', ')
}

export function prepareImportDocument(detail: ImportDocumentDetail, metadata: Map<string, ImportItemMetadata>) {
  if (detail.shipment.status === 'cancelled') throw new Error('취소된 출고작업은 인보이스·패킹리스트를 만들 수 없습니다.')
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
      throw new Error(`${item.sku}: 박스에 저장된 수량이 출고수량과 같아야 인보이스·패킹리스트를 만들 수 있습니다.`)
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
      chineseName: item.chineseProductName || metadata.get(item.sku.trim())?.chineseName || '',
    })),
    boxes: boxes.map((box) => ({
      id: box.id, boxNo: box.boxNo, palletId: box.palletId,
      palletNo: box.palletId ? palletById.get(box.palletId)!.palletNo : null,
      grossWeightKg: dimensionNumber(box.grossWeightKg), cbm: calculateChinaOutboundBoxCbm(box),
    })),
    pallets: pallets.map((pallet) => ({ ...pallet, tareWeightKg: palletTareWeightKg(pallet.tareWeightKg) })),
    boxCount: boxes.length, palletCount: pallets.length, looseBoxCount,
    packageCount: pallets.length + looseBoxCount,
  }
}

export async function exportChinaImportDocument(
  detail: ImportDocumentDetail,
  metadata: Map<string, ImportItemMetadata>,
  options: ImportDocumentOptions,
  supplements: ImportDocumentSupplements = {},
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
    if (!override || !Number.isFinite(override.grossWeightKg) || override.grossWeightKg < 0.001 || override.grossWeightKg > 999_999_999
      || !Number.isFinite(override.cbm) || override.cbm <= 0) throw new Error(`${box.boxNo}: 총중량과 CBM을 입력해주세요.`)
  }
  // The supplied INV/PL workbook owns every header, merge, width, font and
  // print setting. Only shipment values and the variable packing groups change.
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await readFile(join(process.cwd(), 'src/lib/purchasing/templates/china-invoice-packing-list.xlsx')) as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  // The source template merges the invoice description header across C:D.
  // Keep the commercial invoice layout, but use D for the per-item HS code
  // that comes from the item master's 통관·인증 field.
  sheet.unMergeCells('C18:D18')
  sheet.getCell('C18').value = 'NAME'
  sheet.getCell('D18').value = 'HS CODE'
  sheet.getCell('D18').style = structuredClone(sheet.getCell('C18').style)
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
      if (group.id && values.length) {
        const pallet = prepared.pallets.find((pallet) => pallet.id === group.id)!
        const weight = calculateChinaOutboundPalletWeight(prepared.boxes.filter((box) => box.palletId === group.id)
          .map((box) => ({ id: box.id, grossWeightKg: options.boxes[box.id].grossWeightKg })), pallet.tareWeightKg)
        for (const row of values) row.gross = 0
        values[0].gross = weight.grossWeightKg!
      }
      return { ...group, rows: values }
    }).filter((group) => group.rows.length)
  // Invoice rows describe goods, while packing rows describe their physical
  // locations. Sum a SKU across every location and place it at its largest group.
  type InvoiceRow = { itemId: string; quantity: number; marks: string[]; groupIndex: number; groupQuantity: number }
  const invoiceBySku = new Map<string, InvoiceRow>()
  for (const [groupIndex, group] of groups.entries()) {
    const groupBySku = new Map<string, { itemId: string; quantity: number; marks: string[] }>()
    for (const trade of group.rows) {
      const item = itemById.get(trade.itemId)!
      const sku = item.sku.trim()
      const source = options.items[item.id]
      const previous = groupBySku.get(sku) ?? invoiceBySku.get(sku)
      if (previous) {
        const previousSource = options.items[previous.itemId]
        if (source.englishName.trim() !== previousSource.englishName.trim() || source.unitPriceCny !== previousSource.unitPriceCny) {
          throw new Error(`${sku}: 동일 품목의 영문명과 위안화 단가를 같게 입력해주세요.`)
        }
      }
      const groupRow = groupBySku.get(sku) ?? { itemId: item.id, quantity: 0, marks: [] }
      groupRow.quantity += trade.quantity
      groupRow.marks.push(...trade.marks)
      groupBySku.set(sku, groupRow)
    }
    for (const [sku, groupRow] of groupBySku) {
      const invoice = invoiceBySku.get(sku)
      if (!invoice) {
        invoiceBySku.set(sku, { ...groupRow, marks: [...groupRow.marks], groupIndex, groupQuantity: groupRow.quantity })
        continue
      }
      invoice.quantity += groupRow.quantity
      invoice.marks.push(...groupRow.marks)
      // Keep the existing pallet order when quantities tie.
      if (groupRow.quantity > invoice.groupQuantity) {
        invoice.itemId = groupRow.itemId
        invoice.groupIndex = groupIndex
        invoice.groupQuantity = groupRow.quantity
      }
    }
  }
  const invoiceRows = [...invoiceBySku.values()].sort((a, b) => a.groupIndex - b.groupIndex)
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0)
  const extra = Math.max(0, count - 92)
  if (extra) sheet.duplicateRow(111, extra, true)
  const totalRow = 112 + extra
  // The reference was saved with product rows filtered out. Those old visibility
  // settings must not hide the new shipment's goods.
  sheet.autoFilter = undefined
  for (let row = 20; row <= totalRow; row++) {
    sheet.getRow(row).hidden = false
    if (row < totalRow) {
      for (let column = 1; column <= 10; column++) sheet.getRow(row).getCell(column).value = null
    }
  }
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
  for (const group of groups) {
    const start = nextRow
    for (const trade of group.rows) {
      const row = nextRow++
      const item = itemById.get(trade.itemId)!
      const marks = [...new Set(trade.marks)]
      const markText = formatBoxMarks(marks)
      for (let column = 1; column <= 25; column++) sheet.getRow(row).getCell(column).style = structuredClone(rowStyle[column - 1])
      sheet.getRow(row).height = 21
      sheet.getCell(`K${row}`).value = markText.length > 60 ? `MULTIPLE (${marks.length} CTN)` : markText
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
  let totalAmount = 0
  for (const [index, invoice] of invoiceRows.entries()) {
    const row = 20 + index
    const item = itemById.get(invoice.itemId)!
    const source = options.items[item.id]
    const marks = [...new Set(invoice.marks)]
    const markText = formatBoxMarks(marks)
    sheet.getCell(`A${row}`).value = markText.length > 60 ? `MULTIPLE (${marks.length} CTN)` : markText
    sheet.getCell(`B${row}`).value = groups[invoice.groupIndex].no
    sheet.getCell(`C${row}`).value = source.englishName
    // Keep this as text. HS codes can contain punctuation or leading zeroes.
    sheet.getCell(`D${row}`).value = item.hsCode || null
    sheet.getCell(`E${row}`).value = invoice.quantity
    sheet.getCell(`F${row}`).value = 'ea'
    sheet.getCell(`G${row}`).value = source.unitPriceCny
    const amount = money(invoice.quantity * source.unitPriceCny)
    totalAmount += amount
    sheet.getCell(`J${row}`).value = { formula: `ROUND(G${row}*E${row},2)`, result: amount }
  }
  const totalQuantity = prepared.items.reduce((sum, item) => sum + item.quantity, 0)
  const grossWeight = prepared.boxes.filter((box) => !box.palletId).reduce((sum, box) => sum + options.boxes[box.id].grossWeightKg, 0)
    + prepared.pallets.reduce((sum, pallet) => sum + calculateChinaOutboundPalletWeight(prepared.boxes.filter((box) => box.palletId === pallet.id)
      .map((box) => ({ id: box.id, grossWeightKg: options.boxes[box.id].grossWeightKg })), pallet.tareWeightKg).grossWeightKg!, 0)
  // A loaded pallet is one external package. Its dimensions are measured as
  // a whole; its weight is the boxes plus the saved pallet packaging tare.
  const totalCbm = prepared.boxes.filter((box) => !box.palletId).reduce((sum, box) => sum + options.boxes[box.id].cbm, 0)
    + prepared.pallets.reduce((sum, pallet) => sum + (calculateChinaOutboundBoxCbm(pallet)
      ?? prepared.boxes.filter((box) => box.palletId === pallet.id).reduce((boxSum, box) => boxSum + options.boxes[box.id].cbm, options.palletExtraCbm)), 0)
  const totals: Record<string, number> = { E: totalQuantity, J: money(totalAmount), O: prepared.packageCount, V: grossWeight }
  for (const [column, result] of Object.entries(totals)) sheet.getCell(`${column}${totalRow}`).value = { formula: `SUM(${column}20:${column}${totalRow - 1})`, result }
  sheet.getCell(`A${totalRow}`).value = 'TOTAL'
  sheet.getCell(`I${totalRow}`).value = 'RMB'
  sheet.getCell(`P${totalRow}`).value = 'CTN'
  sheet.getCell(`W${totalRow}`).value = 'KG'
  sheet.getCell(`X${totalRow}`).value = totalCbm
  sheet.pageSetup.printArea = `A1:X${totalRow + 1}`
  addImportDocumentHsSheets(workbook, invoiceRows.map((invoice) => {
    const item = itemById.get(invoice.itemId)!
    return { sku: item.sku, productName: item.productName, optionName: item.optionName,
      englishName: options.items[item.id].englishName, quantity: invoice.quantity, hsCode: item.hsCode }
  }), supplements)
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
