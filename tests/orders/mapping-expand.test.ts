import { beforeEach, describe, expect, it, vi } from 'vitest'

type MappingRowFixture = {
  mappingCodeId: string
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId: string
  productNameSnapshot: string | null
  optionNameSnapshot: string | null
  componentSku: string
  componentQuantity: number
}

const fixtures = vi.hoisted(() => ({
  mappingRows: [] as MappingRowFixture[],
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
  beforeEach(() => {
    fixtures.mappingRows = []
    fixtures.inventoryRows = [
      {
        sku: 'LOCKED-001',
        productName: '?좉툑?곹뭹',
        optionName: '?좉툑?듭뀡',
      },
    ]
  })

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

  it('uses raw marketplace product ids when the order item id is an order-line id', async () => {
    fixtures.mappingRows = [
      {
        mappingCodeId: 'map-1',
        marketplaceId: 'naver',
        marketplaceProductId: '5760163079',
        marketplaceOptionId: '선택: ★ 운동복전용세제1L (11900원 기획가)',
        productNameSnapshot: '운동복 세제',
        optionNameSnapshot: '선택: ★ 운동복전용세제1L (11900원 기획가)',
        componentSku: '108300-0001',
        componentQuantity: 1,
      },
      {
        mappingCodeId: 'map-1',
        marketplaceId: 'naver',
        marketplaceProductId: '5760163079',
        marketplaceOptionId: '선택: ★ 운동복전용세제1L (11900원 기획가)',
        productNameSnapshot: '운동복 세제',
        optionNameSnapshot: '선택: ★ 운동복전용세제1L (11900원 기획가)',
        componentSku: '109733-0001',
        componentQuantity: 1,
      },
    ]
    fixtures.inventoryRows = [
      { sku: '108300-0001', productName: '운동복 세제', optionName: '1L' },
      { sku: '109733-0001', productName: '펌프', optionName: '부자재' },
    ]

    const rows = await expandOrderItemsWithMapping(
      'user-1',
      [{
        id: 'order-1',
        marketplaceId: 'naver',
        rawData: {
          productOrders: [{
            productOrderId: '2026052993342901',
            productId: '5760163079',
            productOption: '선택: ★ 운동복전용세제1L (11900원 기획가)',
          }],
        },
      }],
      [{
        id: 'item-1',
        orderId: 'order-1',
        marketplaceItemId: '2026052993342901',
        sku: null,
        productName: '운동복 세제',
        optionText: '선택: ★ 운동복전용세제1L (11900원 기획가)',
        quantity: 3,
        skuMultiplier: 1,
        unitPrice: '19000',
      }],
    )

    expect(rows).toMatchObject([
      { sku: '108300-0001', quantity: 3, fromMapping: true },
      { sku: '109733-0001', quantity: 3, fromMapping: true },
    ])
  })
})
