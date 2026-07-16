import { describe, expect, it } from 'vitest'
import {
  allocatePurchaseBudget,
  calculatePurchaseRecommendationWithSpikeGuard,
  calculateStableMonthlyOutgoing,
  formatSeoulDate,
  isDomesticPurchaseProduct,
} from './purchase-recommendations'

describe('domestic purchase product exclusions', () => {
  it('excludes detergent and laundry soap products from China purchase recommendations', () => {
    expect(isDomesticPurchaseProduct('UD \uBB34\uD5A5 1\uC885 \uC8FC\uBC29\uC138\uC81C')).toBe(true)
    expect(isDomesticPurchaseProduct('\uC2A4\uD2F1\uD615 \uC138\uD0C1\uBE44\uB204')).toBe(true)
    expect(isDomesticPurchaseProduct('TD \uC6B4\uB3D9\uBCF5\uC138\uC81C')).toBe(true)
  })

  it('keeps related non-detergent products eligible', () => {
    expect(isDomesticPurchaseProduct('\uC8FC\uBC29\uC6A9 \uC218\uC138\uBBF8')).toBe(false)
    expect(isDomesticPurchaseProduct('\uD38C\uD504 \uBD80\uC790\uC7AC')).toBe(false)
  })
})

describe('stable monthly outgoing', () => {
  it('removes a sudden current-month spike from recommendation demand', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 100,
      threeMonthAverageOutgoing: 50,
    })).toEqual({
      effectiveMonthlyOutgoing: 50,
      baselineMonthlyOutgoing: 50,
      salesAnomalyDetected: true,
    })
  })

  it('keeps the three-month average for normal sales movement', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 70,
      threeMonthAverageOutgoing: 50,
    })).toEqual({
      effectiveMonthlyOutgoing: 50,
      baselineMonthlyOutgoing: 50,
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

  it('allocates an MOQ product group only when the full group fits the budget', () => {
    const moqCandidates = [
      {
        sku: 'option-a',
        recommendedQuantity: 120,
        stockCoverageMonths: 0,
        effectiveMonthlyOutgoing: 100,
        unitCostKrw: 1000,
        moqProductGroupName: 'MOQ item',
      },
      {
        sku: 'option-b',
        recommendedQuantity: 80,
        stockCoverageMonths: 1,
        effectiveMonthlyOutgoing: 50,
        unitCostKrw: 1000,
        moqProductGroupName: 'MOQ item',
      },
    ]

    const insufficient = allocatePurchaseBudget(moqCandidates, 199000)
    expect(insufficient.items).toHaveLength(0)
    expect(insufficient.spentBudgetKrw).toBe(0)
    expect(insufficient.moqBudgetExcludedGroupCount).toBe(1)

    const sufficient = allocatePurchaseBudget(moqCandidates, 200000)
    expect(sufficient.items.map((item) => [item.sku, item.allocatedQuantity])).toEqual([
      ['option-a', 120],
      ['option-b', 80],
    ])
    expect(sufficient.spentBudgetKrw).toBe(200000)
    expect(sufficient.moqBudgetExcludedGroupCount).toBe(0)
  })
})

describe('Seoul date formatting', () => {
  it('uses the Korean calendar date around the UTC day boundary', () => {
    expect(formatSeoulDate(new Date('2026-07-31T15:30:00.000Z'))).toBe('2026-08-01')
  })
})
