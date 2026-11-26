// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName, type Table } from 'drizzle-orm'

vi.mock('./inbound-board-store', () => ({ listScheduledDomesticInbound: async () => [] }))

const state = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  sku: '100001-0001',
  productName: '테스트 상품',
  domesticStock: 50,
  pipelineQuantity: 0,
  monthlyOutgoing: 100,
  snapshot: null as Record<string, unknown> | null,
  transactionReads: 0,
  ensure: vi.fn(),
}))

vi.mock('@/lib/db', () => {
  function query(data: unknown, limitedData?: unknown) {
    const result = {
      where: () => result,
      groupBy: () => result,
      orderBy: () => result,
      limit: async () => limitedData ?? data,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(data).then(resolve, reject),
    }
    return result
  }
  const tx = {
    execute: async () => undefined,
    select: () => ({
      from: () => ({
        where: async () => {
          state.transactionReads += 1
          return [
            { ...state.current, rawData: { ...(state.current.rawData as Record<string, unknown>) } },
            ...(state.pipelineQuantity > 0 ? [{
              id: 'inbound', sku: state.sku, status: 'purchase_completed',
              actualPurchaseQuantity: state.pipelineQuantity, rawData: {},
            }] : []),
          ]
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { state.current = { ...state.current, ...values } },
      }),
    }),
    insert: () => ({
      values: async (value: { snapshot: Record<string, unknown> }) => { state.snapshot = value.snapshot },
    }),
  }
  return {
    db: {
      select: (selection: Record<string, unknown>) => ({
        from: (table: Table) => {
          if (getTableName(table) === 'china_warehouse_inventory') return query([])
          if ('specialPriceCny' in selection) return query([{ sku: state.sku, specialPriceCny: '10', newCostCny: null }])
          if ('metadata' in selection) return query([{
            sku: state.sku, productName: state.productName,
            metadata: { esa009m: { '특가(元)': '10' } }, purchasingStatus: null,
          }])
          if (!('availableStock' in selection)) return query([], [])
          if (!('optionName' in selection)) return query([])
          return query([{ sku: state.sku, productName: state.productName, optionName: '단품', availableStock: state.domesticStock }])
        },
      }),
      transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx),
    },
  }
})
vi.mock('./purchase-budget-comparison-store', () => ({ ensurePurchaseBudgetComparisonSchema: state.ensure }))
vi.mock('./purchase-order-retention', () => ({ cleanupExpiredEcountPurchaseOrderRows: async () => ({}) }))
vi.mock('@/lib/new-products/cny-cost', () => ({ getLatestCnyKrwReferenceRate: async () => ({ rate: 200 }) }))
vi.mock('./items', () => ({
  getSkuOutgoingMetrics: async () => new Map([[state.sku, {
    currentMonthOutgoing: state.monthlyOutgoing, threeMonthAverageOutgoing: state.monthlyOutgoing,
  }]]),
}))

import { generatePurchaseRecommendations } from './purchase-recommendations'
import { getRecommendationBasis } from './recommendation-basis'

beforeEach(() => {
  state.sku = '100001-0001'
  state.productName = '테스트 상품'
  state.domesticStock = 50
  state.pipelineQuantity = 0
  state.monthlyOutgoing = 100
  state.current = {
    id: 'existing', sku: state.sku, productName: state.productName, optionName: '단품',
    status: 'requested', batchId: 'batch', requestedQuantity: 100,
    actualPurchaseQuantity: null, chinaReceivedQuantity: null, costExchangeRateKrw: null,
    rawData: { source: 'auto_purchase_recommendation' },
  }
  state.snapshot = null
  state.transactionReads = 0
  state.ensure.mockClear()
})

