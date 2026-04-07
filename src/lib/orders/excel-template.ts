/**
 * Generate a blank order import Excel template.
 *
 * Creates an .xlsx with Korean headers matching the parseOrderExcel format.
 * Includes one example row of data.
 */

import ExcelJS from 'exceljs'

const HEADERS = [
  { label: '주문번호', width: 20 },
  { label: '주문자명', width: 12 },
  { label: '수령자명', width: 12 },
  { label: '수령자주소', width: 35 },
  { label: '수령자전화', width: 15 },
  { label: '우편번호', width: 10 },
  { label: '주문일시', width: 20 },
  { label: '상품명', width: 25 },
  { label: '옵션', width: 15 },
  { label: '수량', width: 8 },
  { label: '금액(원)', width: 12 },
  { label: 'SKU', width: 15 },
]

const EXAMPLE_ROW = [
  'ORD-001',
  '홍길동',
  '김철수',
  '서울시 강남구 테헤란로 123',
  '010-1234-5678',
  '06234',
  '2026-04-07 10:00',
  '테스트상품',
  '빨강/L',
  1,
  15000,
  'SKU-001',
]

export async function generateOrderTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('주문')

  // Header row
  const headerRow = sheet.addRow(HEADERS.map((h) => h.label))
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9D9D9' },
  }

  // Column widths
  HEADERS.forEach((h, i) => {
    const col = sheet.getColumn(i + 1)
    col.width = h.width
  })

  // Example data row
  sheet.addRow(EXAMPLE_ROW)

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
