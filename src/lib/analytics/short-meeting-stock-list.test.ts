import { describe, expect, it } from 'vitest'
import { parseShortMeetingStockList } from './short-meeting-stock-list'

describe('short meeting stock list', () => {
  it('finds the live list below its notes and matches exact SKU with dates', () => {
    const list = parseShortMeetingStockList('안내,,,,,\n품절날짜,상품명,옵션,상품코드1,상품코드2,입고일정\n11월 1일,상품,옵션,123,001234-0001,"(11월 20일, 입고예정)"\n11월 2일,상품,옵션,123,001234-0001,(일시품절)')
    expect(list.get('001234-0001')).toBe('11월 1일 (11월 20일, 입고예정) / 11월 2일 (일시품절)')
  })

  it('rejects an unexpected response instead of reporting no sold-out products', () => {
    expect(() => parseShortMeetingStockList('<html>sign in</html>')).toThrow()
  })
})
