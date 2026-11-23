import { importDocumentProductCode, type ImportDocumentEditCells } from './china-import-editing'
import { resolveChinaLooseBoxes } from './china-pallet-number'
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
  items: Record<string, { englishName: string; unitPriceCny: number; hsCode?: string }>
  boxes: Record<string, { grossWeightKg: number; cbm: number | null }>
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

export { importDocumentProductCode } from './china-import-editing'

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

function documentBoxMarks(marks: string[]) {
  const unique = [...new Set(marks)]
  const text = formatBoxMarks(unique)
  return text.length > 60 ? `MULTIPLE (${unique.length} CTN)` : text
}

export function prepareImportDocument(detail: ImportDocumentDetail, metadata: Map<string, ImportItemMetadata>) {
  detail = { ...detail, ...resolveChinaLooseBoxes(detail.pallets, detail.boxes) }
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
  preview = false,
  editCells?: ImportDocumentEditCells,
) {
  detail = { ...detail, ...resolveChinaLooseBoxes(detail.pallets, detail.boxes) }
  const prepared = prepareImportDocument(detail, metadata)
  for (const item of prepared.items) {
    const override = options.items[item.id]
    if (!preview && (!override?.englishName.trim() || !Number.isFinite(override.unitPriceCny) || override.unitPriceCny < 0)) {
      throw new Error(`${item.sku}: 영문명과 위안화 단가를 확인해주세요.`)
    }
  }
  for (const box of prepared.boxes) {
    const override = options.boxes[box.id]
    const pallet = prepared.pallets.find((pallet) => pallet.id === box.palletId)
    const needsBoxCbm = !pallet || calculateChinaOutboundBoxCbm(pallet) == null
    if (!preview && (!override || !Number.isFinite(override.grossWeightKg) || override.grossWeightKg < 0.001 || override.grossWeightKg > 999_999_999
      || (needsBoxCbm && (override.cbm == null || !Number.isFinite(override.cbm) || override.cbm <= 0)))) throw new Error(`${box.boxNo}: 총중량과 CBM을 입력해주세요.`)
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
  const exactProducts = new Map<string, { quantity: number; englishName: string; unitPriceCny: number }>()
  const hsByProduct = new Map<string, string>()
  for (const item of prepared.items) {
    const sku = item.sku.trim(), source = options.items[item.id]
    const previous = exactProducts.get(sku)
    if (previous && !preview && (source.englishName.trim() !== previous.englishName.trim() || source.unitPriceCny !== previous.unitPriceCny)) throw new Error(`${sku}: 동일 품목의 영문명과 위안화 단가를 같게 입력해주세요.`)
    exactProducts.set(sku, { ...source, quantity: (previous?.quantity ?? 0) + item.quantity })
    const product = importDocumentProductCode(sku), hs = (source.hsCode ?? item.hsCode).trim()
    if (!preview && hs && hsByProduct.has(product) && hsByProduct.get(product) !== hs) throw new Error(`${product}: 옵션별 HS CODE가 다릅니다. 품목정보를 확인해주세요.`)
    if (hs) hsByProduct.set(product, hs)
  }
  // Preserve the original option-level rounded amounts when combining options.
  const amountByProduct = new Map<string, number>()
  const pricesByProduct = new Map<string, Set<number>>()
  for (const [sku, item] of exactProducts) {
    const product = importDocumentProductCode(sku)
    if (!pricesByProduct.has(product)) pricesByProduct.set(product, new Set())
    pricesByProduct.get(product)!.add(item.unitPriceCny)
    amountByProduct.set(product, (amountByProduct.get(product) ?? 0) + money(item.quantity * item.unitPriceCny))
  }
  const itemById = new Map(prepared.items.map((item) => [item.id, item]))
  type TradeRow = { itemId: string; quantity: number; marks: string[]; boxCount: number; gross: number }
  const groups = [...prepared.pallets.map((pallet) => ({ id: pallet.id as string | null, no: pallet.palletNo })), { id: null, no: 'box' }]
    .map((group) => {
      const rows = new Map<string, TradeRow>()
      for (const box of prepared.boxes.filter((box) => box.palletId === group.id)) {
        for (const [index, allocation] of detail.boxItems.filter((a) => a.boxId === box.id).entries()) {
          const product = importDocumentProductCode(itemById.get(allocation.shipmentItemId)!.sku)
          const row = rows.get(product) ?? { itemId: allocation.shipmentItemId, quantity: 0, marks: [], boxCount: 0, gross: 0 }
          row.quantity += allocation.quantity
          row.marks.push(box.boxNo)
          if (index === 0) { row.boxCount += 1; row.gross += options.boxes[box.id].grossWeightKg }
          rows.set(product, row)
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
      const sku = importDocumentProductCode(item.sku)
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
  // The two documents share one product order. Keep all physical locations on
  // that row rather than repeating a product once for every pallet it occupies.
  const packingByProduct = new Map<string, { boxCount: number; packageCount: number; gross: number; locations: string[] }>()
  for (const group of groups) {
    for (const [index, trade] of group.rows.entries()) {
      const product = importDocumentProductCode(itemById.get(trade.itemId)!.sku)
      const row = packingByProduct.get(product) ?? { boxCount: 0, packageCount: 0, gross: 0, locations: [] }
      row.boxCount += trade.boxCount
      row.packageCount += group.id ? (index === 0 ? 1 : 0) : trade.boxCount
      row.gross += trade.gross
      if (!row.locations.includes(group.no)) row.locations.push(group.no)
      packingByProduct.set(product, row)
    }
  }
  const count = invoiceRows.length
  const extra = Math.max(0, count - 92)
  if (extra) sheet.duplicateRow(111, extra, true)
  const totalRow = 112 + extra
  // The reference was saved with product rows filtered out. Those old visibility
  // settings must not hide the new shipment's goods.
  sheet.autoFilter = undefined
  for (let row = 20; row <= totalRow; row++) {
    sheet.getRow(row).hidden = false
    if (row < totalRow) {
      for (let column = 1; column <= 25; column++) sheet.getRow(row).getCell(column).value = null
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
  if (editCells) {
    const field = (key: string, label: string, value: string, type: 'text' | 'date' = 'text') => ({ key, label, value, type })
    for (const [addresses, key, label] of [
      [['A3', 'K3'], 'exporter', '수출자'], [['A8', 'K8'], 'importer', '수입자'],
      [['A15', 'K15'], 'loadingPort', '출발항'], [['O15'], 'destinationPort', '도착항'], [['E14'], 'paymentTerms', '결제조건'],
    ] as const) for (const address of addresses) editCells[address] = [field(key, label, options[key])]
    for (const address of ['E3', 'R3']) editCells[address] = [field('invoiceNo', '문서번호', options.invoiceNo), field('invoiceDate', '문서일자', options.invoiceDate, 'date')]
    for (const address of ['C17', 'O17']) editCells[address] = [field('sailingDate', '선적일', options.sailingDate, 'date')]
    for (const address of ['A9', 'K9']) editCells[address] = [field('importerAddress1', '수입자 주소 첫째 줄', options.importerAddress.split('\n')[0])]
    for (const address of ['A10', 'K10']) editCells[address] = [field('importerAddress2', '수입자 주소 둘째 줄', options.importerAddress.split('\n').slice(1).join(' '))]
  }
  for (const address of ['C17', 'O17']) sheet.getCell(address).value = new Date(`${options.sailingDate}T00:00:00Z`)
  for (const [index, invoice] of invoiceRows.entries()) {
    const row = 20 + index
    const item = itemById.get(invoice.itemId)!
    const packing = packingByProduct.get(importDocumentProductCode(item.sku))!
    for (let column = 1; column <= 25; column++) sheet.getRow(row).getCell(column).style = structuredClone(rowStyle[column - 1])
    sheet.getRow(row).height = 21
    sheet.getCell(`K${row}`).value = documentBoxMarks(invoice.marks)
    sheet.getCell(`L${row}`).value = packing.boxCount || null
    sheet.getCell(`M${row}`).value = packing.locations.join(', ')
    sheet.getCell(`O${row}`).value = packing.packageCount || null
    sheet.getCell(`R${row}`).value = invoice.quantity
    sheet.getCell(`S${row}`).value = 'ea'
    sheet.getCell(`V${row}`).value = packing.gross || null
    sheet.getCell(`W${row}`).value = 'kg'
    sheet.getCell(`Y${row}`).value = item.productName
  }
  let totalAmount = 0
  for (const [index, invoice] of invoiceRows.entries()) {
    const row = 20 + index
    const item = itemById.get(invoice.itemId)!
    const source = options.items[item.id]
    sheet.getCell(`A${row}`).value = documentBoxMarks(invoice.marks)
    sheet.getCell(`B${row}`).value = groups[invoice.groupIndex].no
    sheet.getCell(`C${row}`).value = source.englishName
    // Keep this as text. HS codes can contain punctuation or leading zeroes.
    sheet.getCell(`D${row}`).value = hsByProduct.get(importDocumentProductCode(item.sku)) || null
    sheet.getCell(`E${row}`).value = invoice.quantity
    sheet.getCell(`F${row}`).value = 'ea'
    const amount = money(amountByProduct.get(importDocumentProductCode(item.sku)) ?? Number.NaN)
    const mixedPrices = (pricesByProduct.get(importDocumentProductCode(item.sku))?.size ?? 0) > 1
    const unitPrice = mixedPrices ? amount / invoice.quantity : source.unitPriceCny
    sheet.getCell(`G${row}`).value = Number.isFinite(unitPrice) ? unitPrice : null
    sheet.getCell(`G${row}`).numFmt = '#,##0.00'
    if (editCells) {
      const product = importDocumentProductCode(item.sku)
      editCells[`C${row}`] = [{ key: `product:${product}:englishName`, label: `${product} 영문명`, value: source.englishName }]
      editCells[`D${row}`] = [{ key: `product:${product}:hsCode`, label: `${product} HS CODE`, value: hsByProduct.get(product) ?? '' }]
      editCells[`G${row}`] = [{ key: `product:${product}:unitPriceCny`, label: `${product} Unit Price`, value: Number.isFinite(unitPrice) ? unitPrice.toFixed(2) : '', type: 'number' }]
    }
    totalAmount += amount
    sheet.getCell(`J${row}`).value = Number.isFinite(amount) ? { formula: `ROUND(G${row}*E${row},2)`, result: amount } : null
  }
  const totalQuantity = prepared.items.reduce((sum, item) => sum + item.quantity, 0)
  const grossWeight = prepared.boxes.filter((box) => !box.palletId).reduce((sum, box) => sum + options.boxes[box.id].grossWeightKg, 0)
    + prepared.pallets.reduce((sum, pallet) => sum + calculateChinaOutboundPalletWeight(prepared.boxes.filter((box) => box.palletId === pallet.id)
      .map((box) => ({ id: box.id, grossWeightKg: options.boxes[box.id].grossWeightKg })), pallet.tareWeightKg).grossWeightKg!, 0)
  // A loaded pallet is one external package. Its dimensions are measured as
  // a whole; its weight is the boxes plus the saved pallet packaging tare.
  const totalCbm = prepared.boxes.filter((box) => !box.palletId).reduce((sum, box) => sum + (options.boxes[box.id].cbm ?? Number.NaN), 0)
    + prepared.pallets.reduce((sum, pallet) => sum + (calculateChinaOutboundBoxCbm(pallet)
      ?? prepared.boxes.filter((box) => box.palletId === pallet.id).reduce((boxSum, box) => boxSum + (options.boxes[box.id].cbm ?? Number.NaN), options.palletExtraCbm)), 0)
  const totals: Record<string, number> = { E: totalQuantity, J: money(totalAmount), O: prepared.packageCount, R: totalQuantity, V: grossWeight }
  for (const [column, result] of Object.entries(totals)) sheet.getCell(`${column}${totalRow}`).value = Number.isFinite(result) ? { formula: `SUM(${column}20:${column}${totalRow - 1})`, result } : null
  sheet.getCell(`A${totalRow}`).value = 'TOTAL'
  sheet.getCell(`I${totalRow}`).value = 'RMB'
  sheet.getCell(`P${totalRow}`).value = 'CTN'
  sheet.getCell(`W${totalRow}`).value = 'KG'
  sheet.getCell(`X${totalRow}`).value = Number.isFinite(totalCbm) ? totalCbm : null
  if (prepared.boxes.some((box) => !Number.isFinite(options.boxes[box.id]?.grossWeightKg))) sheet.getCell(`V${totalRow}`).value = null
  sheet.getCell('Y18').value = '상품명 (확인용)'
  sheet.getColumn('Y').width = 36
  sheet.getColumn('Y').hidden = true
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
