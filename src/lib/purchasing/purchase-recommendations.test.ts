import { describe, expect, it } from 'vitest'
import {
  allocatePurchaseBudget,
  calculatePurchaseRecommendationWithSpikeGuard,
  calculateStableMonthlyOutgoing,
} from './purchase-recommendations'

describe('stable monthly outgoing', () => {
  it('removes a sudden current-month spike from recommendation demand', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 100,
      threeMonthAverageOutgoing: 50,
    })).toEqual({
      effectiveMonthlyOutgoing: 25,
      previousTwoMonthAverageOutgoing: 25,
      salesAnomalyDetected: true,
    })
  })

  it('keeps the three-month average for normal sales movement', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 70,
      threeMonthAverageOutgoing: 50,
    })).toEqual({
      effectiveMonthlyOutgoing: 50,
      previousTwoMonthAverageOutgoing: 40,
      salesAnomalyDetected: false,
    })
  })
})

describe('purchase recommendation with sales spike guard', () => {
  it('keeps an item recommended when only the spike-adjusted quantity falls to zero', () => {
    const result = calculatePurchaseRecommendationWithSpikeGuard({
      averageMonthlyOutgoing: 50,
      effectiveMonthlyOutgoing: 25,
      currentMonthOutgoing: 100,
      availableStock: 40,
      targetStockMonths: 1.2,
    })

    expect(result.recommendedQuantity).toBe(1)
    expect(result.originalRecommendedQuantity).toBe(20)
    expect(result.spikeGuardAdjustedToMinimum).toBe(true)
  })
})

describe('purchase budget allocation', () => {
  const candidates = [
    {
      sku: 'urgent',
      recommendedQuantity: 10,
      stockCoverageMonths: 0,
      effectiveMonthlyOutgoing: 10,
      unitCostKrw: 1000,
    },
    {
      sku: 'steady',
      recommendedQuantity: 10,
      stockCoverageMonths: 1,
      effectiveMonthlyOutgoing: 100,
      unitCostKrw: 500,
    },
    {
      sku: 'missing-cost',
      recommendedQuantity: 10,
      stockCoverageMonths: 0,
      effectiveMonthlyOutgoing: 200,
      unitCostKrw: null,
    },
  ]

  it('fills urgent stock first and partially buys the next item within budget', () => {
    const result = allocatePurchaseBudget(candidates, 12000)

    expect(result.items.map((item) => [item.sku, item.allocatedQuantity])).toEqual([
      ['urgent', 10],
      ['steady', 4],
    ])
    expect(result.spentBudgetKrw).toBe(12000)
    expect(result.remainingBudgetKrw).toBe(0)
  })

  it('excludes items without a won unit cost from budget allocation', () => {
    const result = allocatePurchaseBudget(candidates, 50000)

    expect(result.items.some((item) => item.sku === 'missing-cost')).toBe(false)
    expect(result.missingCostExcluded).toBe(1)
  })
})
