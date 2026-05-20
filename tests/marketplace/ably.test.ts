import { beforeEach, describe, expect, it, vi } from 'vitest'
import ky from 'ky'
import { AblyAdapter } from '@/lib/marketplace/adapters/ably/adapter'

vi.mock('ky', () => ({
  default: {
    create: vi.fn(),
  },
}))

describe('AblyAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps only the leading Ably order number segment', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        success: true,
        data: [
          {
            orderId: '1779172568293 616118025',
            productName: 'Test product',
            quantity: 1,
            buyerName: 'Buyer',
            buyerPhone: '010-1111-2222',
            receiverName: 'Receiver',
            receiverPhone: '010-3333-4444',
            receiverZipcode: '06000',
            receiverAddress: 'Seoul',
            receiverAddressDetail: '101',
            orderDate: '2026-05-20T10:00:00+09:00',
            orderStatus: 'NEW',
            paymentAmount: 10000,
            options: 'Black',
            sellerItemCode: 'SKU-1',
          },
        ],
      }),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new AblyAdapter({ api_key: 'test-key', shop_id: 'shop-1' })
    const orders = await adapter.getOrders(new Date('2026-05-20T00:00:00+09:00'))

    expect(orders).toHaveLength(1)
    expect(orders[0].marketplaceOrderId).toBe('1779172568293')
    expect(orders[0].items[0].marketplaceItemId).toBe('1779172568293')
    expect(orders[0].rawData).toMatchObject({
      originalOrderId: '1779172568293 616118025',
      normalizedOrderId: '1779172568293',
    })
  })
})
