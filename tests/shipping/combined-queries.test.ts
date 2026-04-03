/**
 * Tests for shipment group CRUD queries.
 *
 * Mocks the Drizzle db module to test query construction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Create chainable mock helpers
function createChainMock(finalValue: any = undefined) {
  const chain: any = {}
  const methods = ['values', 'returning', 'set', 'where', 'innerJoin', 'orderBy']
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain)
  }
  // Terminal methods
  chain.returning.mockResolvedValue(finalValue !== undefined ? [finalValue] : [])
  chain.where.mockResolvedValue(finalValue !== undefined ? [finalValue] : [])
  return chain
}

const mockTx = {
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
}

vi.mock('@/lib/db', () => ({
  db: {
    transaction: vi.fn(async (cb: any) => cb(mockTx)),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

import {
  createShipmentGroup,
  confirmShipmentGroup,
  rejectShipmentGroup,
  getShipmentGroups,
  deleteShipmentGroup,
} from '@/lib/shipping/combined-queries'
import { db } from '@/lib/db'

const mockDb = vi.mocked(db)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createShipmentGroup', () => {
  it('inserts group + group_orders rows in transaction', async () => {
    const groupRow = { id: 'group-1' }
    const insertChain = createChainMock(groupRow)
    mockTx.insert.mockReturnValue(insertChain)

    const result = await createShipmentGroup({
      userId: 'user-1',
      groupKey: 'key-1',
      fulfillmentCode: 'normal',
      orderIds: ['order-1', 'order-2'],
    })

    expect(result.id).toBe('group-1')
    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    // insert called twice: once for group, once for group_orders
    expect(mockTx.insert).toHaveBeenCalledTimes(2)
  })
})

describe('confirmShipmentGroup', () => {
  it('updates status to confirmed', async () => {
    const updateChain = createChainMock()
    mockDb.update.mockReturnValue(updateChain as any)

    await confirmShipmentGroup('group-1')

    expect(mockDb.update).toHaveBeenCalledTimes(1)
  })
})

describe('rejectShipmentGroup', () => {
  it('updates status to rejected', async () => {
    const updateChain = createChainMock()
    mockDb.update.mockReturnValue(updateChain as any)

    await rejectShipmentGroup('group-1')

    expect(mockDb.update).toHaveBeenCalledTimes(1)
  })
})

describe('getShipmentGroups', () => {
  it('returns groups with order count for a given userId and status', async () => {
    const mockRows = [
      {
        shipment_groups: {
          id: 'group-1',
          userId: 'user-1',
          groupKey: 'key-1',
          status: 'suggested',
          fulfillmentCode: 'normal',
          maxPackQuantity: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        order_count: 3,
      },
    ]

    const selectChain: any = {}
    selectChain.from = vi.fn().mockReturnValue(selectChain)
    selectChain.leftJoin = vi.fn().mockReturnValue(selectChain)
    selectChain.where = vi.fn().mockReturnValue(selectChain)
    selectChain.groupBy = vi.fn().mockResolvedValue(mockRows)
    mockDb.select.mockReturnValue(selectChain as any)

    const result = await getShipmentGroups('user-1', 'suggested')

    expect(result).toHaveLength(1)
    expect(mockDb.select).toHaveBeenCalledTimes(1)
  })
})

describe('deleteShipmentGroup', () => {
  it('deletes the shipment group', async () => {
    const deleteChain = createChainMock()
    mockDb.delete.mockReturnValue(deleteChain as any)

    await deleteShipmentGroup('group-1')

    expect(mockDb.delete).toHaveBeenCalledTimes(1)
  })
})
