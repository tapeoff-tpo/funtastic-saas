import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectOutside: vi.fn(),
  transaction: vi.fn(),
  deductForOrder: vi.fn(),
  restoreForOrder: vi.fn(),
  lockOrderItemsForOrders: vi.fn(),
  logOrderChanges: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: mocks.selectOutside,
    transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/db/schema', () => ({
  orders: {
    id: 'id',
    userId: 'userId',
    status: 'status',
    mappedAt: 'mappedAt',
    previousStatus: 'previousStatus',
    isHeld: 'isHeld',
    holdReason: 'holdReason',
    heldAt: 'heldAt',
    preparingAt: 'preparingAt',
    updatedAt: 'updatedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...conditions: unknown[]) => conditions,
  inArray: (...conditions: unknown[]) => conditions,
}))

vi.mock('@/lib/inventory/actions', () => ({
  deductForOrder: mocks.deductForOrder,
  restoreForOrder: mocks.restoreForOrder,
}))

vi.mock('@/lib/orders/locking', () => ({
  lockOrderItemsForOrders: mocks.lockOrderItemsForOrders,
}))

vi.mock('@/lib/orders/change-log', () => ({
  logOrderChanges: mocks.logOrderChanges,
  logOrderChange: vi.fn(),
}))

import { forceBulkUpdateStatus } from '@/lib/orders/actions'

const userId = 'workspace-1'

function mockOwnedOrders(orders: Array<{ id: string; status: string; mappedAt?: Date | null }>) {
  mocks.selectOutside.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(orders),
    }),
  })
}

function mockTransaction(lockedOrders: Array<{ id: string; status: string; mappedAt?: Date | null }>) {
  const tx = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockResolvedValue(lockedOrders),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(lockedOrders.map((order) => ({ id: order.id }))),
        }),
      }),
    }),
  }
  mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx))
  return tx
}

describe('forceBulkUpdateStatus inventory synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deductForOrder.mockResolvedValue(undefined)
    mocks.restoreForOrder.mockResolvedValue(undefined)
    mocks.lockOrderItemsForOrders.mockResolvedValue(1)
    mocks.logOrderChanges.mockResolvedValue(undefined)
  })

  it('deducts inventory once when a manual status update first reaches shipped', async () => {
    const orders = [{ id: 'order-1', status: 'confirmed', mappedAt: new Date() }]
    mockOwnedOrders(orders)
    mockTransaction(orders)

    const result = await forceBulkUpdateStatus(userId, ['order-1'], 'shipped')

    expect(result).toEqual({ updated: 1, errors: [] })
    expect(mocks.lockOrderItemsForOrders).toHaveBeenCalledWith(expect.anything(), userId, ['order-1'])
    expect(mocks.deductForOrder).toHaveBeenCalledTimes(1)
    expect(mocks.deductForOrder).toHaveBeenCalledWith(expect.anything(), userId, 'order-1')
    expect(mocks.restoreForOrder).not.toHaveBeenCalled()
  })

  it('does not deduct again when a shipped order is manually saved as shipped', async () => {
    const orders = [{ id: 'order-1', status: 'shipped', mappedAt: new Date() }]
    mockOwnedOrders(orders)
    mockTransaction(orders)

    const result = await forceBulkUpdateStatus(userId, ['order-1'], 'shipped')

    expect(result).toEqual({ updated: 1, errors: [] })
    expect(mocks.lockOrderItemsForOrders).not.toHaveBeenCalled()
    expect(mocks.deductForOrder).not.toHaveBeenCalled()
  })

  it('restores inventory when a shipped order is manually moved back before shipment', async () => {
    const orders = [{ id: 'order-1', status: 'shipped', mappedAt: new Date() }]
    mockOwnedOrders(orders)
    mockTransaction(orders)

    const result = await forceBulkUpdateStatus(userId, ['order-1'], 'ready')

    expect(result).toEqual({ updated: 1, errors: [] })
    expect(mocks.deductForOrder).not.toHaveBeenCalled()
    expect(mocks.restoreForOrder).toHaveBeenCalledTimes(1)
    expect(mocks.restoreForOrder).toHaveBeenCalledWith(expect.anything(), userId, 'order-1')
  })

  it('does not persist a status update when inventory deduction fails', async () => {
    const orders = [{ id: 'order-1', status: 'confirmed', mappedAt: new Date() }]
    mockOwnedOrders(orders)
    mockTransaction(orders)
    mocks.deductForOrder.mockRejectedValue(new Error('출고 재고를 찾을 수 없습니다: 100000-0001'))

    const result = await forceBulkUpdateStatus(userId, ['order-1'], 'shipped')

    expect(result.updated).toBe(0)
    expect(result.errors).toEqual([{ orderId: '', error: '출고 재고를 찾을 수 없습니다: 100000-0001' }])
  })
})
