import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { clearBlankExcelCells } from './empty-cells'

describe('real empty cells in Excel downloads', () => {
  it('removes blank text from the saved XML while preserving meaningful values and formatting', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('품목')
    sheet.addRow(['코드', '빈칸', '공백', '보이지 않는 공백', '수량', '논리', '수식', '상품명'])
    sheet.addRow(['SKU-A', '', ' \t\u00A0', '\u200B', 0, false, { formula: 'IF(E2=0,"",E2)', result: '' }, '  商品 A  '])
    sheet.getCell('B2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } }
    sheet.getCell('B2').dataValidation = { type: 'list', allowBlank: true, formulae: ['"Y,N"'] }
    sheet.mergeCells('A4:B4')
    sheet.getCell('A4').value = ' '
    sheet.mergeCells('C4:D4')
    sheet.getCell('C4').value = '유지할 이름'
    sheet.getCell('E4').value = { richText: [{ text: '\n' }, { text: '\u2060' }] }
    sheet.getCell('F4').value = { richText: [{ text: '中文名' }] }
    sheet.getCell('G4').value = { text: '', hyperlink: 'https://example.com' }
    sheet.getCell('H4').value = { text: '링크', hyperlink: 'https://example.com' }

    expect(clearBlankExcelCells(workbook)).toBe(5)
    expect(sheet.getCell('G4').value).toEqual({ text: '', hyperlink: 'https://example.com' })
    const buffer = await workbook.xlsx.writeBuffer()
    const restored = new ExcelJS.Workbook()
    await restored.xlsx.load(buffer)
    const result = restored.getWorksheet('품목')!
    for (const address of ['B2', 'C2', 'D2', 'A4', 'E4']) expect(result.getCell(address).value).toBeNull()
    expect(result.getCell('E2').value).toBe(0)
    expect(result.getCell('F2').value).toBe(false)
    expect(result.getCell('G2').formula).toBe('IF(E2=0,"",E2)')
    expect(result.getCell('H2').value).toBe('  商品 A  ')
    expect(result.getCell('B2').fill).toMatchObject({ fgColor: { argb: 'FFFFF7D6' } })
    expect(result.getCell('B2').dataValidation).toMatchObject({ type: 'list', allowBlank: true })
    expect(result.getCell('D4').master.address).toBe('C4')
    expect(result.getCell('C4').value).toBe('유지할 이름')
    expect(result.getCell('F4').value).toEqual({ richText: [{ text: '中文名' }] })
    expect(result.getCell('H4').hyperlink).toBe('https://example.com')

    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    for (const address of ['B2', 'C2', 'D2', 'A4', 'E4']) {
      const cell = document.querySelector(`c[r="${address}"]`)
      expect(cell?.getAttribute('t')).not.toBe('s')
      expect(cell?.querySelector('v, is')).toBeFalsy()
    }
  })
})
