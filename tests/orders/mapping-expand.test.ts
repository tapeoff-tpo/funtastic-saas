import { describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({
  mappingRows: [],
  inventoryRows: [
    {
      sku: 'LOCKED-001',
      productName: '잠금상품',
      optionName: '잠금옵션',
    },
  ],
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        void table
        return {
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => fixtures.mappingRows),
          })),
          where: vi.fn(() => ({
            groupBy: vi.fn(async () => fixtures.inventoryRows),
          })),
        }
      }),
    })),
  },
}))

import { expandOrderItemsWithMapping } from '@/lib/orders/mapping-expand'

describe('expandOrderItemsWithMapping', () => {
  it('marks locked confirmed item values as mapped export rows', async () => {
    const rows = await expandOrderItemsWithMapping(
      'user-1',
      [{ id: 'order-1', marketplaceId: 'mall-a' }],
      [{
        id: 'item-1',
        orderId: 'order-1',
        marketplaceItemId: 'SHOP-RAW',
        sku: 'SHOP-RAW',
        productName: '수집상품',
        optionText: '수집옵션',
        quantity: 1,
        skuMultiplier: 1,
        unitPrice: '1000',
        lockedSku: 'LOCKED-001',
        lockedProductName: '잠금상품',
        lockedOptionName: '잠금옵션',
        lockedQuantity: 3,
        lockedAt: new Date('2026-05-27T00:00:00.000Z'),
      }],
    )

    expect(rows).toMatchObject([
      {
        sku: 'LOCKED-001',
        productName: '잠금상품',
        optionText: '잠금옵션',
        quantity: 3,
        fromMapping: true,
      },
    ])
  })
})
