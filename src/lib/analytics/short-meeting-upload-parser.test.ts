import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseShortMeetingWorkbook } from './short-meeting-upload-parser'

async function workbookWithRows(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('주문서')
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe('short meeting workbook parser', () => {
  it('aggregates all valid order lines by exact SKU without filtering dates', async () => {
    const file = await workbookWithRows([
      ['사방넷 상품코드', '사방넷 상품명', '사방넷 옵션', '실 출고수량', '수집일시'],
      ['001234-0001', '상품', '빨강', 3, '2026-11-10'],
      ['001234-0001', '상품', '빨강', 7, '2026-11-12'],
      ['001234-0002', '상품', '파랑', 2, '2026-11-12'],
    ])
    expect(await parseShortMeetingWorkbook(file)).toEqual({
      rowCount: 3, productCount: 2, totalQuantity: 12, warnings: [],
      items: [
        { sku: '001234-0001', productName: '상품', optionName: '빨강', quantity: 10 },
        { sku: '001234-0002', productName: '상품', optionName: '파랑', quantity: 2 },
      ],
    })
  })

  it('reports and excludes missing SKUs and quantities instead of using order quantities', async () => {
    const file = await workbookWithRows([
      ['사방넷 상품코드', '사방넷 상품명', '사방넷 옵션', '실 출고수량', '주문수량'],
      ['GOOD', '상품', '단품', 4, 100],
      ['', '상품', '단품', 2, 2],
      ['MISSING', '상품', '단품', null, 10],
      ['BAD', '상품', '단품', '1.5', 10],
    ])
    const result = await parseShortMeetingWorkbook(file)
    expect(result).toMatchObject({ rowCount: 1, productCount: 1, totalQuantity: 4 })
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings.join(' ')).toContain('3행')
    expect(result.warnings.join(' ')).toContain('4행')
  })

  it('rejects a file without the required actual outbound quantity header', async () => {
    const file = await workbookWithRows([
      ['사방넷 상품코드', '사방넷 상품명', '사방넷 옵션', '주문수량'],
      ['SKU', '상품', '단품', 5],
    ])
    await expect(parseShortMeetingWorkbook(file)).rejects.toThrow('실 출고수량')
  })
})
