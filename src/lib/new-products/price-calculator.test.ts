import { describe, expect, it } from 'vitest'
import { calculateSalesPrices } from './price-calculator'

describe('calculateSalesPrices', () => {
  it('matches the Funtastic calculator automatic B2B and B2C prices', () => {
    const result = calculateSalesPrices({ costKrw: 10_000 })
    expect(result).not.toBeNull()
    expect(result?.b2bCalculated).toBe(14_000)
    // The deployed calculator applies Math.ceil directly to JavaScript floats.
    expect(result?.b2bPrice).toBe(15_410)
    expect(result?.b2cCalculated).toBe(18_492)
    expect(result?.b2cPrice).toBe(20_350)
    expect(Math.round(result?.b2bProfit ?? 0)).toBe(2_468)
    expect(Math.round(result?.b2cProfit ?? 0)).toBe(3_413)
  })

  it('uses manual confirmed prices when supplied', () => {
    const result = calculateSalesPrices({
      costKrw: 10_000,
      b2bPriceOverride: 16_000,
      b2cPriceOverride: 22_000,
    })
    expect(result?.b2bPrice).toBe(16_000)
    expect(result?.b2cPrice).toBe(22_000)
  })

  it('does not calculate without a positive cost', () => {
    expect(calculateSalesPrices({ costKrw: 0 })).toBeNull()
  })
})
