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
})
