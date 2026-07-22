import { describe, expect, it } from 'vitest'
import { formatExcelDateCell, parseImportedOrderedAt } from '@/lib/orders/import-date'

describe('order import dates', () => {
  it('parses timezone-less Excel order datetime text as KST', () => {
    expect(parseImportedOrderedAt('2026-05-29 10:30:00').toISOString()).toBe(
      '2026-05-29T01:30:00.000Z',
    )
  })

  it('parses Excel serial dates as KST wall-clock time', () => {
    expect(parseImportedOrderedAt('46171.4375').toISOString()).toBe(
      '2026-05-29T01:30:00.000Z',
    )
  })

  it('parses compact YYYYMMDD dates before treating numbers as Excel serial dates', () => {
    expect(parseImportedOrderedAt('20260720').toISOString()).toBe(
      '2026-07-19T15:00:00.000Z',
    )
  })

  it('formats ExcelJS date cells without turning them into UTC instants', () => {
    const excelJsDate = new Date('2026-05-29T10:30:00.000Z')

    expect(formatExcelDateCell(excelJsDate)).toBe('2026-05-29 10:30:00')
    expect(parseImportedOrderedAt(formatExcelDateCell(excelJsDate)).toISOString()).toBe(
      '2026-05-29T01:30:00.000Z',
    )
  })
})
