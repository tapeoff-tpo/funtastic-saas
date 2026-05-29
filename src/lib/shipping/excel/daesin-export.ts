/**
 * 대신택배 송장등록 Excel 생성
 *
 * 대신택배 시스템에 업로드하는 양식 (21컬럼).
 */

import ExcelJS from 'exceljs'
import { fillWholeRow, getCombinedShipmentFill, getRepeatedCombinedKeys, shouldFillCombinedShipmentRow } from './combined-fill'

export interface DaesinOrderRow {
  orderId: string
  marketplaceOrderId: string
  shipmentGroupId?: string
  recipientName: string
  recipientPhone: string
  recipientAltPhone?: string
  recipientAddress: string
  recipientZipCode?: string
  productName: string
  quantity: number
  deliveryMessage?: string
  senderName: string
  senderPhone: string
  pickingLocation?: string
  internalSku?: string
}

const HEADERS = [
  '수화주전화1',
  '수화주전화2',
  '수화주명',
  '주소',
  '수량',
  '품명',
  '포장',
  '운임구분',
  '운송상품',
  '우편번호',
  '도착영업소',
  '발화주명',
  '발화주전화번호',
  '발송제비용',
  '운임',
  '도착제비용',
  '총운임',
  '특기사항',
  '상품코드',
  '쇼핑몰 주문번호',
  '물류메시지',
]

const COLUMN_WIDTHS = [
  15,  // 수화주전화1
  15,  // 수화주전화2
  12,  // 수화주명
  40,  // 주소
  6,   // 수량
  30,  // 품명
  8,   // 포장
  8,   // 운임구분
  8,   // 운송상품
  10,  // 우편번호
  12,  // 도착영업소
  15,  // 발화주명
  15,  // 발화주전화번호
  10,  // 발송제비용
  10,  // 운임
  10,  // 도착제비용
  10,  // 총운임
  35,  // 특기사항
  15,  // 상품코드
  20,  // 쇼핑몰 주문번호
  20,  // 물류메시지
]

export async function generateDaesinExcel(rows: DaesinOrderRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('대신택배')

  // Header row
  ws.addRow(HEADERS)
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFF2CC' }, // 연한 노란색
  }
  headerRow.alignment = { horizontal: 'center' }

  ws.columns = HEADERS.map((_, i) => ({
    key: String(i + 1),
    width: COLUMN_WIDTHS[i] ?? 10,
  }))

  const combinedKeys = getRepeatedCombinedKeys(rows as unknown as Record<string, unknown>[])

  for (const row of rows) {
    // 특기사항에 위치 + 상품명
    const displayName = row.pickingLocation
      ? `(${row.pickingLocation}) ${row.productName}`
      : row.productName

    const dataRow = ws.addRow([
      row.recipientPhone,              // 수화주전화1
      row.recipientAltPhone ?? '',      // 수화주전화2
      row.recipientName,                // 수화주명
      row.recipientAddress,             // 주소
      row.quantity,                     // 수량
      row.productName,                  // 품명
      '박스',                           // 포장
      '현불',                           // 운임구분
      '택배',                           // 운송상품
      row.recipientZipCode ?? '',       // 우편번호
      '',                               // 도착영업소
      row.senderName,                   // 발화주명
      row.senderPhone,                  // 발화주전화번호
      '', '', '', '',                   // 비용 관련 (비워둠)
      displayName,                      // 특기사항
      row.internalSku ?? '',            // 상품코드
      row.marketplaceOrderId,           // 쇼핑몰 주문번호
      row.deliveryMessage ?? '',        // 물류메시지
    ])
    const fill = getCombinedShipmentFill(row.shipmentGroupId)
      ?? (shouldFillCombinedShipmentRow(row as unknown as Record<string, unknown>, combinedKeys)
        ? getCombinedShipmentFill('combined')
        : null)
    if (fill) {
      fillWholeRow(dataRow, HEADERS.length, fill)
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
