import { describe, expect, it } from 'vitest'
import { getPurchaseOrderRetentionCutoffDate } from './purchase-order-retention'

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
})
