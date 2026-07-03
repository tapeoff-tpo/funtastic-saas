import { describe, expect, it } from 'vitest'
import {
  calculatePurchaseRecommendation,
  getManualOutgoingMetrics,
} from '@/lib/purchasing/purchase-recommendations'

describe('calculatePurchaseRecommendation', () => {
  it('recommends the quantity needed to reach the target stock months', () => {
    const result = calculatePurchaseRecommendation({
      averageMonthlyOutgoing: 10,
      currentMonthOutgoing: 3,
      availableStock: 5,
      targetStockMonths: 1.2,
    })

    expect(result).toEqual({
      targetStockQuantity: 12,
      recommendedQuantity: 7,
      stockCoverageMonths: 0.5,
    })
  })

  it('does not recommend a purchase when current stock already covers the target', () => {
    const result = calculatePurchaseRecommendation({
      averageMonthlyOutgoing: 10,
      currentMonthOutgoing: 1,
      availableStock: 15,
      targetStockMonths: 1.2,
    })

    expect(result.recommendedQuantity).toBe(0)
    expect(result.targetStockQuantity).toBe(12)
  })

  it('does not recommend a purchase when there is no recent outgoing average', () => {
    const result = calculatePurchaseRecommendation({
      averageMonthlyOutgoing: 0,
      currentMonthOutgoing: 4,
      availableStock: 0,
      targetStockMonths: 1.2,
    })

    expect(result.recommendedQuantity).toBe(0)
    expect(result.targetStockQuantity).toBe(0)
    expect(result.stockCoverageMonths).toBeNull()
  })
})

describe('getManualOutgoingMetrics', () => {
  it('uses outgoing quantities stored on the purchasing item metadata', () => {
    expect(getManualOutgoingMetrics({
      purchasingMetrics: {
        currentMonthOutgoing: 8,
        threeMonthAverageOutgoing: 21.5,
      },
    })).toEqual({
      currentMonthOutgoing: 8,
      averageMonthlyOutgoing: 21.5,
    })
  })
})
