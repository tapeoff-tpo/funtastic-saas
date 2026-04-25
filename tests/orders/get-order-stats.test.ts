import { describe, it, expect } from 'vitest'
import type { OrderStats } from '@/lib/orders/types'

describe('getOrderStats — 9탭 카운트', () => {
  it('OrderStats type exposes status counts (new/confirmed/preparing/shipped/delivering/delivered/cancelled)', () => {
    // Compile-time: this asserts the shape exists. Will fail tsc until Plan 03 extends OrderStats.
    const sample: OrderStats = {
      new: 0, confirmed: 0, preparing: 0, shipped: 0, delivering: 0, delivered: 0, cancelled: 0,
      claimCancel: 0, claimExchange: 0, claimReturn: 0,
      cancelTabCount: 0,
    } as OrderStats
    expect(sample.cancelled).toBe(0)
    expect(sample.claimCancel).toBe(0)
    expect(sample.claimExchange).toBe(0)
    expect(sample.claimReturn).toBe(0)
    expect(sample.cancelTabCount).toBe(0)
  })
  it.todo('취소 탭 카운트 = claims.claimType=cancel ∪ orders.status=cancelled (distinct order)')
  it.todo('9탭 카운트 합 ≤ total (overlap 허용) — SQL GROUP BY 단일 호출')
})
