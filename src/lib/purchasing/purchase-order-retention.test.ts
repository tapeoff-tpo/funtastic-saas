import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { cleanupExpiredEcountPurchaseOrderRowsInTransaction, getPurchaseOrderRetentionCutoffDate } from './purchase-order-retention'

describe('getPurchaseOrderRetentionCutoffDate', () => {
  it('calculates the date using the Korean calendar day', () => {
    expect(getPurchaseOrderRetentionCutoffDate(
      new Date('2026-09-10T14:59:59.999Z'),
    )).toBe('2026-07-10')
    expect(getPurchaseOrderRetentionCutoffDate(
      new Date('2026-09-10T15:00:00.000Z'),
    )).toBe('2026-07-11')
  })

  it('clamps month-end dates to the final day of the target month', () => {
    expect(getPurchaseOrderRetentionCutoffDate(
      new Date('2026-04-30T03:00:00.000Z'),
    )).toBe('2026-02-28')
    expect(getPurchaseOrderRetentionCutoffDate(
      new Date('2024-04-30T03:00:00.000Z'),
    )).toBe('2024-02-29')
  })

  it('keeps the date exactly two calendar months old as the cutoff boundary', () => {
    const cutoffDate = getPurchaseOrderRetentionCutoffDate(
      new Date('2026-09-11T03:00:00.000Z'),
    )

    expect(cutoffDate).toBe('2026-07-11')
    expect('2026-07-11' < cutoffDate).toBe(false)
    expect('2026-07-10' < cutoffDate).toBe(true)
  })

  it('excludes rows with reported inspection issues from automatic deletion', async () => {
    const execute = vi.fn(async (_query: SQL) => [{ deletedCount: 0, skippedMovementCount: 0 }])
    await cleanupExpiredEcountPurchaseOrderRowsInTransaction(
      { execute } as unknown as Parameters<typeof cleanupExpiredEcountPurchaseOrderRowsInTransaction>[0],
      { userId: '00000000-0000-4000-8000-000000000001', now: new Date('2026-11-12T00:00:00Z') },
    )
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.sql).toContain(`COALESCE("purchase_request_items"."purchase_inspection"->>'hasReportedIssue', 'false') <> 'true'`)
  })
})
