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
        rawThreeMonthAverageOutgoing: 12.3,
        specialBulkOutgoingAdjustment: null,
        isDiscontinued: true,
      },
      {
        internalSku: 'A002',
        currentMonthOutgoing: 0,
        threeMonthAverageOutgoing: 0,
        rawThreeMonthAverageOutgoing: 0,
        specialBulkOutgoingAdjustment: null,
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
      rawThreeMonthAverageOutgoing: 6,
      specialBulkOutgoingAdjustment: null,
      isDiscontinued: false,
    })
  })

  it('excludes a one-month M테이포프 bulk order even when it is split across many shipment rows', async () => {
    const workbook = createMonthlySalesWorkbook({
      sku: '111536-0002',
      rawAverage: 139,
      monthlyOutgoing: [44, 16, 357],
      specialBulkRows: {
        '26년6월': [24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 12],
      },
    })
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseMonthlySalesCalculator(buffer as ArrayBuffer)

    expect(result.rows[0]).toMatchObject({
      internalSku: '111536-0002',
      rawThreeMonthAverageOutgoing: 139,
      threeMonthAverageOutgoing: 39,
      specialBulkOutgoingAdjustment: {
        specialMall: 'M테이포프(대량)',
        policy: 'one_month_excluded_repeat_half',
        specialBulkQuantity: 300,
        specialBulkMonthCount: 1,
        specialBulkIncludedQuantity: 0,
        specialBulkExcludedQuantity: 300,
        adjustedThreeMonthAverageOutgoing: 39,
      },
    })
  })

  it('reflects half of M테이포프 bulk quantity when the same SKU repeats in two months', async () => {
    const workbook = createMonthlySalesWorkbook({
      sku: 'A001',
      rawAverage: 210,
      monthlyOutgoing: [230, 340, 60],
      specialBulkRows: {
        '26년8월': [200],
        '26년7월': [300],
      },
    })
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseMonthlySalesCalculator(buffer as ArrayBuffer)

    expect(result.rows[0]).toMatchObject({
      rawThreeMonthAverageOutgoing: 210,
      threeMonthAverageOutgoing: 126.7,
      specialBulkOutgoingAdjustment: {
        specialBulkQuantity: 500,
        specialBulkMonthCount: 2,
        specialBulkIncludedQuantity: 250,
        specialBulkExcludedQuantity: 250,
        adjustedThreeMonthAverageOutgoing: 126.7,
      },
    })
  })
})

function createMonthlySalesWorkbook(input: {
  sku: string
  rawAverage: number
  monthlyOutgoing: [number, number, number]
  specialBulkRows: Partial<Record<'26년8월' | '26년7월' | '26년6월', number[]>>
}) {
  const workbook = new ExcelJS.Workbook()
  const main = workbook.addWorksheet('메인')
  main.getRow(1).values = [
    '사방넷상품코드',
    '상품명',
    '옵션',
    '평균 판매수량',
    '3개월 판매량',
    '26년8월',
    '26년7월',
    '26년6월',
  ]
  main.getCell('A2').value = input.sku
  main.getCell('B2').value = '테스트 상품'
  main.getCell('D2').value = input.rawAverage

  const sourceMonths = ['26년8월', '26년7월', '26년6월'] as const
  for (const [index, sourceMonth] of sourceMonths.entries()) {
    const column = String.fromCharCode('F'.charCodeAt(0) + index)
    main.getCell(`${column}2`).value = {
      formula: `SUMIFS('${sourceMonth}'!$Z:$Z,'${sourceMonth}'!$W:$W,메인!$A2,'${sourceMonth}'!$AK:$AK,"<>"&"행사매출")`,
      result: input.monthlyOutgoing[index],
    }

    const source = workbook.addWorksheet(sourceMonth)
    source.getCell('B1').value = '쇼핑몰명'
    source.getCell('W1').value = '사방넷 상품코드'
    source.getCell('Z1').value = '실 출고수량'
    source.getCell('AK1').value = '판매구분'
    const specialBulkRows = input.specialBulkRows[sourceMonth] ?? []
    specialBulkRows.forEach((quantity, rowIndex) => {
      const rowNumber = rowIndex + 2
      source.getCell(`B${rowNumber}`).value = 'M테이포프(대량)'
      source.getCell(`W${rowNumber}`).value = input.sku
      source.getCell(`Z${rowNumber}`).value = quantity
      source.getCell(`AK${rowNumber}`).value = '일반매출'
    })
  }

  return workbook
}
