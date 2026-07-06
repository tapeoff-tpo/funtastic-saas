import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  ESA009M_HEADERS,
  parseEsa009mWorkbook,
} from './items'

describe('parseEsa009mWorkbook', () => {
  it('preserves all ESA009M columns and skips rows without a code or name', async () => {
    const [codeHeader, nameHeader] = ESA009M_HEADERS
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('items')
    sheet.addRow([...ESA009M_HEADERS])
    sheet.addRow(ESA009M_HEADERS.map((header) => {
      if (header === codeHeader) return 'A001'
      if (header === nameHeader) return 'Test item'
      return `${header} value`
    }))
    sheet.addRow(['20260615 exported'])
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseEsa009mWorkbook(buffer as ArrayBuffer)

    expect(result).toMatchObject({ total: 2, skipped: 1 })
    expect(result.rows).toHaveLength(1)
    expect(Object.keys(result.rows[0])).toEqual([...ESA009M_HEADERS])
    expect(result.rows[0][codeHeader]).toBe('A001')
    expect(result.rows[0][nameHeader]).toBe('Test item')
  })

  it('normalizes the legacy existing-price header to the special-price header', async () => {
    const legacyHeaders = ESA009M_HEADERS.map((header) => (
      String(header) === '특가(元)' ? '기존원가(元)' : header
    ))
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('items')
    sheet.addRow(legacyHeaders)
    sheet.addRow(legacyHeaders.map((header) => {
      if (header === '품목코드') return 'A001'
      if (header === '품목명') return 'Test item'
      if (header === '기존원가(元)') return '12.5'
      return `${header} value`
    }))
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseEsa009mWorkbook(buffer as ArrayBuffer)
    const parsedRow = result.rows[0] as Record<string, string | null>

    expect(ESA009M_HEADERS).toContain('특가(元)')
    expect(ESA009M_HEADERS).not.toContain('기존원가(元)')
    expect(parsedRow['특가(元)']).toBe('12.5')
    expect(parsedRow['기존원가(元)']).toBeUndefined()
  })
})
