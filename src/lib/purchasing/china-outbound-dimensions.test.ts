import { describe, expect, it } from 'vitest'
import {
  calculateChinaOutboundBoxCbm,
  formatChinaOutboundBoxDimensions,
  formatChinaOutboundCbm,
} from './china-outbound-dimensions'

describe('China outbound box dimensions', () => {
  it('calculates CBM from centimeter dimensions', () => {
    expect(calculateChinaOutboundBoxCbm({ lengthCm: 50, widthCm: 40, heightCm: 30 })).toBe(0.06)
    expect(formatChinaOutboundBoxDimensions({ lengthCm: '50', widthCm: '40', heightCm: '30' })).toBe('50 × 40 × 30 cm')
    expect(formatChinaOutboundCbm(0.06)).toBe('0.0600')
  })

  it('keeps CBM unavailable until all three positive dimensions are entered', () => {
    expect(calculateChinaOutboundBoxCbm({ lengthCm: 50, widthCm: 40, heightCm: null })).toBeNull()
    expect(calculateChinaOutboundBoxCbm({ lengthCm: 50, widthCm: 0, heightCm: 30 })).toBeNull()
  })

  it('uses an explicit CBM without inferring missing centimeter dimensions', () => {
    const direct = { manualCbm: '0.125' }
    expect(calculateChinaOutboundBoxCbm(direct)).toBe(0.125)
    expect(formatChinaOutboundBoxDimensions(direct)).toBeNull()
    expect(calculateChinaOutboundBoxCbm({ ...direct, lengthCm: 50, widthCm: 40, heightCm: 30 })).toBe(0.125)
    expect(calculateChinaOutboundBoxCbm({ ...direct, widthCm: 40 })).toBe(0.125)
  })

  it('returns to automatic calculation when the manual CBM is cleared', () => {
    const dimensions = { lengthCm: 50, widthCm: 40, heightCm: 30 }
    expect(calculateChinaOutboundBoxCbm({ ...dimensions, manualCbm: null })).toBe(0.06)
    expect(calculateChinaOutboundBoxCbm({ ...dimensions, manualCbm: '' })).toBe(0.06)
    for (const manualCbm of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'invalid']) {
      expect(calculateChinaOutboundBoxCbm({ ...dimensions, manualCbm })).toBe(0.06)
    }
    expect(calculateChinaOutboundBoxCbm({ manualCbm: null })).toBeNull()
  })
})
