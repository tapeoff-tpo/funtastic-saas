/**
 * CJ대한통운 송장등록양식 파싱
 *
 * CJ가 돌려준 엑셀에서 운송장번호 + 고객주문번호를 추출.
 * 고객주문번호(col 19) = 우리가 발주서에 넣은 내부주문번호/주문 UUID
 */

import ExcelJS from 'exceljs'

export interface CjInvoiceRow {
  rowNum: number
  trackingNumber: string   // col 8: 운송장번호
  orderId: string          // col 19: 고객주문번호
  recipientName: string    // col 21: 받는분
  productName: string      // col 26: 상품명
  raw: (string | number | null)[]
}

export interface CjImportResult {
  rows: CjInvoiceRow[]
  skipped: number          // 운송장번호 없는 행
}

export async function parseCjInvoiceExcel(buffer: Buffer): Promise<CjImportResult> {
  const wb = new ExcelJS.Workbook()
  // ExcelJS load accepts ArrayBuffer; cast for type compatibility
  await wb.xlsx.load(buffer.buffer as ArrayBuffer)

  const ws = wb.worksheets[0]
  if (!ws) throw new Error('엑셀 시트를 찾을 수 없습니다')

  const rows: CjInvoiceRow[] = []
  let skipped = 0

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return // skip header

    const raw = row.values as (string | number | null)[]
    // ExcelJS row.values is 1-indexed, index 0 is undefined
    const trackingNumber = String(raw[8] ?? '').trim()
    const orderId        = String(raw[19] ?? '').trim()
    const recipientName  = String(raw[21] ?? '').trim()
    const productName    = String(raw[26] ?? '').trim()

    if (!trackingNumber) {
      skipped++
      return
    }

    rows.push({ rowNum, trackingNumber, orderId, recipientName, productName, raw: raw as (string | number | null)[] })
  })

  return { rows, skipped }
}
