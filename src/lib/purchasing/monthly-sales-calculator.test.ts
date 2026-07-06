import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { parseMonthlySalesCalculator } from './monthly-sales-calculator'

describe('parseMonthlySalesCalculator', () => {
  it('uses June as current month and averages April through June', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('메인')
    sheet.addRow([
      '사방넷상품코드\n[수정불가]',
      '상품명\n[수정불가]',
      '옵션상세명칭',
      '1달 평균판매',
      '3개월판매',
      '26/06',
      '26/05',
      '26/04',
    ])
    sheet.addRow(['A001', '상품', '옵션', null, null, 20, 10, 7])
    sheet.addRow(['A002', '상품2', '옵션2', null, null, null, '-', 3])
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseMonthlySalesCalculator(buffer as ArrayBuffer)

    expect(result.rows).toEqual([
      {
        internalSku: 'A001',
        currentMonthOutgoing: 20,
        threeMonthAverageOutgoing: 12.3,
      },
      {
        internalSku: 'A002',
        currentMonthOutgoing: 0,
        threeMonthAverageOutgoing: 1,
      },
    ])
  })

  it('recognizes Excel date serial month headers', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('메인')
    sheet.addRow(['사방넷상품코드', '26/04', '26/05', new Date(Date.UTC(2026, 5, 1))])
    sheet.addRow(['A001', 3, 6, 9])
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseMonthlySalesCalculator(buffer as ArrayBuffer)

    expect(result.rows[0]).toMatchObject({
      currentMonthOutgoing: 9,
      threeMonthAverageOutgoing: 6,
    })
  })
})
