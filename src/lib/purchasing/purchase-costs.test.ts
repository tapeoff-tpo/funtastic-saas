import { describe, expect, it } from 'vitest'
import { calculatePurchaseCosts } from './purchase-costs'

describe('purchase costs', () => {
  it('calculates yuan and won totals from the requested quantity', () => {
    expect(calculatePurchaseCosts({
      requestedQuantity: 3,
      unitCostYuan: '10.02',
      unitCostKrw: '2,170',
    })).toEqual({
      unitCostYuan: 10.02,
      unitCostKrw: 2170,
      totalCostYuan: 30.06,
      totalCostKrw: 6510,
    })
  })

  it('returns unavailable costs when the item price is missing', () => {
    expect(calculatePurchaseCosts({
      requestedQuantity: 5,
      unitCostYuan: null,
      unitCostKrw: '',
    })).toEqual({
      unitCostYuan: null,
      unitCostKrw: null,
      totalCostYuan: null,
      totalCostKrw: null,
    })
  })
})
