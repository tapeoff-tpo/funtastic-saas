import { describe, expect, it } from 'vitest'
import {
  applyPurchaseMinimumQuantity,
  allocatePurchaseBudget,
  calculatePurchaseRecommendation,
  calculatePurchaseRecommendationWithSpikeGuard,
  calculatePurchaseSalesTrend,
  getNearTargetDeferShortfallThreshold,
  getSiblingOptionBundleSkus,
  getSeasonalPurchaseDemandMultiplier,
  isSeasonallyExcludedFromPurchaseRecommendation,
  isWinterSeasonalPurchaseProduct,
  calculateStableMonthlyOutgoing,
  formatSeoulDate,
  getProductGroupMoqRule,
  includeDemandOnlyRecommendationInventoryRows,
  isDomesticPurchaseProduct,
  isDiscontinuedPurchaseProduct,
  isExcludedPurchaseRecommendation,
  isPendingChinaInventorySnapshot,
  purchasePipelineQuantity,
  shouldDeferNearTargetPurchaseRecommendation,
} from './purchase-recommendations'
import { isDiscontinuedPurchasingStatus } from './purchase-delay'

describe('purchase minimum quantities', () => {
  it('uses the cost-based existing-product minimum and the 3-unit 10-rounding rule', () => {
    expect(applyPurchaseMinimumQuantity(0)).toBe(0)
    expect(applyPurchaseMinimumQuantity(1, { unitCostKrw: 7000 })).toBe(10)
    expect(applyPurchaseMinimumQuantity(12, { unitCostKrw: 7000 })).toBe(10)
    expect(applyPurchaseMinimumQuantity(13, { unitCostKrw: 7000 })).toBe(20)
    expect(applyPurchaseMinimumQuantity(22, { unitCostKrw: 7000 })).toBe(20)
    expect(applyPurchaseMinimumQuantity(23, { unitCostKrw: 7000 })).toBe(30)
    expect(applyPurchaseMinimumQuantity(1, { unitCostKrw: 6999 })).toBe(20)
    expect(applyPurchaseMinimumQuantity(11, { unitCostKrw: null })).toBe(20)
    expect(applyPurchaseMinimumQuantity(10, {
      unitCostKrw: 1000,
      siblingOptionBundle: true,
    })).toBe(10)
  })

  it('keeps a new-product shortage above three units as its whole quantity', () => {
    expect(applyPurchaseMinimumQuantity(3, { isNewProduct: true })).toBe(10)
    expect(applyPurchaseMinimumQuantity(4, { isNewProduct: true })).toBe(4)
    expect(applyPurchaseMinimumQuantity(13, { isNewProduct: true })).toBe(13)
  })
})

