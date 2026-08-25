import { describe, expect, it } from 'vitest'
import { calculateCnyCostKrw } from './cny-cost'

describe('calculateCnyCostKrw', () => {
  it('adds the unit shipping fee before applying the CNY to KRW rate', () => {
    expect(calculateCnyCostKrw({
      chinaUnitPriceCny: 12.5,
      unitShippingCny: 1.2,
      exchangeRateKrw: 205.91,
    })).toBe(2_821)
  })

  it('does not return a cost before a usable rate and cost are entered', () => {
    expect(calculateCnyCostKrw({ chinaUnitPriceCny: 10, unitShippingCny: 1, exchangeRateKrw: 0 })).toBeNull()
    expect(calculateCnyCostKrw({ chinaUnitPriceCny: 0, unitShippingCny: 0, exchangeRateKrw: 205.91 })).toBeNull()
  })
})
