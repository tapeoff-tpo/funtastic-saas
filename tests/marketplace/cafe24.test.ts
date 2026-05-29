import { Cafe24Adapter } from '@/lib/marketplace/adapters/cafe24/adapter'
import { createCafe24Client } from '@/lib/marketplace/adapters/cafe24/client'

vi.mock('@/lib/marketplace/adapters/cafe24/client', () => ({
  createCafe24Client: vi.fn(),
}))

describe('Cafe24Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches order details when the list response has no item rows', async () => {
    const get = vi.fn((path: string) => ({
      json: async () => {
        if (path === 'admin/orders') {
          return {
            orders: [{
              order_id: '20260528-000001',
              order_date: '2026-05-28T10:00:00+09:00',
              order_status: 'N10',
              buyer_name: 'Buyer',
              receiver_name: 'Receiver',
              total_amount: '17000',
            }],
          }
        }

        if (path === 'admin/orders/20260528-000001') {
          return {
            order: {
              order_id: '20260528-000001',
              order_date: '2026-05-28T10:00:00+09:00',
              order_status: 'N10',
              buyer_name: 'Buyer',
              receiver_name: 'Receiver',
              total_amount: '17000',
              items: [{
                item_no: 'item-1',
                product_name: 'Cafe24 product',
                option_value: 'White',
                quantity: 1,
                product_price: 17000,
                sku: 'SKU-C24',
              }],
            },
          }
        }

        throw new Error(`Unexpected path: ${path}`)
      },
    }))
    vi.mocked(createCafe24Client).mockReturnValue({ get } as never)

    const adapter = new Cafe24Adapter({ access_token: 'token', mall_id: 'mall' })
    const orders = await adapter.getOrders(
      new Date('2026-05-28T00:00:00+09:00'),
      new Date('2026-05-28T23:59:59+09:00'),
    )

    expect(get).toHaveBeenCalledWith('admin/orders/20260528-000001', {
      searchParams: { shop_no: 1 },
    })
    expect(orders[0].items).toEqual([{
      marketplaceItemId: 'item-1',
      productName: 'Cafe24 product',
      optionText: 'White',
      quantity: 1,
      unitPrice: 17000,
      sku: 'SKU-C24',
    }])
  })
})