describe('near-target deferral and sibling option bundles', () => {
  it('defers only a small shortage that is within 0.1 month of the target', () => {
    expect(getNearTargetDeferShortfallThreshold(20.3)).toBe(3)
    expect(shouldDeferNearTargetPurchaseRecommendation({
      shortfallQuantity: 1,
      effectiveMonthlyOutgoing: 20.3,
      availableStockWithPipeline: 30,
      targetStockMonths: 1.5,
      isNewProduct: false,
      hasProductGroupMoq: false,
    })).toBe(true)
    expect(shouldDeferNearTargetPurchaseRecommendation({
      shortfallQuantity: 1,
      effectiveMonthlyOutgoing: 5.3,
      availableStockWithPipeline: 7,
      targetStockMonths: 1.5,
      isNewProduct: false,
      hasProductGroupMoq: false,
    })).toBe(false)
    expect(shouldDeferNearTargetPurchaseRecommendation({
      shortfallQuantity: 1,
      effectiveMonthlyOutgoing: 20.3,
      availableStockWithPipeline: 0,
      targetStockMonths: 1.5,
      isNewProduct: false,
      hasProductGroupMoq: false,
    })).toBe(false)
    expect(shouldDeferNearTargetPurchaseRecommendation({
      shortfallQuantity: 1,
      effectiveMonthlyOutgoing: 20.3,
      availableStockWithPipeline: 30,
      targetStockMonths: 1.5,
      isNewProduct: true,
      hasProductGroupMoq: false,
    })).toBe(false)
  })

  it('adds only the near-target sibling options when another option is being purchased', () => {
    const bundleSkus = getSiblingOptionBundleSkus([
      {
        sku: '109020-0001',
        productName: '로딕슨 오픈형 폴딩 박스',
        isNewProduct: false,
        moqProductGroupName: null,
        recommendedQuantity: 1,
        availableStockWithPipeline: 7,
        averageMonthlyOutgoing: 5.3,
      },
      {
        sku: '109020-0002',
        productName: '로딕슨 오픈형 폴딩 박스',
        isNewProduct: false,
        moqProductGroupName: null,
        recommendedQuantity: 0,
        availableStockWithPipeline: 14,
        averageMonthlyOutgoing: 2,
      },
      {
        sku: '109020-0003',
        productName: '로딕슨 오픈형 폴딩 박스',
        isNewProduct: false,
        moqProductGroupName: null,
        recommendedQuantity: 0,
        availableStockWithPipeline: 4,
        averageMonthlyOutgoing: 3,
      },
    ], 1.5)

    expect([...bundleSkus].sort()).toEqual(['109020-0001', '109020-0003'])
  })

  it('does not create a sibling bundle for MOQ product groups', () => {
    const bundleSkus = getSiblingOptionBundleSkus([
      {
        sku: 'moq-a',
        productName: 'MOQ 상품',
        isNewProduct: false,
        moqProductGroupName: 'MOQ 상품',
        recommendedQuantity: 1,
        availableStockWithPipeline: 7,
        averageMonthlyOutgoing: 5,
      },
      {
        sku: 'moq-b',
        productName: 'MOQ 상품',
        isNewProduct: false,
        moqProductGroupName: 'MOQ 상품',
        recommendedQuantity: 0,
        availableStockWithPipeline: 6,
        averageMonthlyOutgoing: 5,
      },
    ], 1.5)

    expect([...bundleSkus]).toEqual([])
  })
})

describe('China-arrival purchase pipeline', () => {
  it('counts only the amount missing from the latest China-inventory snapshot', () => {
    expect(purchasePipelineQuantity({
      status: 'china_arrived',
      requestedQuantity: 400,
      actualPurchaseQuantity: 400,
      chinaReceivedQuantity: 400,
      rawData: {
        pendingChinaInventorySnapshot: true,
        pendingChinaInventoryQuantity: 20,
      },
    })).toBe(20)
  })

  it('does not count a China-arrival row already reflected in China inventory', () => {
    expect(isPendingChinaInventorySnapshot({ pendingChinaInventorySnapshot: false })).toBe(false)
    expect(purchasePipelineQuantity({
      status: 'china_arrived',
      requestedQuantity: 400,
      actualPurchaseQuantity: 400,
      chinaReceivedQuantity: 400,
      rawData: { pendingChinaInventorySnapshot: false },
    })).toBe(0)
  })
})

