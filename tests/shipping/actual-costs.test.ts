import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  normalizeTrackingNumber,
  parseActualShippingCostWorkbook,
} from '@/lib/shipping/actual-costs'

async function workbookBuffer(headers: string[], values: unknown[]) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(headers)
  ws.addRow(values)
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

describe('actual shipping cost import parser', () => {
  it('normalizes CJ tracking numbers by removing hyphens', () => {
    expect(normalizeTrackingNumber('6977-5821-7821')).toBe('697758217821')
  })

  it('parses CJ actual cost rows', async () => {
    const buffer = await workbookBuffer(
      ['운송장번호', '접수일자', '배송일자', '주문번호', '박스타입', '수량', '운임', '운임구분', '접수구분'],
      ['6977-5821-7821', '2026-05-01', '2026-05-02', '2131964907', '극소', 1, '1,850', '신용', '배송완료'],
    )

    const result = await parseActualShippingCostWorkbook('CJGLS', buffer)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      normalizedTrackingNumber: '697758217821',
      orderNumber: '2131964907',
      actualFee: 1850,
      packageType: '극소',
    })
  })

  it('parses Kyungdong actual cost rows', async () => {
    const buffer = await workbookBuffer(
      ['운송장번호', '고객사주문번호', '발송접수일', '인수완료일시', '포장상태', '수량', '운임합계', '결제구분', '발송구분'],
      ['8026051299267', '2135578350', '2026-05-22', '2026-05-23 09:10:32', '박스', 1, 7700, '신용', '배송완료'],
    )

    const result = await parseActualShippingCostWorkbook('KDEXP', buffer)

    expect(result.rows[0]).toMatchObject({
      normalizedTrackingNumber: '8026051299267',
      orderNumber: '2135578350',
      actualFee: 7700,
    })
  })

  it('parses Daesin actual cost rows', async () => {
    const buffer = await workbookBuffer(
      ['접수일자', '운송장번호', '품명', '포장', '수량', '지불방법', '총운임', '운송상품'],
      ['2026-05-06', '2702649000488', '2131757945', '통신', 1, '착불', '15,400', '택배'],
    )

    const result = await parseActualShippingCostWorkbook('DAESIN', buffer)

    expect(result.rows[0]).toMatchObject({
      normalizedTrackingNumber: '2702649000488',
      orderNumber: '2131757945',
      actualFee: 15400,
      packageType: '통신',
    })
  })
})
