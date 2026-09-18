import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import {
  allocateSaasChinaPurchaseLots,
  getChinaOutboundOriginWarehouseCode,
  getSaasChinaPurchaseLifecycleStatus,
} from './saas-china-outbound'

describe('SaaS China purchase lifecycle status', () => {
  it('stays at China-arrived until a linked lot is reserved', () => {
    expect(getSaasChinaPurchaseLifecycleStatus({
      receivedQuantity: 10,
      reservedQuantity: 0,
      dispatchedQuantity: 0,
    })).toBe('china_arrived')
  })

  it('becomes outbound-requested for a partial reservation or dispatch', () => {
    expect(getSaasChinaPurchaseLifecycleStatus({
      receivedQuantity: 10,
      reservedQuantity: 4,
      dispatchedQuantity: 0,
    })).toBe('outbound_requested')
    expect(getSaasChinaPurchaseLifecycleStatus({
      receivedQuantity: 10,
      reservedQuantity: 0,
      dispatchedQuantity: 4,
    })).toBe('outbound_requested')
  })

  it('completes only after every received unit of that lot is dispatched', () => {
    expect(getSaasChinaPurchaseLifecycleStatus({
      receivedQuantity: 10,
      reservedQuantity: 10,
      dispatchedQuantity: 0,
    })).toBe('outbound_requested')
    expect(getSaasChinaPurchaseLifecycleStatus({
      receivedQuantity: 10,
      reservedQuantity: 0,
      dispatchedQuantity: 9,
    })).toBe('outbound_requested')
    expect(getSaasChinaPurchaseLifecycleStatus({
      receivedQuantity: 10,
      reservedQuantity: 0,
      dispatchedQuantity: 10,
    })).toBe('completed')
  })
})

describe('SaaS China purchase lot allocation', () => {
  it('allocates linked inventory in the supplied FIFO order before later lots', () => {
    const lots = [
      { id: 'oldest', receivedQuantity: 10, reservedQuantity: 2, dispatchedQuantity: 3 },
      { id: 'newer', receivedQuantity: 9, reservedQuantity: 0, dispatchedQuantity: 1 },
    ]

    expect(allocateSaasChinaPurchaseLots(lots, 11)).toEqual({
      allocations: [
        { purchaseLinkId: 'oldest', reservedQuantity: 5 },
        { purchaseLinkId: 'newer', reservedQuantity: 6 },
      ],
      remainingQuantity: 0,
    })
  })

  it('skips fully allocated lots and leaves manual/opening-balance quantity unlinked', () => {
    const lots = [
      { id: 'already-dispatched', receivedQuantity: 4, reservedQuantity: 1, dispatchedQuantity: 3 },
      { id: 'already-reserved', receivedQuantity: 2, reservedQuantity: 2, dispatchedQuantity: 0 },
      { id: 'available', receivedQuantity: 7, reservedQuantity: 1, dispatchedQuantity: 2 },
    ]

    expect(allocateSaasChinaPurchaseLots(lots, 7)).toEqual({
      allocations: [{ purchaseLinkId: 'available', reservedQuantity: 4 }],
      remainingQuantity: 3,
    })
  })

  it('does not mutate source lot balances while planning an allocation', () => {
    const lots = [{ id: 'lot', receivedQuantity: 5, reservedQuantity: 0, dispatchedQuantity: 0 }]

    allocateSaasChinaPurchaseLots(lots, 3)

    expect(lots).toEqual([{ id: 'lot', receivedQuantity: 5, reservedQuantity: 0, dispatchedQuantity: 0 }])
  })
})

describe('SaaS China outbound warehouse label', () => {
  it('keeps a single warehouse label when every selected item is from the same location', () => {
    expect(getChinaOutboundOriginWarehouseCode(['중국창고', '중국창고'])).toBe('중국창고')
  })

  it('marks a shipment as multiple warehouses when selected items are mixed', () => {
    expect(getChinaOutboundOriginWarehouseCode(['중국창고', '쿠팡', '스마일배송(개인个人1688)'])).toBe('복수 창고')
  })
})
