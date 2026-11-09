import { describe, expect, it } from 'vitest'
import { getInventoryPeriod, inventoryPeriodDate } from './period'
import { getOutgoingMetricWindows } from '@/lib/purchasing/items'

describe('inventory search month', () => {
  it('defaults to the Korean calendar month at a UTC month boundary', () => {
    expect(getInventoryPeriod(null, null, new Date('2026-10-31T16:00:00Z')).key).toBe('2026-11')
  })
  it('uses the selected month and its preceding three completed months across years', () => {
    const date = inventoryPeriodDate('2026-01')!
    expect(getOutgoingMetricWindows(date)).toMatchObject({ currentMonthDate: '2026-01-01', previousThreeMonthDate: '2025-10-01', nextMonthDate: '2026-02-01' })
    expect(inventoryPeriodDate('2026-12')?.toISOString()).toBe('2026-11-30T15:00:00.000Z')
    expect(inventoryPeriodDate('2026-13')).toBeUndefined()
  })
})
