import { describe, expect, it } from 'vitest'
import { queryShortMeetingRawData, RawPageTooLargeError } from './short-meeting-raw-query'

const raw = {
  headers: ['수량', '날짜', '상품'],
  rows: [
    { rowNumber: 2, cells: ['10', '12/01/2026', '텀블러'], excludedReason: null },
    { rowNumber: 3, cells: ['', '', '가방'], excludedReason: '코드 없음' },
    { rowNumber: 4, cells: ['2', '11/12/2026', '의자'], excludedReason: null },
  ],
}
const defaults = { search: '', sort: null, direction: 'ascending' as const, page: 1 }

describe('queryShortMeetingRawData', () => {
  it('sorts numeric, formatted dates, and row numbers in both directions with blanks last', () => {
    const numbers = queryShortMeetingRawData(raw, { ...defaults, sort: 0 })
    expect(numbers.rows.map((row) => row.rowNumber)).toEqual([4, 2, 3])
    expect(queryShortMeetingRawData(raw, { ...defaults, sort: 0, direction: 'descending' }).rows.map((r) => r.rowNumber)).toEqual([2, 4, 3])
    expect(queryShortMeetingRawData(raw, { ...defaults, sort: 1 }).rows.map((r) => r.rowNumber)).toEqual([4, 2, 3])
    expect(queryShortMeetingRawData(raw, { ...defaults, sort: 'row', direction: 'descending' }).rows.map((r) => r.rowNumber)).toEqual([4, 3, 2])
  })

  it('searches all columns before sorting and paging without altering stored order', () => {
    const original = raw.rows.map((row) => row.rowNumber)
    const found = queryShortMeetingRawData(raw, { ...defaults, search: '의자', sort: 0 })
    expect(found).toMatchObject({ totalRows: 3, filteredRows: 1, page: 1, totalPages: 1 })
    expect(found.rows[0]).toMatchObject({ rowNumber: 4 })
    expect(raw.rows.map((row) => row.rowNumber)).toEqual(original)
  })

  it('limits pages to 100 rows and clamps out-of-range pages', () => {
    const many = { headers: ['번호'], rows: Array.from({ length: 205 }, (_, index) => ({ rowNumber: index + 2, cells: [String(index)], excludedReason: null })) }
    const result = queryShortMeetingRawData(many, { ...defaults, page: 99 })
    expect(result).toMatchObject({ totalRows: 205, filteredRows: 205, page: 3, pageSize: 100, totalPages: 3 })
    expect(result.rows).toHaveLength(5)
  })

  it('splits large rows across bounded pages and rejects one oversized row without truncation', () => {
    const large = { headers: ['값'], rows: [2, 3].map((rowNumber) => ({ rowNumber, cells: ['x'.repeat(1_100_000)], excludedReason: null })) }
    expect(queryShortMeetingRawData(large, defaults)).toMatchObject({ totalPages: 2, page: 1 })
    expect(queryShortMeetingRawData(large, { ...defaults, page: 2 }).rows[0].rowNumber).toBe(3)
    expect(() => queryShortMeetingRawData({ headers: ['값'], rows: [{ rowNumber: 2, cells: ['x'.repeat(2_100_000)], excludedReason: null }] }, defaults)).toThrow(RawPageTooLargeError)
  })
})
