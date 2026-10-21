// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName, type Table } from 'drizzle-orm'

const state = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
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
          return [{ ...state.current, rawData: { ...(state.current.rawData as Record<string, unknown>) } }]
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
          if ('specialPriceCny' in selection) return query([{ sku: '100001-0001', specialPriceCny: '10', newCostCny: null }])
          if ('metadata' in selection) return query([{
            sku: '100001-0001', productName: '테스트 상품',
            metadata: { esa009m: { '특가(元)': '10' } }, purchasingStatus: null,
          }])
          if (!('availableStock' in selection)) return query([], [])
          if (!('optionName' in selection)) return query([])
          return query([{ sku: '100001-0001', productName: '테스트 상품', optionName: '단품', availableStock: 50 }])
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
  getSkuOutgoingMetrics: async () => new Map([['100001-0001', {
    currentMonthOutgoing: 100, threeMonthAverageOutgoing: 100,
  }]]),
}))

import { generatePurchaseRecommendations } from './purchase-recommendations'

describe('budget recommendation comparison capture', () => {
  beforeEach(() => {
    state.current = {
      id: 'existing', sku: '100001-0001', productName: '테스트 상품', optionName: '단품',
      status: 'requested', batchId: 'batch', requestedQuantity: 100,
      actualPurchaseQuantity: null, chinaReceivedQuantity: null, costExchangeRateKrw: null,
      rawData: { source: 'auto_purchase_recommendation' },
    }
    state.snapshot = null
    state.transactionReads = 0
    state.ensure.mockClear()
  })

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
