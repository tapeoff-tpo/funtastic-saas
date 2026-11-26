// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName, type SQL, type Table } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

type ReviewRow = {
  id: string
  sku: string
  productName: string
  optionName: string
  status: 'requested' | 'purchase_completed'
  requestedQuantity: number
  actualPurchaseQuantity: number | null
  rawData: Record<string, unknown>
}

const state = vi.hoisted(() => ({
  components: [] as Array<{ sku: string; optionName: string; units: number; stock: number }>,
  reviews: [] as ReviewRow[],
  loadOutgoing: vi.fn(),
}))

vi.mock('@/lib/db', () => {
  function query(data: unknown) {
    const builder = {
      where: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      limit: async () => data,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(data).then(resolve, reject),
    }
    return builder
  }
  const tx = {
    execute: async () => undefined,
    select: () => ({
      from: () => ({ where: async () => state.reviews.map((row) => ({ ...row })) }),
    }),
    update: () => ({
      set: (values: Partial<ReviewRow>) => ({
        where: async (predicate: SQL) => {
          const parameters = new PgDialect().sqlToQuery(predicate).params
          const row = state.reviews.find(({ id }) => parameters.includes(id))
          if (!row) throw new Error('Expected a review row ID in the update predicate')
          Object.assign(row, values)
        },
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  }
  return {
    db: {
      select: (selection: Record<string, unknown>) => ({
        from: (table: Table) => {
          if (getTableName(table) === 'china_warehouse_inventory') return query([])
          if ('specialPriceCny' in selection) {
            return query(state.components.map(({ sku }) => ({ sku, specialPriceCny: '1', newCostCny: null })))
          }
          if ('metadata' in selection) {
            return query(state.components.map(({ sku }) => ({
              sku, productName, metadata: { esa009m: { '특가(元)': '1' } }, purchasingStatus: null,
            })))
          }
          if (!('availableStock' in selection)) return query([])
          return query(state.components.map(({ sku, optionName, stock }) => ({
            sku, productName, optionName, availableStock: stock,
          })))
        },
      }),
      transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx),
    },
  }
})
vi.mock('./purchase-budget-comparison-store', () => ({ ensurePurchaseBudgetComparisonSchema: async () => {} }))
vi.mock('./purchase-order-retention', () => ({ cleanupExpiredEcountPurchaseOrderRows: async () => ({}) }))
vi.mock('@/lib/new-products/cny-cost', () => ({ getLatestCnyKrwReferenceRate: async () => ({ rate: 200 }) }))
vi.mock('./items', () => ({ getSkuOutgoingMetrics: state.loadOutgoing }))

import { generatePurchaseRecommendations } from './purchase-recommendations'

const productName = '챔버트 씰링스티커 종이봉투 세트'
const options = ['버건디', '레드', '브라운', '진베이지', '연베이지', '아이보리', '씰링스티커']
const fixtureDate = new Date('2026-11-26T03:00:00.000Z')
const setCostKrw = (6 + 6) * 210
const existingQuantities = [30, 10, 10, 30, 10, 30, 150]

beforeEach(() => {
  state.components = options.map((optionName, index) => {
    const units = index === 6 ? 6 : 1
    return { sku: `112226-000${index + 1}`, optionName, units, stock: 3 * units }
  })
  state.reviews = state.components.map(({ sku, optionName }, index) => ({
    id: `review-${sku}`, sku, productName, optionName, status: 'requested',
    requestedQuantity: existingQuantities[index],
    actualPurchaseQuantity: null,
    rawData: { source: 'auto_purchase_recommendation' },
  }))
  state.loadOutgoing.mockReset().mockImplementation(async (
    _userId: string, skus: string[], _now: Date, _detail: string, actualBaselineSkus?: ReadonlySet<string>,
  ) => new Map(state.components.filter(({ sku }) => skus.includes(sku)).map(({ sku, units }) => [
    sku,
    {
      currentMonthOutgoing: 49 * units,
      threeMonthAverageOutgoing: actualBaselineSkus?.has(sku) ? (units === 6 ? 64 : 10.7) : 2.3,
      recentCompletedMonthOutgoing: [5 * units, 19 * units],
      currentMonthOrderCount: 10,
      currentMonthLargestOrderQuantity: 35 * units,
    },
  ])))
})

function recommend(budgetKrw?: number) {
  return generatePurchaseRecommendations({
    userId: 'workspace', requestedByUserId: 'actor', targetStockMonths: 1.3, budgetKrw, now: fixtureDate,
  })
}

function reviewQuantities() {
  return state.reviews.filter(({ status }) => status === 'requested').map(({ requestedQuantity }) => requestedQuantity)
}

describe('fixed Chamber purchase recommendations', () => {
  it('uses actual completed-month shipments and orders all 30 complete sets in their component ratios', async () => {
    const result = await recommend()

    expect(state.loadOutgoing.mock.calls[0]?.[4]?.has('112226-0001')).toBe(true)
    expect(reviewQuantities()).toEqual([30, 30, 30, 30, 30, 30, 180])
    expect(result).toMatchObject({ spentBudgetKrw: 30 * setCostKrw })
    expect(state.reviews[0]?.rawData).toMatchObject({
      salesTrend: 'capped_increase',
      fixedSetPurchase: {
        unitsPerSet: 1, availableSets: 3, targetSets: 28, recommendedSets: 30, averageMonthlyOutgoingSets: 10.7,
      },
    })
    expect(state.reviews[6]?.rawData.fixedSetPurchase).toMatchObject({
      unitsPerSet: 6, availableSets: 3, targetSets: 28, recommendedSets: 30,
    })
  })

  it('allocates all components together when the budget can cover the full recommendation', async () => {
    const result = await recommend(30 * setCostKrw)

    expect(reviewQuantities()).toEqual([30, 30, 30, 30, 30, 30, 180])
    expect(result).toMatchObject({ spentBudgetKrw: 30 * setCostKrw, remainingBudgetKrw: 0 })
  })

  it('does not purchase a partial batch when budget falls one won short', async () => {
    const result = await recommend(30 * setCostKrw - 1)

    expect(reviewQuantities()).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(result).toMatchObject({ spentBudgetKrw: 0, remainingBudgetKrw: 30 * setCostKrw - 1 })
  })

  it('holds all component recommendations when the sticker SKU is unavailable', async () => {
    state.components = state.components.filter(({ sku }) => sku !== '112226-0007')

    const result = await recommend()

    expect(reviewQuantities()).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(result).toMatchObject({ spentBudgetKrw: 0 })
    expect(state.reviews[0]?.rawData.fixedSetPurchase).toMatchObject({ unitsPerSet: 1, incomplete: true })
  })

  it('calculates available sets from the limiting component, including its existing inbound stock', async () => {
    const limitingSku = '112226-0002'
    state.components = state.components.map((component) => ({
      ...component, stock: component.sku === limitingSku ? 0 : 60 * component.units,
    }))
    state.reviews.push({
      id: 'inbound-existing', sku: limitingSku, productName, optionName: '레드',
      status: 'purchase_completed', requestedQuantity: 5, actualPurchaseQuantity: 5, rawData: {},
    })

    await recommend()

    expect(reviewQuantities()).toEqual([30, 30, 30, 30, 30, 30, 180])
    expect(state.reviews[0]?.rawData.fixedSetPurchase).toMatchObject({
      availableSets: 5, targetSets: 28, recommendedSets: 30,
    })
    expect(state.reviews.find(({ id }) => id === 'inbound-existing')?.actualPurchaseQuantity).toBe(5)
  })
})
