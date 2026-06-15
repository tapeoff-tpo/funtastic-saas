import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { ESA009M_HEADERS, parseEsa009mWorkbook } from './items'

describe('parseEsa009mWorkbook', () => {
  it('preserves all ESA009M columns and skips the export timestamp footer', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('품목등록')
    sheet.addRow([...ESA009M_HEADERS])
    sheet.addRow(ESA009M_HEADERS.map((header) => header === '품목코드' ? 'A001' : header === '품목명' ? '테스트 품목' : `${header} 값`))
    sheet.addRow(['20260615 오후 4:45:18'])
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseEsa009mWorkbook(buffer as ArrayBuffer)

    expect(result).toMatchObject({ total: 2, skipped: 1 })
    expect(result.rows).toHaveLength(1)
    expect(Object.keys(result.rows[0])).toEqual([...ESA009M_HEADERS])
    expect(result.rows[0]['품목코드']).toBe('A001')
    expect(result.rows[0]['증취세영수증  (%)']).toBe('증취세영수증  (%) 값')
  })
})