describe('budget recommendation comparison capture', () => {
  it('captures actual review quantities before and after the normal budget allocation in the same transaction', async () => {
    const result = await generatePurchaseRecommendations({
      userId: 'workspace', requestedByUserId: 'actor', targetStockMonths: 1.5,
      budgetKrw: 126_000, now: new Date('2026-10-21T02:00:00.000Z'),
    })
    expect(result.created).toBe(0)
    expect(state.current.requestedQuantity).toBe(60)
    expect(state.ensure).toHaveBeenCalledOnce()
    expect(state.transactionReads).toBe(2)
    expect(state.snapshot).toMatchObject({
      targetStockMonths: 1.5, budgetKrw: 126_000, spentBudgetKrw: 126_000,
      rows: [{ sku: '100001-0001', beforeQuantity: 100, baselineQuantity: 100, allocatedQuantity: 60, afterQuantity: 60, change: '수량 감소' }],
    })
  })

  it('keeps a fully excluded prior SKU in the comparison even when it disappears from the review list', async () => {
    await generatePurchaseRecommendations({
      userId: 'workspace', requestedByUserId: 'actor', targetStockMonths: 1.5,
      budgetKrw: 1, now: new Date('2026-10-21T02:00:00.000Z'),
    })
    expect(state.current.requestedQuantity).toBe(0)
    expect(state.snapshot).toMatchObject({
      rows: [{ sku: '100001-0001', beforeQuantity: 100, baselineQuantity: 100, afterQuantity: 0, change: '제외', reason: '예산 제한' }],
    })
  })

  it('does not create a comparison when no budget was requested', async () => {
    await generatePurchaseRecommendations({
      userId: 'workspace', requestedByUserId: 'actor', targetStockMonths: 1.5,
      now: new Date('2026-10-21T02:00:00.000Z'),
    })
    expect(state.current.requestedQuantity).toBe(100)
    expect(state.ensure).not.toHaveBeenCalled()
    expect(state.transactionReads).toBe(1)
    expect(state.snapshot).toBeNull()
  })
})

describe('Mini Stepper 60 percent MOQ gate', () => {
  it('preserves the shortage, holds a small top-up, and explains the domestic stock warning', async () => {
    state.sku = '101542-0001'
    state.productName = 'CABOSS 미니스텝퍼'
    state.current = { ...state.current, sku: state.sku, productName: state.productName, requestedQuantity: 300 }
    state.monthlyOutgoing = 275
    state.domesticStock = -47
    state.pipelineQuantity = 400

    await generatePurchaseRecommendations({
      userId: 'workspace', requestedByUserId: 'actor', targetStockMonths: 1.3, budgetKrw: 1_000_000,
    })

    expect(state.current).toMatchObject({
      requestedQuantity: 0,
      rawData: {
        targetStockQuantity: 358, availableStockWithPipeline: 353, baseRecommendedQuantity: 5,
        moqAdjustedQuantity: 0, allocatedQuantity: 0,
        moqStockReview: { reorderStockPercent: 60, deferred: true, domesticOutOfStock: true, pipelineQuantity: 400 },
      },
    })
    expect(getRecommendationBasis(state.current.rawData as Record<string, unknown>, null)?.notes
      .map((note) => note.label)).toEqual([
      '판매 유지',
      'MOQ 발주 보류 · 목표재고의 98.6% 확보 · 60% 이하에서 발주검토',
      '국내재고 부족 · 진행 중 400개 국내 입고 예정일 확인',
      '진행 중 발주 400',
    ])
  })

  it.each([
    { sku: '101542-0001', name: 'CABOSS 미니스텝퍼', stock: 181, quantity: 0 },
    { sku: '101542-0001', name: 'CABOSS 미니스텝퍼', stock: 180, quantity: 300 },
    { sku: '101542-0001', name: 'CABOSS 미니스텝퍼', stock: 179, quantity: 300 },
    { sku: '123456-0001', name: '테피 USB 캔들라이터', stock: 290, quantity: 200 },
  ])('recommends $quantity for $name with $stock of 300 units available', async ({ sku, name, stock, quantity }) => {
    state.sku = sku
    state.productName = name
    state.current = { ...state.current, sku, productName: name }
    state.monthlyOutgoing = 250
    state.domesticStock = stock

    await generatePurchaseRecommendations({
      userId: 'workspace', requestedByUserId: 'actor', targetStockMonths: 1.2,
    })

    expect(state.current.requestedQuantity).toBe(quantity)
  })
})
