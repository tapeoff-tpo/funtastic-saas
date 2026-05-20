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

  it('keeps only the leading Ably order number segment when no explicit order number is present', async () => {
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
    expect(orders[0].items[0].marketplaceItemId).toBe('1779172568293 616118025')
    expect(orders[0].rawData).toMatchObject({
      originalOrderId: '1779172568293 616118025',
      normalizedOrderId: '1779172568293',
      ablyApiOrderId: '1779172568293 616118025',
      marketplaceOrderIdentity: {
        orderId: '1779172568293',
        itemIds: ['1779172568293 616118025'],
      },
    })
  })

  it('uses the customer-facing order number while preserving the API order id', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        success: true,
        data: [
          {
            orderId: 'ably-api-1001',
            orderNo: 'ABLY-20260520-001',
            productName: '테스트 상품',
            quantity: 2,
            buyerName: '구매자',
            buyerPhone: '010-1111-2222',
            receiverName: '수령자',
            receiverPhone: '010-3333-4444',
            receiverZipcode: '06000',
            receiverAddress: '서울시 강남구',
            receiverAddressDetail: '101호',
            orderDate: '2026-05-20T10:00:00+09:00',
            orderStatus: 'NEW',
            paymentAmount: 12000,
            options: '블랙',
            sellerItemCode: 'SKU-1',
          },
        ],
      }),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new AblyAdapter({ api_key: 'test-key', shop_id: 'shop-1' })
    const orders = await adapter.getOrders(
      new Date('2026-05-20T00:00:00+09:00'),
      new Date('2026-05-20T23:59:59+09:00'),
    )

    expect(orders[0]).toMatchObject({
      marketplaceOrderId: 'ABLY-20260520-001',
      items: [
        {
          marketplaceItemId: 'ably-api-1001',
        },
      ],
      rawData: {
        ablyApiOrderId: 'ably-api-1001',
        marketplaceOrderIdentity: {
          orderId: 'ABLY-20260520-001',
          itemIds: ['ably-api-1001'],
        },
      },
    })
  })

  it('uploads invoices using the preserved Ably API order id', async () => {
    const post = vi.fn(() => ({
      json: async () => ({ success: true, data: null }),
    }))
    vi.mocked(ky.create).mockReturnValue({ post } as never)

    const adapter = new AblyAdapter({ api_key: 'test-key', shop_id: 'shop-1' })
    const result = await adapter.uploadInvoice('ABLY-20260520-001', {
      carrierId: 'CJ',
      trackingNumber: '123456789',
      rawData: {
        ablyApiOrderId: 'ably-api-1001',
      },
    })

    expect(result).toEqual({ success: true })
    expect(post).toHaveBeenCalledWith('orders/ably-api-1001/invoice', expect.any(Object))
  })
})
