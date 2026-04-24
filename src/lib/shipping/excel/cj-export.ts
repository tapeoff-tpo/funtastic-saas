/**
 * CJ대한통운 발주서 Excel 생성
 *
 * CJ 웹에 업로드하는 발주서 양식 (25컬럼).
 * 고객주문번호 = orders.id — 운송장 임포트 시 매칭 키로 사용.
 */

import ExcelJS from 'exceljs'

export interface CjOrderRow {
  orderId: string
  marketplaceOrderId: string
  recipientName: string
  recipientPhone: string
  recipientAddress: string
  productName: string       // 내부 상품명 (매핑 후)
  optionText?: string
  quantity: number
  marketplaceItemId?: string
  deliveryMessage?: string
  senderName: string
  senderPhone: string
  senderAddress: string
  originalProductName?: string  // 수집상품명 (마켓 원본)
  pickingLocation?: string      // 피킹위치 (e.g. '1창고 A-01-03')
}

const HEADERS = [
  '받는분성명',
  '받는분전화번호',
  '받는분기타연락처',
  '받는분주소(전체? 분할)',
  '상품명',
  '박스수량',
  '운임구분',
  '기본운임',
  '배송메세지',
  '고객주문번호',
  '내품수량',
  '내품명',
  '보내는분성명',
  '보내는분전화번호',
  '보내는분주소(전체? 분할)',
  '상품코드',
  '쇼핑몰 상품코드',
  '쇼핑몰 주문번호',
  '물류메세지',
  '현재고',
  '수집상품명',
  '수집옵션명',
  '상품명+옵션',
  '위치',
  '관리자메모',
]

export async function generateCjExcel(rows: CjOrderRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('발주서')

  // Header row with style
  ws.addRow(HEADERS)
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9EAD3' },
  }
  headerRow.alignment = { horizontal: 'center' }

  // Set column widths
  ws.columns = HEADERS.map((_, i) => ({
    key: String(i + 1),
    width: [15, 15, 15, 40, 30, 8, 8, 8, 20, 36, 8, 30, 10, 15, 40, 15, 20, 20, 20, 8, 30, 20, 35, 10, 15][i] ?? 15,
  }))

  // Detect 합배송: group by (recipientName + recipientAddress)
  const recipientKey = (r: CjOrderRow) =>
    `${(r.recipientName ?? '').trim()}||${(r.recipientAddress ?? '').trim()}`
  const recipientCount = new Map<string, number>()
  for (const row of rows) {
    const key = recipientKey(row)
    recipientCount.set(key, (recipientCount.get(key) ?? 0) + 1)
  }
  const combinedRecipients = new Set(
    [...recipientCount.entries()].filter(([, c]) => c > 1).map(([k]) => k),
  )

  const COMBINED_FILL: ExcelJS.FillPattern = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF66CCFF' }, // 파란 음영 (합배송)
  }

  for (const row of rows) {
    const productAndOption = row.optionText
      ? `${row.productName} / ${row.optionText}`
      : row.productName

    // 상품명에 위치 접두사 추가
    const displayName = row.pickingLocation
      ? `(${row.pickingLocation}) ${row.productName}`
      : row.productName

    const dataRow = ws.addRow([
      row.recipientName,
      row.recipientPhone,
      '',
      row.recipientAddress,
      displayName,
      1,
      '착불',
      0,
      row.deliveryMessage ?? '',
      row.orderId,
      row.quantity,
      row.productName,
      row.senderName,
      row.senderPhone,
      row.senderAddress,
      '',
      row.marketplaceItemId ?? '',
      row.marketplaceOrderId,
      '',
      '',
      row.originalProductName ?? row.productName,
      row.optionText ?? '',
      productAndOption,
      row.pickingLocation ?? '',
      '',
    ])

    // 합배송 행에 파란 음영 적용
    if (combinedRecipients.has(recipientKey(row))) {
      dataRow.eachCell((cell) => {
        cell.fill = COMBINED_FILL
      })
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
