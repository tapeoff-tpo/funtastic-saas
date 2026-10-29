import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: { select: mocks.select } }))

import { products } from '@/lib/db/schema'
import { getPurchasingItemLabelDataBySku, getPurchasingItemLocationsBySku } from './items'

const dialect = new PgDialect()

function queryForCall(index: number) {
  return dialect.sqlToQuery(mocks.where.mock.calls[index][0] as SQL)
}

describe('getPurchasingItemLocationsBySku', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.select.mockReturnValue({ from: mocks.from })
    mocks.from.mockReturnValue({ where: mocks.where })
  })

  it('reads item-master locations only for the requested workspace and SKUs', async () => {
    const rows = [
      { userId: 'workspace-owner', internalSku: 'SKU-1', metadata: { esa009m: { '한국창고기준 위치': 'A-01' } } },
      { userId: 'workspace-owner', internalSku: 'SKU-2', metadata: { esa009m: { '한국창고기준 위치': '' } }, warehouseLocation: 'STALE' },
      { userId: 'workspace-owner', internalSku: 'SKU-3', metadata: {}, warehouseLocation: 'STALE' },
      { userId: 'workspace-owner', internalSku: 'SKU-4', metadata: { esa009m: { '한국창고기준 위치': 42 } } },
      { userId: 'other-user', internalSku: 'SKU-1', metadata: { esa009m: { '한국창고기준 위치': 'WRONG' } } },
    ]
    mocks.where.mockImplementation(async (condition: SQL) => {
      const query = dialect.sqlToQuery(condition)
      const [owner, ...skus] = query.params
      return rows.filter((row) => row.userId === owner && skus.includes(row.internalSku))
    })

    const result = await getPurchasingItemLocationsBySku('workspace-owner', [
      ' SKU-1 ', 'SKU-1', 'SKU-2', 'SKU-3', 'SKU-4', 'MISSING', '',
    ])

    expect(mocks.from).toHaveBeenCalledWith(products)
    expect(queryForCall(0).sql).toContain('"products"."user_id" = $1')
    expect(queryForCall(0).sql).toContain('"products"."internal_sku" in')
    expect(queryForCall(0).params).toEqual(['workspace-owner', 'SKU-1', 'SKU-2', 'SKU-3', 'SKU-4', 'MISSING'])
    expect(Object.fromEntries(result)).toEqual({ 'SKU-1': 'A-01', 'SKU-2': '', 'SKU-3': '', 'SKU-4': '42' })
    expect(result.has('MISSING')).toBe(false)
  })

  it('returns Chinese names without changing source location data or guessing missing values', async () => {
    mocks.where.mockResolvedValue([
      { internalSku: 'SKU-1', metadata: { chineseProductName: ' 多孔衣架 ', esa009m: { '한국창고기준 위치': 'A-01' } } },
      { internalSku: 'SKU-2', metadata: { chineseProductName: 123 } },
      { internalSku: 'SKU-3', metadata: null },
    ])
    const result = await getPurchasingItemLabelDataBySku('workspace-owner', [' SKU-1 ', 'SKU-2', 'SKU-3'])
    expect(queryForCall(0).params).toEqual(['workspace-owner', 'SKU-1', 'SKU-2', 'SKU-3'])
    expect(Object.fromEntries(result)).toEqual({
      'SKU-1': { location: 'A-01', chineseProductName: '多孔衣架' },
      'SKU-2': { location: '', chineseProductName: '' },
      'SKU-3': { location: '', chineseProductName: '' },
    })
  })

  it('deduplicates SKUs and queries in batches of at most 500', async () => {
    mocks.where.mockResolvedValue([])
    const skus = Array.from({ length: 501 }, (_, index) => `SKU-${index}`)

    await getPurchasingItemLocationsBySku('workspace-owner', [...skus, skus[0], ''])

    expect(mocks.where).toHaveBeenCalledTimes(2)
    expect(queryForCall(0).params).toEqual(['workspace-owner', ...skus.slice(0, 500)])
    expect(queryForCall(1).params).toEqual(['workspace-owner', skus[500]])
  })

  it('skips an empty lookup and propagates database errors', async () => {
    expect(await getPurchasingItemLocationsBySku('workspace-owner', ['', '  '])).toEqual(new Map())
    expect(mocks.select).not.toHaveBeenCalled()

    mocks.where.mockRejectedValue(new Error('database unavailable'))
    await expect(getPurchasingItemLocationsBySku('workspace-owner', ['SKU-1']))
      .rejects.toThrow('database unavailable')
  })
})
