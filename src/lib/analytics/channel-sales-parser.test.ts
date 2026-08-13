import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseChannelSalesWorkbook } from './channel-sales-parser'

describe('parseChannelSalesWorkbook', () => {
  it('parses the bulk sales ledger without an order number', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Sheet1')
    sheet.addRow(['대량 발주리스트'])
    sheet.addRow([
      'no', '상품코드', '제품명', '옵션', '원가', '수량', '개당 판매가',
      '원가총액', '총 판매금액', '매출부가세', '매입부가세', '마진금액', '마진율', '업데이트날짜', '입금자',
    ])
    sheet.addRow([
      1, '111692-0001', '아젤라 휴대용 과일 샐러드컵', '옐로우', 950, 180, 1800,
      171000, 324000, 29454.5454, 15545.4545, 123545.4545, 0.381313, '2026-08-11', '지엠마트',
    ])

    const buffer = await workbook.xlsx.writeBuffer()
    const parsed = await parseChannelSalesWorkbook(buffer as ArrayBuffer)

    expect(parsed.headerRow).toBe(2)
    expect(parsed.totalRows).toBe(1)
    expect(parsed.invalidRows).toBe(0)
    expect(parsed.validRows).toEqual([expect.objectContaining({
      occurredOn: '2026-08-11',
      sourceSku: '111692-0001',
      productName: '아젤라 휴대용 과일 샐러드컵',
      optionText: '옐로우',
      quantity: 180,
      unitSalePrice: 1800,
      salesAmount: 324000,
      productCost: 171000,
      profitAmount: 123545.4545,
      counterparty: '지엠마트',
    })])
  })
})
