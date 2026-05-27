import { beforeEach, describe, expect, it, vi } from 'vitest'
import ky from 'ky'
import { FuntasticB2bAdapter } from '@/lib/marketplace/adapters/funtastic-b2b/adapter'

vi.mock('ky', () => ({
  default: {
    create: vi.fn(),
  },
}))

describe('FuntasticB2bAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formats order lookup dates as KST calendar days', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        orders: [
          {
            orderNo: 'ORD-20260526-0008',
            status: 'CONFIRMED',
            createdAt: '2026-05-26T21:41:46.400Z',
            buyer: { companyName: '랜선친구' },
            shipping: { name: '이애자' },
            items: [{ productCode: 'SKU-1', productName: '상품', quantity: 1, unitPrice: 1000 }],
            totalAmount: 1000,
          },
        ],
      }),
    }))

    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new FuntasticB2bAdapter({
      api_key: 'api-key',
      base_url: 'https://funtasticb2b.com',
    })

    const orders = await adapter.getOrders(
      new Date('2026-05-26T22:51:00.000Z'),
      new Date('2026-05-26T22:52:00.000Z'),
    )

    expect(get).toHaveBeenCalledWith('api/saas/orders', expect.objectContaining({
      searchParams: expect.objectContaining({
        dateFrom: '2026-05-27',
        dateTo: '2026-05-27',
      }),
    }))
    expect(orders.map((order) => order.marketplaceOrderId)).toEqual(['ORD-20260526-0008'])
  })

  it('keeps shipping fee separate from merchandise amount', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        orders: [
          {
            orderNo: 'ORD-20260515-0003',
            status: 'CONFIRMED',
            createdAt: '2026-05-15T02:00:00.000Z',
            buyerName: 'buyer',
            recipientName: 'recipient',
            items: [{ productCode: 'SKU-1', productName: 'product', quantity: 1, unitPrice: 14000 }],
            totalAmount: 17000,
            shippingFee: 3000,
          },
        ],
      }),
    }))

    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new FuntasticB2bAdapter({
      api_key: 'api-key',
      base_url: 'https://funtasticb2b.com',
    })

    const [order] = await adapter.getOrders(new Date('2026-05-15T00:00:00.000Z'), new Date('2026-05-15T23:59:59.000Z'))

    expect(order.totalAmount).toBe(14000)
    expect(order.shippingFee).toBe(3000)
  })
})
