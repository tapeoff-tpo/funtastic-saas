/**
 * Generate a blank order import Excel template.
 */

import ExcelJS from 'exceljs'

const HEADERS = [
  { key: 'orderNumber', label: '주문번호*', width: 20 },
  { key: 'buyerName', label: '주문자명*', width: 12 },
  { key: 'recipientName', label: '수령자명*', width: 12 },
  { key: 'recipientPhone', label: '수령자전화', width: 15 },
  { key: 'zipCode', label: '우편번호', width: 10 },
  { key: 'address1', label: '주소*', width: 30 },
  { key: 'address2', label: '상세주소', width: 20 },
  { key: 'orderedAt', label: '주문일시*', width: 20 },
  { key: 'productName', label: '상품명*', width: 30 },
  { key: 'optionText', label: '옵션', width: 20 },
  { key: 'quantity', label: '수량*', width: 8 },
  { key: 'unitPrice', label: '단가*', width: 12 },
  { key: 'totalAmount', label: '총금액', width: 12 },
  { key: 'sku', label: 'SKU', width: 15 },
]

const EXAMPLE_ROW = [
  'ORD-20260407-001',
  '홍길동',
  '김철수',
  '010-1234-5678',
  '06234',
  '서울시 강남구 역삼로 123',
  '456호',
  '2026-04-07 10:30:00',
  '실리콘 주방매트',
  '대형/그레이',
  1,
  15000,
  15000,
  'SKU-001',
]

export async function generateOrderTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('주문 업로드 양식')

  // Header row
  const headerRow = sheet.addRow(HEADERS.map((h) => h.label))
  headerRow.font = { bold: true, size: 11 }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F0FE' },
  }

  // Column widths
  HEADERS.forEach((h, i) => {
    const col = sheet.getColumn(i + 1)
    col.width = h.width
  })

  // Required column headers in red
  headerRow.eachCell((cell, colNumber) => {
    const label = HEADERS[colNumber - 1]?.label ?? ''
    if (label.endsWith('*')) {
      cell.font = { bold: true, size: 11, color: { argb: 'FFCC0000' } }
    }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF999999' } },
    }
  })

  // Example row
  const exRow = sheet.addRow(EXAMPLE_ROW)
  exRow.font = { color: { argb: 'FF888888' }, italic: true }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
