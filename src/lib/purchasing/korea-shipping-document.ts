import ExcelJS from 'exceljs'
import type { ImportDocumentDetail } from './china-import-document'
import { resolveChinaLooseBoxes } from './china-pallet-number'

export function koreaShippingRows(source: ImportDocumentDetail, by: 'pallet' | 'box') {
  const detail = { ...source, ...resolveChinaLooseBoxes(source.pallets, source.boxes) }
  const items = new Map(detail.items.map((item) => [item.id, item]))
  const pallets = new Map(detail.pallets.map((pallet) => [pallet.id, pallet.palletNo]))
  const rows = new Map<string, { pallet: string; boxes: Set<string>; sku: string; name: string; option: string; quantity: number; warehouse: number; coupang: number; bulk: number; location: string }>()
  for (const box of detail.boxes) {
    for (const line of detail.boxItems.filter((line) => line.boxId === box.id && line.quantity > 0)) {
      const item = items.get(line.shipmentItemId)
      if (!item) continue
      const pallet = box.palletId ? pallets.get(box.palletId) ?? 'BOX' : 'BOX'
      const key = JSON.stringify([by === 'box' ? box.id : pallet, item.sku])
      const row = rows.get(key) ?? { pallet, boxes: new Set<string>(), sku: item.sku, name: item.productName, option: item.optionName ?? '', quantity: 0, warehouse: 0, coupang: 0, bulk: 0, location: item.location ?? '' }
      row.location = [...new Set([row.location, item.location ?? ''].flatMap((value) => value.split(', ')).filter(Boolean))].join(', ')
      row.quantity += line.quantity
      row.boxes.add(box.boxNo)
      const category = /쿠팡|로켓/.test(item.warehouseCode) ? 'coupang' : /대량/.test(item.warehouseCode) ? 'bulk' : 'warehouse'
      row[category] += line.quantity
      rows.set(key, row)
    }
  }
  const collator = new Intl.Collator('ko-KR', { numeric: true })
  return [...rows.values()].sort((a, b) => Number(a.pallet === 'BOX') - Number(b.pallet === 'BOX') || collator.compare(a.pallet, b.pallet) || collator.compare([...a.boxes][0], [...b.boxes][0]) || collator.compare(a.sku, b.sku))
    .map((row) => ({ ...row, boxes: [...row.boxes].sort(collator.compare) }))
}

export async function exportKoreaShippingDocument(detail: ImportDocumentDetail, first: 'pallet' | 'box' = 'pallet') {
  const workbook = new ExcelJS.Workbook()
  for (const by of [first, first === 'pallet' ? 'box' : 'pallet'] as const) {
    const sheet = workbook.addWorksheet(by === 'pallet' ? '파레트별 한국 출고서류' : '박스별 한국 출고서류')
    const headers = ['파레트', '박스번호', '박스수', '품목코드', '상품명', '옵션', '수량', '창고', '쿠팡', '대량', '로케이션']
    sheet.mergeCells('A1:K1')
    sheet.getCell('A1').value = `${detail.shipment.plannedOutboundDate ?? ''} 한국 출고서류 · ${detail.shipment.shipmentNo}`
    sheet.getCell('A1').font = { bold: true, size: 16 }
    sheet.addRow(headers)
    const widths = [12, 28, 10, 20, 38, 24, 12, 12, 12, 12, 22]
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    const counted = new Set<string>()
    for (const row of koreaShippingRows(detail, by)) {
      const physical = row.boxes.filter((box) => !counted.has(box))
      physical.forEach((box) => counted.add(box))
      sheet.addRow([row.pallet, row.boxes.join(', '), physical.length || null, row.sku, row.name, row.option, row.quantity, row.warehouse || null, row.coupang || null, row.bulk || null, row.location])
    }
    const last = sheet.rowCount
    // Preserve each physical pallet as one vertically merged group in both views.
    let start = 3
    while (start <= last) {
      const pallet = sheet.getCell(`A${start}`).value
      let end = start
      while (end < last && sheet.getCell(`A${end + 1}`).value === pallet) end++
      if (pallet !== 'BOX' && end > start) sheet.mergeCells(start, 1, end, 1)
      start = end + 1
    }
    const total = sheet.addRow(['합계'])
    for (const column of ['C', 'G', 'H', 'I', 'J']) {
      let sum = 0
      for (let row = 3; row <= last; row++) sum += Number(sheet.getCell(`${column}${row}`).value) || 0
      sheet.getCell(`${column}${total.number}`).value = { formula: `SUM(${column}3:${column}${last})`, result: sum }
    }
    sheet.eachRow((row, index) => {
      row.height = index === 1 ? 32 : 26
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { vertical: 'middle', wrapText: true }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFD4D4D8' } } }
        if (index === 2 || index === total.number) { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EDF2' } } }
      })
    })
    sheet.views = [{ state: 'frozen', ySplit: 2 }]
    sheet.autoFilter = `A2:K${last}`
    sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:K${sheet.rowCount}`, printTitlesRow: '1:2' }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
