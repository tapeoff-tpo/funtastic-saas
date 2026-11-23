import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))
vi.mock('./purchase-payment-tracking', () => ({ ensurePurchasePaymentTrackingSchema: async () => {} }))
vi.mock('./purchase-inspection-issues', () => ({ ensurePurchaseInspectionIssueSchema: async () => {} }))
import { getPurchaseRequests } from './purchase-requests'

beforeEach(() => vi.clearAllMocks())

describe('purchase list summary reads', () => {
  it('combines status and delay counts while keeping search out of global status badges', async () => {
    const selectedFields: Array<Record<string, SQL>> = []
    const clauses: SQL[] = []
    const results = [[], [{ total: 0 }], [
      { status: 'purchased', total: 20, overduePurchaseRequestCount: 3, overduePurchaseCompletedCount: 0 },
      { status: 'purchase_completed', total: 12, overduePurchaseRequestCount: 0, overduePurchaseCompletedCount: 4 },
      { status: 'inspecting', total: 6, overduePurchaseRequestCount: 0, overduePurchaseCompletedCount: 2 },
    ], []]
    mocks.select.mockImplementation((fields) => {
      const index = selectedFields.length
      selectedFields.push(fields)
      const builder = {
        from: () => builder,
        leftJoin: () => builder,
        where: (condition: SQL) => { clauses[index] = condition; return builder },
        orderBy: () => builder,
        limit: () => builder,
        offset: () => Promise.resolve(results[index]),
        groupBy: () => Promise.resolve(results[index]),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(results[index]).then(resolve),
      }
      return builder
    })

    const result = await getPurchaseRequests({ userId: 'owner', status: 'purchased', search: '켈디', page: 1, pageSize: 50 })
    expect(mocks.select).toHaveBeenCalledTimes(4)
    expect(result).toMatchObject({
      statusCounts: { purchased: 20, purchase_completed: 12, inspecting: 6 },
      overduePurchaseRequestCount: 3,
      overduePurchaseCompletedCount: 6,
      overduePurchasedCount: 6,
      overdueTotalCount: 9,
    })
    const dialect = new PgDialect()
    const statusScope = dialect.sqlToQuery(clauses[2])
    expect(statusScope.params).toContain('owner')
    expect(statusScope.params).not.toContain('%켈디%')
    const requested = dialect.sqlToQuery(selectedFields[2].overduePurchaseRequestCount)
    const completed = dialect.sqlToQuery(selectedFields[2].overduePurchaseCompletedCount)
    for (const query of [requested, completed]) {
      expect(query.sql).toContain('FILTER (WHERE')
      expect(query.sql).toContain("CURRENT_DATE - INTERVAL '7 days'")
      expect(query.params).toContain('owner')
      expect(query.params).toContain('%켈디%')
    }
    expect(requested.params).toContain('purchased')
    expect(requested.sql).toContain('"request_date"')
    expect(completed.params).toContain('purchase_completed')
    expect(completed.params).toContain('inspecting')
    expect(completed.sql).toContain('"outbound_expected_date"')
  })

  it('returns zero delay counts for an empty workspace', async () => {
    let queryIndex = 0
    mocks.select.mockImplementation(() => {
      const result = queryIndex++ === 1 ? [{ total: 0 }] : []
      const builder = {
        from: () => builder, leftJoin: () => builder, where: () => builder,
        orderBy: () => builder, limit: () => builder,
        offset: () => Promise.resolve(result), groupBy: () => Promise.resolve(result),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      }
      return builder
    })
    expect(await getPurchaseRequests({ userId: 'empty', status: 'purchased' })).toMatchObject({
      total: 0, statusCounts: {}, overduePurchaseRequestCount: 0,
      overduePurchaseCompletedCount: 0, overdueTotalCount: 0,
    })
  })
})
