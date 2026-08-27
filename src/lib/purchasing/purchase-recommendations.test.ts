import { describe, expect, it } from 'vitest'
import {
  applyPurchaseMinimumQuantity,
  allocatePurchaseBudget,
  calculatePurchaseRecommendationWithSpikeGuard,
  calculatePurchaseSalesTrend,
  calculateStableMonthlyOutgoing,
  formatSeoulDate,
  getProductGroupMoqRule,
  isDomesticPurchaseProduct,
  isDiscontinuedPurchaseProduct,
  isExcludedPurchaseRecommendation,
} from './purchase-recommendations'
import { isDiscontinuedPurchasingStatus } from './purchase-delay'

describe('purchase minimum quantities', () => {
  it('applies a minimum of 10 and rounds up to 10-unit purchase quantities', () => {
    expect(applyPurchaseMinimumQuantity(0)).toBe(0)
    expect(applyPurchaseMinimumQuantity(1)).toBe(10)
    expect(applyPurchaseMinimumQuantity(9)).toBe(10)
    expect(applyPurchaseMinimumQuantity(10)).toBe(10)
    expect(applyPurchaseMinimumQuantity(11)).toBe(20)
    expect(applyPurchaseMinimumQuantity(27)).toBe(30)
  })
})

describe('product-specific purchasing rules', () => {
  it('applies the 300-unit MOQ only to the mini stepper SKU', () => {
    expect(getProductGroupMoqRule('101542-0001', '미니스텝퍼')).toMatchObject({
      minimumOrderQuantity: 300,
      roundingUnit: 10,
    })
    expect(getProductGroupMoqRule('100560-0001', '스탠딩테이블')).toBeNull()
  })

  it('excludes the gift package material from purchase recommendations', () => {
    expect(isExcludedPurchaseRecommendation('109055-0001')).toBe(true)
    expect(isExcludedPurchaseRecommendation('109055-0002')).toBe(false)
  })

  it('excludes all WeUse products by their product-name suffix', () => {
    expect(isExcludedPurchaseRecommendation('112227-0001', '모듈러 내열유리 찜기_위유즈')).toBe(true)
    expect(isExcludedPurchaseRecommendation('111973-0001', '모듈러 내열유리 찜기')).toBe(false)
  })

  it('recognizes discontinued products imported from the purchasing workbook', () => {
    expect(isDiscontinuedPurchaseProduct({ purchasingOutgoingMetrics: { isDiscontinued: true } })).toBe(true)
    expect(isDiscontinuedPurchaseProduct({ purchasingOutgoingMetrics: { isDiscontinued: false } })).toBe(false)
  })

  it('recognizes discontinued status saved from a purchase delay', () => {
    expect(isDiscontinuedPurchasingStatus('discontinued')).toBe(true)
    expect(isDiscontinuedPurchasingStatus('active')).toBe(false)
  })
})

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
      salesTrend: 'steady',
    })
  })

  it('keeps the three-month average as the demand basis for established products', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 70,
      threeMonthAverageOutgoing: 50,
    })).toEqual({
      effectiveMonthlyOutgoing: 50,
      baselineMonthlyOutgoing: 50,
      salesAnomalyDetected: false,
      salesTrend: 'increasing',
    })
  })

  it('does not reduce established-product demand when current-month sales fall', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 20,
      threeMonthAverageOutgoing: 50,
    })).toEqual({
      effectiveMonthlyOutgoing: 50,
      baselineMonthlyOutgoing: 50,
      salesAnomalyDetected: false,
      salesTrend: 'decreasing',
    })
  })

  it('uses current-month outgoing as the main demand basis below a five-unit average', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 2,
      threeMonthAverageOutgoing: 4,
    })).toEqual({
      effectiveMonthlyOutgoing: 2,
      baselineMonthlyOutgoing: 4,
      salesAnomalyDetected: false,
      salesTrend: 'steady',
    })
  })

  it('switches to the three-month average at exactly five units', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 2,
      threeMonthAverageOutgoing: 5,
    })).toEqual({
      effectiveMonthlyOutgoing: 5,
      baselineMonthlyOutgoing: 5,
      salesAnomalyDetected: false,
      salesTrend: 'decreasing',
    })
  })

  it('uses current-month outgoing for a new product even when its average is at least five', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 18,
      threeMonthAverageOutgoing: 12,
      isNewProduct: true,
    })).toEqual({
      effectiveMonthlyOutgoing: 18,
      baselineMonthlyOutgoing: 12,
      salesAnomalyDetected: false,
      salesTrend: 'new_product',
    })
  })

  it('identifies a first sale without a prior sales baseline', () => {
    expect(calculatePurchaseSalesTrend({
      currentMonthOutgoing: 2,
      threeMonthAverageOutgoing: 0,
    })).toBe('new_product')
  })

  it('uses current sales for a new product instead of suppressing them as an anomaly', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 39,
      threeMonthAverageOutgoing: 0,
    })).toEqual({
      effectiveMonthlyOutgoing: 39,
      baselineMonthlyOutgoing: 0,
      salesAnomalyDetected: false,
      salesTrend: 'new_product',
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

  it('does not allocate below a purchase minimum or outside its rounding unit', () => {
    const candidate = [{
      sku: 'minimum-10',
      recommendedQuantity: 20,
      stockCoverageMonths: 0,
      effectiveMonthlyOutgoing: 10,
      unitCostKrw: 1000,
      purchaseMinimumQuantity: 10,
      purchaseRoundingUnit: 10,
    }]

    expect(allocatePurchaseBudget(candidate, 9000).items).toHaveLength(0)
    expect(allocatePurchaseBudget(candidate, 15000).items[0]?.allocatedQuantity).toBe(10)
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
