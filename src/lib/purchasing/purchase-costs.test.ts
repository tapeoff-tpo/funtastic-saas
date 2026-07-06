import { describe, expect, it } from 'vitest'
import { calculatePurchaseCosts, sumPurchaseCosts } from './purchase-costs'

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

describe('purchase cost totals', () => {
  it('adds available yuan and won totals and counts missing prices', () => {
    expect(sumPurchaseCosts([
      { requestedQuantity: 2, unitCostYuan: '10', unitCostKrw: '2000' },
      { requestedQuantity: 3, unitCostYuan: null, unitCostKrw: '1000' },
    ])).toEqual({
      totalCostYuan: 20,
      totalCostKrw: 7000,
      missingYuanCostCount: 1,
      missingKrwCostCount: 0,
    })
  })
})
