import ExcelJS from 'exceljs'
import officeCrypto from 'officecrypto-tool'
import { describe, expect, it } from 'vitest'
import { ExcelWorkbookPasswordInvalidError, ExcelWorkbookPasswordRequiredError } from '@/lib/orders/excel-workbook-buffer'
import { parseShortMeetingWorkbook } from './short-meeting-upload-parser'

async function workbookWithRows(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('주문서')
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe('short meeting workbook parser', () => {
  it('requires the correct password for a real encrypted workbook', async () => {
    const plain = await workbookWithRows([
      ['사방넷 상품코드', '사방넷 상품명', '사방넷 옵션', '실 출고수량'],
      ['001234-0001', '상품', '옵션', 12],
    ])
    const encrypted = officeCrypto.encrypt(plain, { password: 'test secret' })
    await expect(parseShortMeetingWorkbook(encrypted)).rejects.toBeInstanceOf(ExcelWorkbookPasswordRequiredError)
    await expect(parseShortMeetingWorkbook(encrypted, 'wrong')).rejects.toBeInstanceOf(ExcelWorkbookPasswordInvalidError)
    expect(await parseShortMeetingWorkbook(encrypted, 'test secret')).toMatchObject({ rowCount: 1, totalQuantity: 12, items: [{ sku: '001234-0001', quantity: 12 }] })
  })
  it('aggregates all valid order lines by exact SKU without filtering dates', async () => {
    const file = await workbookWithRows([
      ['사방넷 상품코드', '사방넷 상품명', '사방넷 옵션', '실 출고수량', '수집일시'],
      ['001234-0001', '상품', '빨강', 3, '2026-11-10'],
      ['001234-0001', '상품', '빨강', 7, '2026-11-12'],
      ['001234-0002', '상품', '파랑', 2, '2026-11-12'],
    ])
    expect(await parseShortMeetingWorkbook(file)).toMatchObject({
      rowCount: 3, productCount: 2, totalQuantity: 12, warnings: [],
      items: [
        { sku: '001234-0001', productName: '상품', optionName: '빨강', quantity: 10 },
        { sku: '001234-0002', productName: '상품', optionName: '파랑', quantity: 2 },
      ],
    })
  })

  it('retains source column order and formatted cells, including rows excluded from product totals', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('주문서')
    sheet.addRow(['사방넷 상품코드', '사방넷 상품명', '사방넷 옵션', '실 출고수량', '', '수집일시', '수집일시', '계산값'])
    sheet.addRow([12345, '상품', '단품', 2, '빈 제목의 값', new Date('2026-11-12T00:00:00Z'), '중복 열', { formula: '1+1', result: 2 }])
    sheet.getCell('A2').numFmt = '000000'
    sheet.getCell('F2').numFmt = 'yyyy-mm-dd'
    sheet.addRow(['', '상품', '단품', 1, '제외 행'])
    sheet.addRow(['', '', '', '', '다른 열만 있는 행'])
    sheet.getCell('A5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }
    const result = await parseShortMeetingWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(result.rowCount).toBe(1)
    expect(result.rawData.headers).toEqual(['사방넷 상품코드', '사방넷 상품명', '사방넷 옵션', '실 출고수량', '', '수집일시', '수집일시', '계산값'])
    expect(result.rawData.rows).toEqual([
      { rowNumber: 2, cells: ['012345', '상품', '단품', '2', '빈 제목의 값', '2026-11-12', '중복 열', '2'], excludedReason: null },
      { rowNumber: 3, cells: ['', '상품', '단품', '1', '제외 행', '', '', ''], excludedReason: '사방넷 상품코드가 없어 제외했습니다.' },
      { rowNumber: 4, cells: ['', '', '', '', '다른 열만 있는 행', '', '', ''], excludedReason: '상품별 집계 대상 정보 없음' },
    ])
  })

  it('retains source data over 2 MB without silently truncating rows', async () => {
    const file = await workbookWithRows([
      ['사방넷 상품코드', '사방넷 상품명', '사방넷 옵션', '실 출고수량', '원본 추가정보'],
      ...Array.from({ length: 150 }, () => ['SKU', '상품', '옵션', 1, '가'.repeat(5000)]),
    ])
    const parsed = await parseShortMeetingWorkbook(file)
    expect(parsed.rowCount).toBe(150)
    expect(parsed.rawData.rows).toHaveLength(150)
    expect(parsed.rawData.rows[149].cells[4]).toHaveLength(5000)
  }, 20000)

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
