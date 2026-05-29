/**
 * 경동택배 송장등록 Excel 생성
 *
 * 경동택배 시스템에 업로드하는 양식 (26컬럼).
 * 고객사주문번호 = orders.id — 송장 임포트 시 매칭 키.
 */

import ExcelJS from 'exceljs'
import { fillWholeRow, getCombinedShipmentFill, getRepeatedCombinedKeys, shouldFillCombinedShipmentRow } from './combined-fill'

export interface KyungdongOrderRow {
  orderId: string
  marketplaceOrderId?: string
  shipmentGroupId?: string
  recipientName: string
  recipientPhone: string
  recipientAltPhone?: string
  recipientAddress: string
  recipientDetailAddress?: string
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
  'No',
  '받는분',
  '주소',
  '상세주소',
  '운송장번호',
  '고객사주문번호',
  '우편번호',
  '도착영업소',
  '전화번호',
  '기타전화번호',
  '선불후불',
  '품목명',
  '수량',
  '포장상태',
  '가로',
  '세로',
  '높이',
  '무게',
  '개별단가',
  '배송운임',
  '기타운임',
  '별도운임',
  '할증운임',
  '도서운임',
  '메모',
  '상품코드',
]

const COLUMN_WIDTHS = [
  6,   // No
  12,  // 받는분
  40,  // 주소
  20,  // 상세주소
  18,  // 운송장번호
  36,  // 고객사주문번호
  10,  // 우편번호
  12,  // 도착영업소
  15,  // 전화번호
  15,  // 기타전화번호
  8,   // 선불후불
  30,  // 품목명
  6,   // 수량
  8,   // 포장상태
  6, 6, 6, 6, // 가로/세로/높이/무게
  10,  // 개별단가
  10,  // 배송운임
  10,  // 기타운임
  10,  // 별도운임
  10,  // 할증운임
  10,  // 도서운임
  20,  // 메모
  15,  // 상품코드
]

export async function generateKyungdongExcel(rows: KyungdongOrderRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('경동택배')

  // Header row
  ws.addRow(HEADERS)
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDBE5F1' }, // 연한 파란색
  }
  headerRow.alignment = { horizontal: 'center' }

  ws.columns = HEADERS.map((_, i) => ({
    key: String(i + 1),
    width: COLUMN_WIDTHS[i] ?? 10,
  }))

  const combinedKeys = getRepeatedCombinedKeys(rows as unknown as Record<string, unknown>[])

  rows.forEach((row, idx) => {
    // 상품명에 위치 접두사 추가
    const displayName = row.pickingLocation
      ? `(${row.pickingLocation}) ${row.productName}`
      : row.productName

    const dataRow = ws.addRow([
      idx + 1,                          // No
      row.recipientName,                // 받는분
      row.recipientAddress,             // 주소
      row.recipientDetailAddress ?? '',  // 상세주소
      '',                               // 운송장번호 (택배사에서 채움)
      row.orderId,                      // 고객사주문번호
      row.recipientZipCode ?? '',       // 우편번호
      '',                               // 도착영업소 (택배사에서 채움)
      row.recipientPhone,               // 전화번호
      row.recipientAltPhone ?? '',      // 기타전화번호
      '선불',                           // 선불후불
      displayName,                      // 품목명
      row.quantity,                     // 수량
      '박스',                           // 포장상태
      '', '', '', '',                   // 가로/세로/높이/무게
      '', '', '', '', '', '',           // 운임 관련 (비워둠)
      row.deliveryMessage ?? '',        // 메모
      row.internalSku ?? '',            // 상품코드
    ])
    const fill = getCombinedShipmentFill(row.shipmentGroupId)
      ?? (shouldFillCombinedShipmentRow(row as unknown as Record<string, unknown>, combinedKeys)
        ? getCombinedShipmentFill('combined')
        : null)
    if (fill) {
      fillWholeRow(dataRow, HEADERS.length, fill)
    }
  })

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
