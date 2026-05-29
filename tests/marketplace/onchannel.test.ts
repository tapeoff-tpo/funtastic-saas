import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnchannelAdapter } from '@/lib/marketplace/adapters/onchannel/adapter'

const mockJson = vi.fn()
const mockGet = vi.fn(() => ({ json: mockJson }))

vi.mock('@/lib/marketplace/adapters/onchannel/client', () => ({
  createOnchannelClient: vi.fn(() => ({
    get: mockGet,
  })),
}))

function onchannelOrder(orderId: string, orderStatus: string) {
  return {
    orderId,
    productId: `P-${orderId}`,
    productName: `product-${orderId}`,
    quantity: 1,
    buyerName: 'buyer',
    buyerPhone: '010-0000-0000',
    receiverName: 'receiver',
    receiverPhone: '010-1111-1111',
    receiverZipcode: '12345',
    receiverAddress: 'Seoul',
    orderDate: '2026-05-28T10:00:00+09:00',
    orderStatus,
    paymentAmount: 10000,
  }
}

describe('OnchannelAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collects only paid Onchannel orders and excludes later or unknown statuses', async () => {
    mockJson.mockResolvedValueOnce({
      success: true,
      data: [
        onchannelOrder('GO_1', 'PAID'),
        onchannelOrder('GO_2', 'READY_TO_SHIP'),
        onchannelOrder('GO_3', 'SHIPPED'),
        onchannelOrder('GO_4', 'UNEXPECTED_STATUS'),
      ],
    })

    const adapter = new OnchannelAdapter({ api_key: 'api-key', shop_id: 'shop' })
    const orders = await adapter.getOrders(new Date('2026-05-28T00:00:00+09:00'))

    expect(orders.map((order) => order.marketplaceOrderId)).toEqual(['GO_1'])
    expect(orders[0].status).toBe('new')
  })
})
