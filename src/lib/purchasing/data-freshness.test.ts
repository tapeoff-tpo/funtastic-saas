import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: mocks }))

import {
  getLatestDataRefreshCompletedAt,
  getPurchasingDataFreshness,
} from './data-freshness'

beforeEach(() => mocks.execute.mockReset())

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
    mocks.execute
      .mockRejectedValueOnce({ cause: { code: '42P01' } })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    expect(await getPurchasingDataFreshness('owner')).toMatchObject({ targetStockMonths: null })
    expect(mocks.execute).toHaveBeenCalledTimes(4)

    mocks.execute.mockRejectedValueOnce(new Error('offline'))
    await expect(getPurchasingDataFreshness('owner')).rejects.toThrow('offline')
    expect(mocks.execute).toHaveBeenCalledTimes(5)
  })
})

describe('getLatestDataRefreshCompletedAt', () => {
  it('returns the latest explicit refresh event timestamp without schema writes', async () => {
    mocks.execute.mockResolvedValueOnce([{ completedAt: '2026-11-23 05:12:03+00' }])

    await expect(getLatestDataRefreshCompletedAt(
      '2bc2f92a-dd50-465f-a7d5-d09c31fb1234',
      'domestic_inventory',
    )).resolves.toBe('2026-11-23 05:12:03+00')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('supports rows-shaped database results', async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [{ completedAt: '2026-11-22 03:00:00+00' }],
    })

    await expect(getLatestDataRefreshCompletedAt(
      '2bc2f92a-dd50-465f-a7d5-d09c31fb1234',
      'domestic_inventory',
    )).resolves.toBe('2026-11-22 03:00:00+00')
  })

  it('returns null without falling back to a source table', async () => {
    mocks.execute.mockResolvedValueOnce([{ completedAt: null }])

    await expect(getLatestDataRefreshCompletedAt(
      '2bc2f92a-dd50-465f-a7d5-d09c31fb1234',
      'domestic_inventory',
    )).resolves.toBeNull()
  })

  it('creates a missing event table and retries the event-only query', async () => {
    mocks.execute
      .mockRejectedValueOnce({ code: '42P01' })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ completedAt: '2026-11-23 05:12:03+00' }])

    await expect(getLatestDataRefreshCompletedAt(
      '2bc2f92a-dd50-465f-a7d5-d09c31fb1234',
      'domestic_inventory',
    )).resolves.toBe('2026-11-23 05:12:03+00')
    expect(mocks.execute).toHaveBeenCalledTimes(4)
  })
})
