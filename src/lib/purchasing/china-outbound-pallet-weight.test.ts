import { describe, expect, it } from 'vitest'
import { calculateChinaOutboundPalletWeight, palletTareWeightKg } from './china-outbound-pallet-weight'

describe('automatic pallet gross weight', () => {
  it('adds the default five kilograms once per loaded pallet and counts mixed physical boxes once', () => {
    expect(calculateChinaOutboundPalletWeight([{ id: 'a', grossWeightKg: 10.125 }, { id: 'a', grossWeightKg: 10.125 }, { id: 'b', grossWeightKg: '20.250' }])).toEqual({
      boxWeightKg: 30.375, tareWeightKg: 5, grossWeightKg: 35.375, missingBoxWeightCount: 0,
    })
  })
  it('keeps three-decimal sums exact and supports manually edited or zero pallet tare', () => {
    const boxes = [{ id: 'a', grossWeightKg: 0.1 }, { id: 'b', grossWeightKg: 0.2 }]
    expect(calculateChinaOutboundPalletWeight(boxes, '7.125').grossWeightKg).toBe(7.425)
    expect(calculateChinaOutboundPalletWeight(boxes, 0).grossWeightKg).toBe(0.3)
    expect(calculateChinaOutboundPalletWeight([], 0).grossWeightKg).toBe(0)
  })
  it.each([undefined, null, '', -1, Number.NaN, Number.POSITIVE_INFINITY, 'invalid', 1_000_000_000])('uses the five-kilogram default for invalid or legacy tare %s', (value) => {
    expect(palletTareWeightKg(value)).toBe(5)
  })
  it.each([undefined, null, '', 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'invalid'])('does not silently treat an unmeasured box %s as zero', (value) => {
    expect(calculateChinaOutboundPalletWeight([{ id: 'measured', grossWeightKg: 10 }, { id: 'missing', grossWeightKg: value }], 5)).toEqual({
      boxWeightKg: null, grossWeightKg: null, tareWeightKg: 5, missingBoxWeightCount: 1,
    })
  })
})
