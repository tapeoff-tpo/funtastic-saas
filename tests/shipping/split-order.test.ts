/**
 * Tests for order splitting logic.
 *
 * Since splitOrderToShipments depends on DB (queries.ts),
 * we test it by mocking the underlying query functions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db module and shipping queries before importing
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@/lib/shipping/queries', () => ({
  createShipmentWithItems: vi.fn(),
}))

import { splitOrderToShipments } from '@/lib/shipping/split-order'
import { db } from '@/lib/db'
import { createShipmentWithItems } from '@/lib/shipping/queries'

const mockDb = vi.mocked(db)
const mockCreateShipmentWithItems = vi.mocked(createShipmentWithItems)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('splitOrderToShipments', () => {
  it('creates N shipment records with specified items for each split', async () => {
    // Mock the item validation query
    const mockSelectResult = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 'item-1' },
          { id: 'item-2' },
          { id: 'item-3' },
        ]),
      }),
    }
    mockDb.select.mockReturnValue(mockSelectResult as any)

    // Mock transaction to just execute the callback
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb))

    mockCreateShipmentWithItems
      .mockResolvedValueOnce({
        id: 'shipment-1',
        orderId: 'order-1',
        userId: 'user-1',
        trackingNumber: 'TN001',
        carrierId: 'cj',
        carrierName: 'CJ대한통운',
        uploadStatus: 'pending',
        marketplaceUploadError: null,
        uploadAttempts: 0,
        lastUploadAt: null,
        shippedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'shipment-2',
        orderId: 'order-1',
        userId: 'user-1',
        trackingNumber: 'TN002',
        carrierId: 'cj',
        carrierName: 'CJ대한통운',
        uploadStatus: 'pending',
        marketplaceUploadError: null,
        uploadAttempts: 0,
        lastUploadAt: null,
        shippedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

    const result = await splitOrderToShipments('order-1', 'user-1', [
      {
        trackingNumber: 'TN001',
        carrierId: 'cj',
        carrierName: 'CJ대한통운',
        itemIds: ['item-1', 'item-2'],
      },
      {
        trackingNumber: 'TN002',
        carrierId: 'cj',
        carrierName: 'CJ대한통운',
        itemIds: ['item-3'],
      },
    ])

    expect(result).toHaveLength(2)
    expect(result[0].trackingNumber).toBe('TN001')
    expect(result[1].trackingNumber).toBe('TN002')
    expect(mockCreateShipmentWithItems).toHaveBeenCalledTimes(2)
  })

  it('validates that all itemIds belong to the given order', async () => {
    // Mock: only item-1 belongs to order, item-999 does not
    const mockSelectResult = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'item-1' }]),
      }),
    }
    mockDb.select.mockReturnValue(mockSelectResult as any)

    await expect(
      splitOrderToShipments('order-1', 'user-1', [
        {
          trackingNumber: 'TN001',
          carrierId: 'cj',
          carrierName: 'CJ대한통운',
          itemIds: ['item-1', 'item-999'],
        },
      ]),
    ).rejects.toThrow(/item.*not belong/i)
  })
})
