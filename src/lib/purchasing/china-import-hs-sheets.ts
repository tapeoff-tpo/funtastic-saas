import type ExcelJS from 'exceljs'

export type ImportDocumentProductImage =
  | { buffer: Buffer; width: number; height: number }
  | { error: 'missing' | 'unavailable' }

export type ImportDocumentHsItem = {
  sku: string
  productName: string
  optionName?: string | null
  englishName: string
  quantity: number
  hsCode: string
}

export type ImportDocumentSupplements = {
  productImages?: Map<string, ImportDocumentProductImage>
  existingHsItems?: Array<Pick<ImportDocumentHsItem, 'sku' | 'productName' | 'optionName' | 'hsCode'>>
}

export function addImportDocumentHsSheets(
  workbook: ExcelJS.Workbook,
  items: ImportDocumentHsItem[],
  supplements: ImportDocumentSupplements,
) {
  const missing = items.filter((item) => !item.hsCode.trim())
  const newSheet = workbook.addWorksheet('신상품_HS미등록')
  newSheet.columns = [
    { header: '이미지', key: 'image', width: 25 },
    { header: '품목코드', key: 'sku', width: 20 },
    { header: '상품명', key: 'productName', width: 34 },
    { header: '옵션', key: 'optionName', width: 22 },
    { header: '영문명', key: 'englishName', width: 34 },
    { header: '수량', key: 'quantity', width: 12 },
    { header: 'HS CODE', key: 'hsCode', width: 20 },
  ]
  for (const item of missing) {
    const image = supplements.productImages?.get(item.sku.trim())
    const row = newSheet.addRow({ ...item, sku: item.sku.trim(), hsCode: null,
      image: image && 'buffer' in image ? null : image?.error === 'unavailable' ? '이미지 불러오기 실패' : '이미지 없음' })
    row.height = 105
    row.getCell('quantity').numFmt = '#,##0'
    row.getCell('sku').numFmt = '@'
    row.getCell('hsCode').numFmt = '@'
    if (image && 'buffer' in image) {
      const imageId = workbook.addImage({ buffer: image.buffer as unknown as ExcelJS.Buffer, extension: 'png' })
      newSheet.addImage(imageId, {
        tl: { col: 0.08, row: row.number - 1 + 0.06 },
        ext: { width: image.width, height: image.height },
        editAs: 'oneCell',
      })
    }
  }
  formatListSheet(newSheet, 7, 'HS CODE 미등록 상품이 없습니다.')

  const existingSheet = workbook.addWorksheet('기존_HS코드')
  existingSheet.columns = [
    { header: '품목코드', key: 'sku', width: 22 },
    { header: '상품명', key: 'productName', width: 44 },
    { header: '옵션', key: 'optionName', width: 28 },
    { header: 'HS CODE', key: 'hsCode', width: 24 },
  ]
  const existingBySku = new Map((supplements.existingHsItems ?? items)
    .filter((item) => item.hsCode.trim())
    .map((item) => [item.sku.trim(), item]))
  for (const [sku, item] of existingBySku) {
    const row = existingSheet.addRow({ ...item, sku, hsCode: item.hsCode.trim() })
    row.height = Math.max(30, Math.ceil(item.productName.length / 22) * 15)
    row.getCell('sku').numFmt = '@'
    row.getCell('hsCode').numFmt = '@'
  }
  formatListSheet(existingSheet, 4, 'HS CODE가 등록된 상품이 없습니다.')
}

function formatListSheet(sheet: ExcelJS.Worksheet, columns: number, emptyText: string) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: columns } }
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' }
  sheet.getRow(1).height = 28
  sheet.eachRow((row, rowNumber) => {
    for (let column = 1; column <= columns; column++) {
      const cell = row.getCell(column)
      cell.font = { name: '돋움', size: 10, ...(rowNumber === 1 ? { bold: true, color: { argb: 'FFFFFFFF' } } : {}) }
      cell.alignment = { vertical: 'middle', wrapText: true, ...(rowNumber === 1 ? { horizontal: 'center' } : {}) }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } } }
      if (rowNumber === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF243B53' } }
      else if (rowNumber % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6FA' } }
    }
  })
  if (sheet.rowCount === 1) {
    sheet.mergeCells(2, 1, 2, columns)
    sheet.getCell('A2').value = emptyText
    sheet.getCell('A2').font = { name: '돋움', size: 10, color: { argb: 'FF52606D' } }
    sheet.getCell('A2').alignment = { vertical: 'middle' }
    sheet.getRow(2).height = 30
  }
}
