import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))
import { getAnalyticsPeriod, getSalesAnalytics } from './queries'

const dialect = new PgDialect()
const period = getAnalyticsPeriod({ month: '2026-11' })
const row = {
  orders: 2, gross_sales: '100', paid_shipping: '3', shipping_value_orders: 2, shipping_nonzero_orders: 1,
  line_count: 2, cost_known_lines: 2, marketplace: 'shop', sales: '100', sku: 'SKU', product_name: '상품', units: 3,
  cost_price: '2', shipping_cost: '1', current_sales: '100', previous_sales: '50', count: 1,
  available_stock: 4, last_incoming_at: '2026-11-01', sold_since_incoming: 1, sku_count: 1, history_count: 1, latest_incoming_at: '2026-11-01',
}
beforeEach(() => { mocks.execute.mockReset(); mocks.execute.mockResolvedValue([row]) })
describe('analytics work per screen', () => {
  it.each([
    ['overview', 5, ['previous', 'claims', 'channelProductDrops', 'channelProductRises']],
    ['channels', 4, ['channels', 'products']],
    ['products', 3, ['productPerformance']],
  ] as const)('runs only %s screen queries while preserving the displayed figures', async (view, count, fields) => {
    const all = await getSalesAnalytics('owner', period)
    expect(mocks.execute).toHaveBeenCalledTimes(12)
    mocks.execute.mockClear()
    const scoped = await getSalesAnalytics('owner', period, view)
    expect(mocks.execute).toHaveBeenCalledTimes(count)
    expect(scoped.summary.orders).toBe(all.summary.orders)
    expect(scoped.summary.grossSales).toBe(all.summary.grossSales)
    if (view !== 'overview') expect(scoped.summary.productCostCoverage).toBe(all.summary.productCostCoverage)
    for (const field of fields) expect(scoped[field]).toEqual(all[field])
    for (const [statement] of mocks.execute.mock.calls as [SQL][]) {
      expect(dialect.sqlToQuery(statement).params).toContain('owner')
    }
  })
})
