import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), outgoing: vi.fn(), cleanup: vi.fn() }))
vi.mock('@/lib/db', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return { db: drizzle(mocks.query) }
})
vi.mock('./product-name-cleanup', () => ({ normalizeStoredInventoryProductNames: mocks.cleanup }))
vi.mock('@/lib/purchasing/items', () => ({ getSkuOutgoingMetrics: mocks.outgoing }))
import { getInventoryList } from './queries'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockImplementation(async (query: string) => ({ rows: query.startsWith('select count(*)') ? [[137]] : [] }))
})

describe('inventory pagination', () => {
  it('returns the grouped total without downloading every matching SKU', async () => {
    const result = await getInventoryList('owner', { page: 8, search: 'cup', warehouseZone: '쿠팡', maxStock: 10 })
    expect(result).toEqual({ items: [], total: 137 })
    expect(mocks.query).toHaveBeenCalledTimes(2)
    const calls = mocks.query.mock.calls as [string, unknown[]][]
    const countQuery = calls.find(([query]) => query.startsWith('select count(*)'))!
    expect(countQuery[0]).toContain('from (select')
    expect(countQuery[0]).toContain('group by')
    expect(countQuery[0]).toContain('having')
    expect(countQuery[0]).toContain('BOOL_OR')
    expect(countQuery[0]).not.toContain('limit')
    expect(countQuery[1]).toEqual(['owner', '%cup%', '%cup%', '%cup%', '쿠팡', 10])
    expect(calls.find(([query]) => !query.startsWith('select count(*)'))?.[1]).toEqual([...countQuery[1], 50, 350])
    expect(mocks.outgoing).not.toHaveBeenCalled()
    expect(mocks.cleanup).not.toHaveBeenCalled()
  })

  it('enriches only the visible page with summary metrics and never rewrites names during search', async () => {
    mocks.query.mockImplementation(async (query: string) => ({ rows: query.startsWith('select count(*)')
      ? [[1]]
      : [['id', 'id', 'SKU-1', '상품', null, '1창고', 'A', 10, 10, 0, 0, 10, '2026-11-09T00:00:00Z']] }))
    mocks.outgoing.mockResolvedValue(new Map([['SKU-1', { currentMonthOutgoing: 20, threeMonthAverageOutgoing: 42 }]]))
    const result = await getInventoryList('owner', { search: '상품' })
    expect(result.items[0]).toMatchObject({ sku: 'SKU-1', availableStock: 10, currentMonthOutgoing: 20, threeMonthAverageOutgoing: 42 })
    expect(mocks.outgoing).toHaveBeenCalledWith('owner', ['SKU-1'], undefined, 'summary')
    expect(mocks.cleanup).not.toHaveBeenCalled()
  })

  it('reads only the selected historical snapshot and passes its month to outgoing metrics', async () => {
    mocks.query.mockImplementation(async (query: string) => ({ rows: query.startsWith('select count(*)')
      ? [[1]]
      : [['id', 'id', 'SKU-1', '상품', null, '1창고', 'A', 10, 10, 0, 0, 10, '2026-11-09T00:00:00Z']] }))
    mocks.outgoing.mockResolvedValue(new Map())
    await getInventoryList('owner', { referenceMonth: '2025-12' })
    expect(mocks.outgoing).toHaveBeenLastCalledWith('owner', ['SKU-1'], new Date('2025-11-30T15:00:00Z'), 'historical-summary')
    const result = await getInventoryList('owner', { referenceMonth: '2026-01' })
    expect(mocks.outgoing).toHaveBeenLastCalledWith('owner', ['SKU-1'], new Date('2025-12-31T15:00:00Z'), 'historical-summary')
    expect(result.items[0].availableStock).toBe(10)
    for (const [query, params] of mocks.query.mock.calls as [string, unknown[]][]) {
      expect(query).toContain('"inventory_month_end_stock"')
      expect(query).toContain('"reference_month"')
      expect(params).toContain('owner')
      expect(params.some((value) => value === '2025-12' || value === '2026-01')).toBe(true)
      expect(query).not.toContain('from "inventory"')
    }
  })
})
