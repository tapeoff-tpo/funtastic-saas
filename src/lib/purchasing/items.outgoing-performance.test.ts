import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))
import { getSkuOutgoingMetrics } from './items'

let metadata: unknown
const dialect = new PgDialect()
beforeEach(() => {
  vi.clearAllMocks()
  metadata = { purchasingOutgoingMetrics: { threeMonthAverageOutgoing: 42 } }
  mocks.select.mockImplementation(() => ({ from: () => ({ where: async () => [{ internalSku: 'SKU-1', metadata }] }) }))
  mocks.execute.mockResolvedValue([{ internalSku: 'SKU-1', currentMonthOutgoing: 20, threeMonthAverageOutgoing: 11, twoMonthsAgoOutgoing: 7, previousMonthOutgoing: 9, currentMonthOrderCount: 2, currentMonthLargestOrderQuantity: 15 }])
})

describe('outgoing queries for inventory search', () => {
  it('keeps the displayed totals and manual average while omitting recommendation-only calculations', async () => {
    const now = new Date('2026-11-09T00:00:00Z')
    const full = await getSkuOutgoingMetrics('owner', ['SKU-1'], now)
    const summary = await getSkuOutgoingMetrics('owner', ['SKU-1', 'SKU-1'], now, 'summary')
    expect(summary.get('SKU-1')).toEqual({ currentMonthOutgoing: 20, threeMonthAverageOutgoing: 42 })
    expect(full.get('SKU-1')).toMatchObject({ ...summary.get('SKU-1'), recentCompletedMonthOutgoing: [7, 9], currentMonthOrderCount: 2, currentMonthLargestOrderQuantity: 15 })
    const statements = mocks.execute.mock.calls.map(([statement]: [SQL]) => dialect.sqlToQuery(statement))
    expect(statements[0].sql).toContain('COUNT(DISTINCT')
    expect(statements[1].sql).not.toContain('COUNT(DISTINCT')
    expect(statements[1].sql).not.toContain('source_order_number')
    expect(statements[1].sql).toContain("reflection_status = 'applied'")
    expect(statements[1].sql).toContain("claim_type = 'return' THEN -line.quantity")
    expect(statements[1].params).toEqual(['2026-11-01', '2026-12-01', '2026-08-01', '2026-11-01', 'owner', '2026-08-01', '2026-12-01', 'SKU-1'])
    const selection = mocks.select.mock.calls[1][0]
    expect(dialect.sqlToQuery(selection.metadata).sql).toContain('jsonb_build_object')
  })

  it('preserves the current rolling average baseline in inventory summaries', async () => {
    metadata = { purchasingRollingAverageBaseline: { referenceMonth: '2026-11', threeMonthAverageOutgoing: 74 } }
    const result = await getSkuOutgoingMetrics('owner', ['SKU-1'], new Date('2026-11-09T00:00:00Z'), 'summary')
    expect(result.get('SKU-1')).toEqual({ currentMonthOutgoing: 20, threeMonthAverageOutgoing: 74 })
  })

  it('uses historical ledger averages instead of copying an undated live manual average into every month', async () => {
    const result = await getSkuOutgoingMetrics('owner', ['SKU-1'], new Date('2026-10-01T00:00:00+09:00'), 'historical-summary')
    expect(result.get('SKU-1')).toEqual({ currentMonthOutgoing: 20, threeMonthAverageOutgoing: 11 })
    metadata = { purchasingRollingAverageBaseline: { referenceMonth: '2026-10', threeMonthAverageOutgoing: 74 } }
    const matching = await getSkuOutgoingMetrics('owner', ['SKU-1'], new Date('2026-10-01T00:00:00+09:00'), 'historical-summary')
    expect(matching.get('SKU-1')?.threeMonthAverageOutgoing).toBe(11)
    expect(mocks.select).not.toHaveBeenCalled()
  })
})
