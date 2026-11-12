import { describe, expect, it } from 'vitest'
import { largestChinaOutboundBox, chinaStockDate, matchesChinaStockPeriod } from './china-outbound-packaging'

describe('outbound packaging and receipt periods', () => {
  it('keeps one real largest box rather than inventing per-axis maxima', () => {
    const flat = { id: 'flat', lengthCm: 100, widthCm: 10, heightCm: 10 }
    const tall = { id: 'tall', lengthCm: 20, widthCm: 20, heightCm: 50 }
    expect(largestChinaOutboundBox([flat, tall])).toBe(tall)
    expect(largestChinaOutboundBox([tall, flat])).toBe(tall)
    expect(largestChinaOutboundBox([{ lengthCm: null, widthCm: null, heightCm: null }, flat])).toBe(flat)
    expect(largestChinaOutboundBox([])).toBeUndefined()
  })
  it('uses inclusive calendar dates in Korea and excludes missing dates only with an active filter', () => {
    expect(chinaStockDate('2026-11-02T15:00:00Z')).toBe('2026-11-03')
    expect(matchesChinaStockPeriod('2026-11-02T15:00:00Z', '2026-11-03', '2026-11-03')).toBe(true)
    expect(matchesChinaStockPeriod('2026-11-02T14:59:59Z', '2026-11-03', '')).toBe(false)
    expect(matchesChinaStockPeriod(null, '', '')).toBe(true)
    expect(matchesChinaStockPeriod(null, '2026-11-03', '')).toBe(false)
    expect(matchesChinaStockPeriod('invalid', '', '2026-11-03')).toBe(false)
  })
})