describe('purchase recommendation candidate coverage', () => {
  it('adds products with outbound demand but no inventory row as zero-stock candidates', () => {
    const rows = includeDemandOnlyRecommendationInventoryRows({
      inventoryRows: [{
        sku: 'in-stock',
        productName: '재고 보유 상품',
        optionName: '기본',
        availableStock: 8,
        domesticAvailableStock: 8,
        chinaAvailableStock: 0,
      }],
      productRows: [
        { sku: 'in-stock', productName: '재고 보유 상품' },
        { sku: 'sales-only', productName: '출고 이력만 있는 상품' },
        { sku: 'manual-average', productName: '수동 평균만 있는 상품' },
        { sku: 'no-demand', productName: '수요 없는 상품' },
      ],
      outgoingMetricsBySku: new Map([
        ['sales-only', { currentMonthOutgoing: 12, threeMonthAverageOutgoing: 4 }],
        ['manual-average', { currentMonthOutgoing: 0, threeMonthAverageOutgoing: 7.5 }],
        ['no-demand', { currentMonthOutgoing: 0, threeMonthAverageOutgoing: 0 }],
      ]),
    })

    expect(rows).toEqual([
      {
        sku: 'in-stock',
        productName: '재고 보유 상품',
        optionName: '기본',
        availableStock: 8,
        domesticAvailableStock: 8,
        chinaAvailableStock: 0,
      },
      {
        sku: 'sales-only',
        productName: '출고 이력만 있는 상품',
        optionName: null,
        availableStock: 0,
        domesticAvailableStock: 0,
        chinaAvailableStock: 0,
      },
      {
        sku: 'manual-average',
        productName: '수동 평균만 있는 상품',
        optionName: null,
        availableStock: 0,
        domesticAvailableStock: 0,
        chinaAvailableStock: 0,
      },
    ])
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

  it('excludes the domestic-purchase light bulb SKUs from China purchase recommendations', () => {
    expect(isExcludedPurchaseRecommendation('100287-0001')).toBe(true)
    expect(isExcludedPurchaseRecommendation('100287-0002')).toBe(true)
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
  it('blends a sharp increase when current-month sales are spread across orders', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 100,
      threeMonthAverageOutgoing: 50,
      currentMonthOrderCount: 20,
      currentMonthLargestOrderQuantity: 5,
    })).toEqual({
      effectiveMonthlyOutgoing: 75,
      baselineMonthlyOutgoing: 50,
      salesAnomalyDetected: false,
      salesTrend: 'increasing',
    })
  })

  it('blends the average and current-month sales for an established product with a clear upward trend', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 70,
      threeMonthAverageOutgoing: 50,
    })).toEqual({
      effectiveMonthlyOutgoing: 60,
      baselineMonthlyOutgoing: 50,
      salesAnomalyDetected: false,
      salesTrend: 'increasing',
    })
  })

  it('uses the 50/50 trend basis for a 33.3-average item that reaches 43 this month', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 43,
      threeMonthAverageOutgoing: 33.3,
    })).toEqual({
      effectiveMonthlyOutgoing: 38.2,
      baselineMonthlyOutgoing: 33.3,
      salesAnomalyDetected: false,
      salesTrend: 'increasing',
    })
  })

  it('blends even a small current-month increase with the completed-period average', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 39,
      threeMonthAverageOutgoing: 33.3,
    })).toEqual({
      effectiveMonthlyOutgoing: 36.2,
      baselineMonthlyOutgoing: 33.3,
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

  it('keeps the completed-period average for a low-volume product when current sales fall', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 2,
      threeMonthAverageOutgoing: 4,
    })).toEqual({
      effectiveMonthlyOutgoing: 4,
      baselineMonthlyOutgoing: 4,
      salesAnomalyDetected: false,
      salesTrend: 'decreasing',
    })
  })

  it('excludes a low-baseline spike when one order accounts for nearly all current-month sales', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 101,
      threeMonthAverageOutgoing: 1.3,
      currentMonthOrderCount: 1,
      currentMonthLargestOrderQuantity: 101,
    })).toEqual({
      effectiveMonthlyOutgoing: 1.3,
      baselineMonthlyOutgoing: 1.3,
      salesAnomalyDetected: true,
      salesTrend: 'steady',
    })
  })

  it('caps an extreme established-product increase at twice the three-month average', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 20,
      threeMonthAverageOutgoing: 3,
      currentMonthOrderCount: 24,
      currentMonthLargestOrderQuantity: 4,
    })).toEqual({
      effectiveMonthlyOutgoing: 6,
      baselineMonthlyOutgoing: 3,
      salesAnomalyDetected: false,
      salesTrend: 'capped_increase',
    })
  })

  it('caps the low-average current-month jump from the purchase review case', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 15,
      threeMonthAverageOutgoing: 4.3,
    })).toEqual({
      effectiveMonthlyOutgoing: 8.6,
      baselineMonthlyOutgoing: 4.3,
      salesAnomalyDetected: false,
      salesTrend: 'capped_increase',
    })
  })

  it('falls back to the three-month average when a low-sales item has no current-month outgoing', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 0,
      threeMonthAverageOutgoing: 1.7,
    })).toEqual({
      effectiveMonthlyOutgoing: 1.7,
      baselineMonthlyOutgoing: 1.7,
      salesAnomalyDetected: false,
      salesTrend: 'steady',
    })
  })

  it('keeps new products on the current-month basis even when an old average exists', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 0,
      threeMonthAverageOutgoing: 1.7,
      isNewProduct: true,
    })).toEqual({
      effectiveMonthlyOutgoing: 0,
      baselineMonthlyOutgoing: 1.7,
      salesAnomalyDetected: false,
      salesTrend: 'new_product',
    })
  })

  it('uses the current-month basis after higher demand continues for three months', () => {
    expect(calculateStableMonthlyOutgoing({
      currentMonthOutgoing: 20,
      threeMonthAverageOutgoing: 14.3,
      recentCompletedMonthOutgoing: [20, 20],
    })).toEqual({
      effectiveMonthlyOutgoing: 20,
      baselineMonthlyOutgoing: 14.3,
      salesAnomalyDetected: false,
      salesTrend: 'sustained_increase',
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

describe('seasonal purchase demand reduction', () => {
  it('reduces known summer products from August 15 onward', () => {
    expect(getSeasonalPurchaseDemandMultiplier(
      '수니 자외선차단 루즈핏 쿨토시_펀타스틱',
      new Date('2026-08-15T00:00:00+09:00'),
    )).toBe(0.25)
  })

  it('does not reduce summer products before the off-season starts', () => {
    expect(getSeasonalPurchaseDemandMultiplier(
      '글라손 핸드폰 미니팬',
      new Date('2026-08-14T23:59:59+09:00'),
    )).toBe(1)
  })

  it('does not reduce non-seasonal products', () => {
    expect(getSeasonalPurchaseDemandMultiplier(
      '생활살림 거품수세미_펀타스틱',
      new Date('2026-08-27T12:00:00+09:00'),
    )).toBe(1)
  })

  it('excludes known summer products from recommendations in the October-to-April off-season', () => {
    const october = new Date('2026-10-15T12:00:00+09:00')
    expect(isSeasonallyExcludedFromPurchaseRecommendation('빙수기 얼음틀', october)).toBe(true)
    expect(getSeasonalPurchaseDemandMultiplier('빙수기 얼음틀', october)).toBe(0)
    expect(isSeasonallyExcludedFromPurchaseRecommendation(
      '프레스 플랫 선풍기',
      new Date('2027-04-30T12:00:00+09:00'),
    )).toBe(true)
    expect(isSeasonallyExcludedFromPurchaseRecommendation(
      '프레스 플랫 선풍기',
      new Date('2027-05-01T12:00:00+09:00'),
    )).toBe(false)
  })

  it('increases winter-product demand during the winter selling season', () => {
    const october = new Date('2026-10-15T12:00:00+09:00')
    expect(isWinterSeasonalPurchaseProduct('수니 웨이볼라 담요')).toBe(true)
    expect(getSeasonalPurchaseDemandMultiplier('수니 웨이볼라 담요', october)).toBe(1.2)
    expect(getSeasonalPurchaseDemandMultiplier('무스터 겨울 실내 슬리퍼', october)).toBe(1.2)
  })

  it('uses a higher pre-peak multiplier for Christmas products', () => {
    expect(getSeasonalPurchaseDemandMultiplier(
      '크리스마스 파티 장식 세트',
      new Date('2026-10-15T12:00:00+09:00'),
    )).toBe(1.3)
    expect(getSeasonalPurchaseDemandMultiplier(
      '크리스마스 파티 장식 세트',
      new Date('2026-12-01T12:00:00+09:00'),
    )).toBe(1.2)
  })

  it('does not treat all-season products as winter-only products', () => {
    expect(isWinterSeasonalPurchaseProduct('린블 사계절 이불')).toBe(false)
    expect(isWinterSeasonalPurchaseProduct('TYESO 이중보온보냉 텀블러')).toBe(false)
    expect(getSeasonalPurchaseDemandMultiplier(
      '린블 사계절 이불',
      new Date('2026-10-15T12:00:00+09:00'),
    )).toBe(1)
  })
})

describe('purchase recommendation with sales spike guard', () => {
  it('does not recommend when the effective target is already covered', () => {
    const result = calculatePurchaseRecommendationWithSpikeGuard({
      averageMonthlyOutgoing: 50,
      effectiveMonthlyOutgoing: 25,
      currentMonthOutgoing: 100,
      availableStock: 40,
      targetStockMonths: 1.2,
    })

    expect(result.recommendedQuantity).toBe(0)
    expect(result.originalRecommendedQuantity).toBe(20)
    expect(result.spikeGuardAdjustedToMinimum).toBe(false)
  })
})

describe('negative inventory', () => {
  it('uses negative inventory as a real shortage instead of clamping it to zero', () => {
    expect(calculatePurchaseRecommendation({
      averageMonthlyOutgoing: 10,
      currentMonthOutgoing: 0,
      availableStock: -3,
      targetStockMonths: 1.5,
    })).toEqual({
      targetStockQuantity: 15,
      recommendedQuantity: 18,
      stockCoverageMonths: -0.3,
    })
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
      ['missing-cost', 10],
      ['urgent', 10],
      ['steady', 4],
    ])
    expect(result.spentBudgetKrw).toBe(12000)
    expect(result.remainingBudgetKrw).toBe(0)
  })

  it('keeps items without a won unit cost in the recommendation outside the budget total', () => {
    const result = allocatePurchaseBudget(candidates, 50000)

    expect(result.items.some((item) => item.sku === 'missing-cost')).toBe(true)
    expect(result.missingCostUnbudgeted).toBe(1)
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

  it('keeps a sibling option bundle together when a budget is set', () => {
    const siblingOptionBundle = [
      {
        sku: 'bundle-white',
        recommendedQuantity: 10,
        stockCoverageMonths: 1.3,
        effectiveMonthlyOutgoing: 5,
        unitCostKrw: 1000,
        siblingOptionBundleGroupName: '폴딩 박스',
        purchaseMinimumQuantity: 10,
        purchaseRoundingUnit: 10,
      },
      {
        sku: 'bundle-yellow',
        recommendedQuantity: 10,
        stockCoverageMonths: 1.4,
        effectiveMonthlyOutgoing: 3,
        unitCostKrw: 1000,
        siblingOptionBundleGroupName: '폴딩 박스',
        purchaseMinimumQuantity: 10,
        purchaseRoundingUnit: 10,
      },
    ]

    expect(allocatePurchaseBudget(siblingOptionBundle, 19000).items).toHaveLength(0)
    expect(allocatePurchaseBudget(siblingOptionBundle, 20000).items.map((item) => item.sku)).toEqual([
      'bundle-white',
      'bundle-yellow',
    ])
  })
})

describe('Seoul date formatting', () => {
  it('uses the Korean calendar date around the UTC day boundary', () => {
    expect(formatSeoulDate(new Date('2026-07-31T15:30:00.000Z'))).toBe('2026-08-01')
  })
})
