import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TossShoppingAdapter } from '@/lib/marketplace/adapters/toss-shopping/adapter'

const mockJson = vi.fn()
const mockGet = vi.fn(() => ({ json: mockJson }))
const mockPut = vi.fn(() => ({ json: mockJson }))

vi.mock('@/lib/marketplace/adapters/toss-shopping/client', () => ({
  createTossShoppingClient: vi.fn(() => ({
    client: {
      get: mockGet,
      put: mockPut,
    },
    getToken: vi.fn().mockResolvedValue('token'),
    getState: vi.fn(() => ({ tokenExpiresAt: Date.now() + 60000 })),
  })),
}))

function tossProduct(orderProductId: number, status: string) {
  return {
    orderedAt: '2026-05-28T10:00:00',
    orderId: 1001,
    orderProductId,
    ordererName: 'buyer',
    receiverName: 'receiver',
    address: 'Seoul',
    productName: `product-${orderProductId}`,
    optionName: `option-${orderProductId}`,
    quantity: 1,
    price: 10000,
    orderProductStatus: status,
    deliveryFee: 2500,
  }
}

describe('TossShoppingAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collects only PAID order products and excludes shipping/cancelled products', async () => {
    mockJson.mockResolvedValueOnce({
      resultType: 'SUCCESS',
      success: {
        results: [
          tossProduct(1, 'PAID'),
          tossProduct(2, 'PREPARING_PRODUCT'),
          tossProduct(3, 'DELIVERED'),
          tossProduct(4, 'CANCELED_PAYMENT'),
        ],
      },
    })

    const adapter = new TossShoppingAdapter({ access_key: 'access', secret_key: 'secret' })
    const orders = await adapter.getOrders(new Date('2026-05-28T00:00:00+09:00'))

    expect(orders).toHaveLength(1)
    expect(orders[0].marketplaceStatus).toBe('PAID')
    expect(orders[0].items).toHaveLength(1)
    expect(orders[0].items[0].marketplaceItemId).toBe('1')
    expect(orders[0].rawData.orderProductIds).toEqual(['1'])
  })
})
