import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseChannelSalesFile, parseChannelSalesWorkbook } from './channel-sales-parser'

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

  it('uses confirmed quantities, not received quantities, for Rocket PO CSV files', async () => {
    const csv = [
      '발주번호,발주유형,발주현황,SKU ID,SKU 이름,SKU Barcode,물류센터,입고예정일,발주일,발주수량,확정수량,입고수량,매입유형,면세여부,생산연도,제조일자,유통(소비)기한,매입가,공급가,부가세,총발주 매입금,입고금액,Xdock',
      '139039001,일반,거래명세서확인요청,60043717,생활살림 키치니굿즈 2단 타올 걸이 화이트 1개,R231841910001,경기광주1,2026-08-12,2026-08-07 19:54:23,18,18,18,직매입,N,,,,2432,2211,221,43776,43776,N',
      '139038498,일반,발주확정,12699167,생활살림 뽀송 거품 주방 수세미 2개입,R005765590003,전라광주2,2026-08-12,2026-08-07 19:54:23,84,84,0,직매입,N,,,,1300,1182,118,109200,0,N',
    ].join('\n')

    const parsed = await parseChannelSalesFile({
      fileName: 'PO_SKU_LIST.csv',
      fileBuffer: new TextEncoder().encode(csv).buffer,
    })

    expect(parsed.sheetName).toBe('CSV')
    expect(parsed.totalRows).toBe(2)
    expect(parsed.invalidRows).toBe(0)
    expect(parsed.validRows).toEqual([
      expect.objectContaining({
      occurredOn: '2026-08-12',
      sourceSku: '60043717',
      productName: '생활살림 키치니굿즈 2단 타올 걸이 화이트 1개',
      quantity: 18,
      unitSalePrice: 2432,
      salesAmount: 43776,
      productCost: null,
      }),
      expect.objectContaining({
        sourceSku: '12699167',
        quantity: 84,
        unitSalePrice: 1300,
        salesAmount: 109200,
      }),
    ])
  })
})
