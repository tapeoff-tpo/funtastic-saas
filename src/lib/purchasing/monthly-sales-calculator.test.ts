import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { parseMonthlySalesCalculator } from './monthly-sales-calculator'

describe('parseMonthlySalesCalculator', () => {
  it('uses column A as SKU and column D as the three-month average', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('메인')
    sheet.addRow([
      '사방넷상품코드\n[수정불가]',
      '상품명\n[수정불가]',
      '옵션상세명칭',
      '평균 판매수량',
    ])
    sheet.addRow(['A001', '상품', '옵션', 12.34, null, null, null, null, null, null, null, null, '단종'])
    sheet.addRow(['A002', '상품2', '옵션2', '-'])
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseMonthlySalesCalculator(buffer as ArrayBuffer)

    expect(result.rows).toEqual([
      {
        internalSku: 'A001',
        currentMonthOutgoing: 0,
        threeMonthAverageOutgoing: 12.3,
        isDiscontinued: true,
      },
      {
        internalSku: 'A002',
        currentMonthOutgoing: 0,
        threeMonthAverageOutgoing: 0,
        isDiscontinued: false,
      },
    ])
  })

  it('uses the first worksheet even when its name changes', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('메인')
    sheet.addRow(['사방넷상품코드', '상품명', '옵션', '평균'])
    sheet.addRow(['A001', '상품', '옵션', 6])
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseMonthlySalesCalculator(buffer as ArrayBuffer)

    expect(result.rows[0]).toMatchObject({
      currentMonthOutgoing: 0,
      threeMonthAverageOutgoing: 6,
      isDiscontinued: false,
    })
  })
})
