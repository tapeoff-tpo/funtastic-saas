import { describe, expect, it } from 'vitest'
import scoringConfig from '../../../config/opportunity-scoring.json'
import { analyzeOpportunities } from './analysis'
import type { MonthlyProductMetrics, OpportunityScoringConfig, ProductOpportunitySource } from './types'

function monthly(quantity: number, profit: number): MonthlyProductMetrics[] {
  return Array.from({ length: 12 }, (_, index) => ({
    month: `2025-${String(index + 1).padStart(2, '0')}`,
    quantity,
    orderCount: quantity,
    sales: quantity * 1000,
    productCost: quantity * 300,
    marketplaceFee: quantity * 100,
    paidShippingFee: 0,
    actualShippingFee: 0,
    boxCost: 0,
    finalProfit: profit,
    returnOrderCount: 0,
  }))
}

function product(input: Partial<ProductOpportunitySource> & Pick<ProductOpportunitySource, 'sku' | 'productName'>): ProductOpportunitySource {
  return {
    optionNames: [],
    categoryId: null,
    basePrice: null,
    costPrice: null,
    currentStock: null,
    images: [],
    metadata: {},
    stockoutEventCount: null,
    repeatBuyerRate: null,
    monthly: monthly(1, 100),
    ...input,
  }
}

describe('analyzeOpportunities', () => {
  it('ranks stronger demand and profit above weaker products', () => {
    const result = analyzeOpportunities({
      products: [
        product({ sku: 'LOW', productName: '일반 리필', monthly: monthly(2, 100) }),
        product({ sku: 'HIGH', productName: '커튼 홀딩 후크', monthly: monthly(20, 5000) }),
      ],
      config: scoringConfig as OpportunityScoringConfig,
      userId: 'test-user',
      asOfDate: new Date('2026-01-01T00:00:00Z'),
    })

    expect(result.products[0].sku).toBe('HIGH')
    expect(result.products[0].periods['12'].quantity).toBe(240)
    expect(result.products[0].scores.printability.score).toBe(4)
  })

  it('marks safety-critical keyword candidates as excluded', () => {
    const result = analyzeOpportunities({
      products: [product({ sku: 'BABY', productName: '유아 안전 보호 후크' })],
      config: scoringConfig as OpportunityScoringConfig,
      userId: 'test-user',
      asOfDate: new Date('2026-01-01T00:00:00Z'),
    })

    expect(result.products[0].excluded).toBe(true)
    expect(result.products[0].scores.safetyAndLegal.score).toBe(1)
  })

  it('does not invent printability when no structural evidence exists', () => {
    const result = analyzeOpportunities({
      products: [product({ sku: 'UNKNOWN', productName: '생활용품' })],
      config: scoringConfig as OpportunityScoringConfig,
      userId: 'test-user',
      asOfDate: new Date('2026-01-01T00:00:00Z'),
    })

    expect(result.products[0].scores.printability.score).toBeNull()
    expect(result.products[0].scores.printability.evidenceLevel).toBe('unverified')
  })

  it('does not let missing structural evidence inflate a candidate rank', () => {
    const result = analyzeOpportunities({
      products: [
        product({ sku: 'UNKNOWN', productName: '생활용품' }),
        product({ sku: 'SCREENED', productName: '데스크 정리 홀더' }),
      ],
      config: scoringConfig as OpportunityScoringConfig,
      userId: 'test-user',
      asOfDate: new Date('2026-01-01T00:00:00Z'),
    })

    expect(result.products[0].sku).toBe('SCREENED')
    expect(result.products.find((item) => item.sku === 'UNKNOWN')?.scores.printability.score).toBeNull()
  })

  it('does not confirm profitability when sold products have no cost basis', () => {
    const noCost = monthly(10, 9000).map((row) => ({ ...row, productCost: 0 }))
    const result = analyzeOpportunities({
      products: [product({ sku: 'NO-COST', productName: '정리 홀더', monthly: noCost })],
      config: scoringConfig as OpportunityScoringConfig,
      userId: 'test-user',
      asOfDate: new Date('2026-01-01T00:00:00Z'),
    })

    expect(result.products[0].scores.profitability.score).toBeNull()
    expect(result.products[0].missingFields).toContain('profitCostBasis')
  })
})
