import ExcelJS from 'exceljs'
import type { ImportDocumentDetail } from './china-import-document'
import { koreaShippingRows, formatKoreaBoxNumbers } from './korea-shipping-rows'
export { koreaShippingRows, formatKoreaBoxNumbers } from './korea-shipping-rows'

export async function exportKoreaShippingDocument(detail: ImportDocumentDetail, first: 'pallet' | 'box' = 'pallet', title?: string) {
  const workbook = new ExcelJS.Workbook()
  for (const by of [first, first === 'pallet' ? 'box' : 'pallet'] as const) {
    const sheet = workbook.addWorksheet(by === 'pallet' ? '파레트별 한국 출고서류' : '박스별 한국 출고서류')
    const headers = ['파레트', '박스번호', '박스수', '품목코드', '상품명', '옵션', '수량', '창고', '쿠팡', '대량', '로케이션', 'CBM (m³)', '총중량(kg)']
    sheet.mergeCells('A1:M1')
    sheet.getCell('A1').value = title ?? `${detail.shipment.plannedOutboundDate ?? ''} 한국 출고서류 · ${detail.shipment.shipmentNo}`
    sheet.getCell('A1').font = { bold: true, size: 16 }
    sheet.addRow(headers)
    const widths = [12, 28, 10, 20, 38, 24, 12, 12, 12, 12, 22, 14, 16]
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    const counted = new Set<string>()
    for (const row of koreaShippingRows(detail, by)) {
      const physical = row.boxes.filter((box) => !counted.has(box))
      physical.forEach((box) => counted.add(box))
      sheet.addRow([row.pallet, formatKoreaBoxNumbers(row.boxes), physical.length || null, row.sku, row.name, row.option, row.quantity, row.warehouse || null, row.coupang || null, row.bulk || null, row.location, row.cbm || null, Math.round(row.weight * 1000000) / 1000000 || null])
    }
    sheet.getColumn('L').numFmt = '0.0000'
    sheet.getColumn('M').numFmt = '#,##0'
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
    for (const column of ['C', 'G', 'H', 'I', 'J', 'L', 'M']) {
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
    sheet.autoFilter = `A2:M${last}`
    sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:M${sheet.rowCount}`, printTitlesRow: '1:2' }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
