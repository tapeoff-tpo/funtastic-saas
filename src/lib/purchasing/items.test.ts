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
})
