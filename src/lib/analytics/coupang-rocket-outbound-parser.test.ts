import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseCoupangRocketOutboundWorkbook } from './coupang-rocket-outbound-parser'

describe('parseCoupangRocketOutboundWorkbook', () => {
  it('reads shipment date, order, seller SKU, and outbound quantity from a Rocket file', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('출고내역')
    sheet.addRow(['주문번호', '출고일자', '판매자상품코드', '상품명', '출고수량'])
    sheet.addRow(['ORDER-1', '20260715', 'SKU-001', '테스트 상품', 3])
    sheet.addRow(['ORDER-2', '2026. 07. 14.', 'SKU-002', '다른 상품', '2'])
    sheet.addRow(['ORDER-3', '20260714', 'SKU-003', '제외 상품', 0])

    const buffer = await workbook.xlsx.writeBuffer()
    const parsed = await parseCoupangRocketOutboundWorkbook(buffer as ArrayBuffer)

    expect(parsed.sheetName).toBe('출고내역')
    expect(parsed.totalRows).toBe(3)
    expect(parsed.invalidRows).toBe(1)
    expect(parsed.headers.shipmentDate).toBe('출고일자')
    expect(parsed.headers.sourceSku).toBe('판매자상품코드')
    expect(parsed.validRows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        shipmentDate: '2026-07-15',
        sourceOrderId: 'ORDER-1',
        sourceSku: 'SKU-001',
        productName: '테스트 상품',
        quantity: 3,
      }),
      expect.objectContaining({
        rowNumber: 3,
        shipmentDate: '2026-07-14',
        sourceOrderId: 'ORDER-2',
        sourceSku: 'SKU-002',
        productName: '다른 상품',
        quantity: 2,
      }),
    ])
  })

  it('uses product name when a seller SKU column is unavailable', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Sheet1')
    sheet.addRow(['배송완료일', '주문ID', '상품명', '수량'])
    sheet.addRow(['2026-07-01', 'ORDER-4', '이름으로 매칭', 4])

    const buffer = await workbook.xlsx.writeBuffer()
    const parsed = await parseCoupangRocketOutboundWorkbook(buffer as ArrayBuffer)

    expect(parsed.validRows).toHaveLength(1)
    expect(parsed.validRows[0]).toEqual(expect.objectContaining({
      shipmentDate: '2026-07-01',
      sourceSku: null,
      productName: '이름으로 매칭',
      quantity: 4,
    }))
    expect(parsed.warnings).toContain('상품코드 열이 없어 품목명으로만 매칭합니다. 미매칭 행은 발주 수량에 반영되지 않습니다.')
  })

  it('prioritizes Sabangnet SKU and actual outbound quantity in the Rocket sales export', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('매출확인')
    sheet.addRow(['쇼핑몰 상품코드', '주문번호(쇼핑몰)', '출고완료일자', '사방넷 주문번호', '사방넷 상품코드', '사방넷 상품명', '주문수량', '실 출고수량'])
    sheet.addRow(['MARKET-001', 'MALL-ORDER-1', '20260715', 'SABANG-ORDER-1', 'SKU-001', '내부 품목명', 9, 3])

    const buffer = await workbook.xlsx.writeBuffer()
    const parsed = await parseCoupangRocketOutboundWorkbook(buffer as ArrayBuffer)

    expect(parsed.validRows[0]).toEqual(expect.objectContaining({
      sourceOrderId: 'SABANG-ORDER-1',
      sourceSku: 'SKU-001',
      productName: '내부 품목명',
      quantity: 3,
    }))
  })
})
