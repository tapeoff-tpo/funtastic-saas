import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/db', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return { db: drizzle(mocks.query) }
})
import { getDashboardSummary } from './queries'

const dates = {
  monthStart: new Date('2026-10-31T15:00:00.000Z'),
  dayStart: new Date('2026-11-22T15:00:00.000Z'),
  dayEnd: new Date('2026-11-23T15:00:00.000Z'),
}

beforeEach(() => { mocks.query.mockReset() })

describe('dashboard summary round trips', () => {
  it('returns all six cards in one query and preserves monetary values', async () => {
    mocks.query.mockResolvedValue({ rows: [[7, 3, 125, 28, '1500.75', '18200.50']] })
    expect(await getDashboardSummary('workspace-owner', dates)).toEqual({
      newOrderCount: 7, heldOrderCount: 3, productCount: 125, monthOrderCount: 28,
      todaySales: 1500.75, monthSales: 18200.5,
    })
    expect(mocks.query).toHaveBeenCalledOnce()
    const [query, params] = mocks.query.mock.calls[0] as [string, unknown[]]
    // All three independent counters and the monthly scan retain workspace isolation.
    expect(params).toEqual([
      'workspace-owner', 'new', 'workspace-owner', true, 'workspace-owner',
      dates.dayStart.toISOString(), dates.dayEnd.toISOString(),
      'workspace-owner', dates.monthStart.toISOString(),
    ])
    // Today's sales keep their inclusive start / exclusive end, while the main
    // scan stays month-bounded instead of reading every historical order.
    expect(query).toContain('FILTER')
    expect(query).toContain('::timestamptz')
    expect(query).toContain('"orders"."ordered_at" >=')
    expect(query).toContain('"ordered_at" < $7::timestamptz')
    expect(query).toMatch(/from "orders" where \("orders"\."user_id" = \$8 and "orders"\."ordered_at" >= \$9\)$/)
    expect(query.match(/select count\(\*\)::int/g)).toHaveLength(3)
  })

  it('keeps all-time counters even when no order falls in the current month', async () => {
    mocks.query.mockResolvedValue({ rows: [[2, 1, 84, 0, '0', '0']] })
    expect(await getDashboardSummary('workspace-owner', dates)).toEqual({
      newOrderCount: 2, heldOrderCount: 1, productCount: 84, monthOrderCount: 0,
      todaySales: 0, monthSales: 0,
    })
  })
})
