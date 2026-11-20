import { describe, expect, it } from 'vitest'
import {
  calculateChinaOutboundBoxCbm,
  estimateChinaOutboundBoxDimensions,
  fillChinaOutboundDimensionInputs,
  formatChinaOutboundBoxDimensions,
  formatChinaOutboundCbm,
} from './china-outbound-dimensions'

describe('China outbound box dimensions', () => {
  it('estimates equal missing sides from manual CBM and keeps the exact CBM authoritative', () => {
    expect(estimateChinaOutboundBoxDimensions({ manualCbm: 0.125 })).toEqual({ lengthCm: 50, widthCm: 50, heightCm: 50 })
    const filled = fillChinaOutboundDimensionInputs({ lengthCm: '', widthCm: '', heightCm: '', manualCbm: '0.2' })
    expect(filled).toEqual({ lengthCm: '58.48', widthCm: '58.48', heightCm: '58.48', manualCbm: '0.2' })
    expect(calculateChinaOutboundBoxCbm(filled)).toBe(0.2)
  })

  it('preserves entered sides and estimates only the remaining volume', () => {
    expect(estimateChinaOutboundBoxDimensions({ manualCbm: 0.125, lengthCm: 50 })).toEqual({ widthCm: 50, heightCm: 50 })
    expect(estimateChinaOutboundBoxDimensions({ manualCbm: 0.06, lengthCm: 50, widthCm: 40 })).toEqual({ heightCm: 30 })
    expect(estimateChinaOutboundBoxDimensions({ manualCbm: 0.125, lengthCm: 10, widthCm: 20, heightCm: 30 })).toBeNull()
    expect(fillChinaOutboundDimensionInputs({ manualCbm: '0.06', lengthCm: '50.00', widthCm: '40', heightCm: '' })).toEqual({ manualCbm: '0.06', lengthCm: '50.00', widthCm: '40', heightCm: '30' })
  })

  it('leaves invalid CBM or invalid entered dimensions for validation instead of inventing a value', () => {
    for (const manualCbm of [null, 0, -1, 0.0000001, 1_000_000_000, Number.NaN]) expect(estimateChinaOutboundBoxDimensions({ manualCbm })).toBeNull()
    expect(estimateChinaOutboundBoxDimensions({ manualCbm: 0.125, lengthCm: -1 })).toBeNull()
    expect(estimateChinaOutboundBoxDimensions({ manualCbm: 0.125, lengthCm: 'invalid' })).toBeNull()
  })

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
