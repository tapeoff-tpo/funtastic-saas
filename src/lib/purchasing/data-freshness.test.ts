import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))
import { getPurchasingDataFreshness } from './data-freshness'

beforeEach(() => vi.clearAllMocks())
describe('purchasing freshness reads', () => {
  it('reads the existing workspace without schema writes or index locks', async () => {
    mocks.execute.mockResolvedValue([{ targetStockMonths: '1.2' }])
    expect(await getPurchasingDataFreshness('owner')).toMatchObject({ targetStockMonths: '1.2' })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0] as SQL)
    expect(query.sql).not.toMatch(/CREATE|ALTER|INSERT/)
    expect(query.params.every((value) => value === 'owner')).toBe(true)
  })
  it('initializes a missing event table and retries once without suppressing other failures', async () => {
    mocks.execute.mockRejectedValueOnce({ cause: { code: '42P01' } }).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    expect(await getPurchasingDataFreshness('owner')).toMatchObject({ targetStockMonths: null })
    expect(mocks.execute).toHaveBeenCalledTimes(4)
    mocks.execute.mockRejectedValueOnce(new Error('offline'))
    await expect(getPurchasingDataFreshness('owner')).rejects.toThrow('offline')
    expect(mocks.execute).toHaveBeenCalledTimes(5)
  })
})
