import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomeggookAdapter } from '@/lib/marketplace/adapters/domeggook/adapter'
import {
  createDomeggookClient,
  postDomeggookFormJson,
  readDomeggookJson,
} from '@/lib/marketplace/adapters/domeggook/client'

vi.mock('@/lib/marketplace/adapters/domeggook/client', () => ({
  createDomeggookClient: vi.fn(() => ({})),
  postDomeggookFormJson: vi.fn(),
  readDomeggookJson: vi.fn(),
}))

describe('DomeggookAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ ip: '208.77.246.15' }),
    })))
    vi.mocked(postDomeggookFormJson).mockResolvedValue({ domeggook: { sId: 'session-id' } })
    vi.mocked(readDomeggookJson).mockResolvedValue({ domeggook: { items: [], header: { numberOfPages: 1 } } })
  })

  it('uses one login session while collecting multiple day slices in parallel', async () => {
    const adapter = new DomeggookAdapter({
      api_key: 'api-key',
      seller_id: 'seller-id',
      session_id: 'password',
    })

    await adapter.getOrders(new Date(Date.now() - 3 * 86_400_000))

    expect(createDomeggookClient).toHaveBeenCalledWith('api-key')
    expect(postDomeggookFormJson).toHaveBeenCalledTimes(1)
    expect(readDomeggookJson).toHaveBeenCalled()
  })

  it('enriches collected paid orders with detail fields used for mapping and shipping', async () => {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    vi.mocked(readDomeggookJson)
      .mockResolvedValueOnce({
        domeggook: {
          header: { numberOfPages: 1 },
          items: {
            item: {
              orderNo: '73575647',
              orderUid: 'OR73575647-1',
              status: '결제완료',
              itemNo: 12345,
              itemTitle: '도매꾹 상품',
              orderQty: 2,
              orderAmtPay: 10000,
              date: now,
            },
          },
        },
      })
      .mockResolvedValueOnce({
        domeggook: {
          header: { numberOfPages: 1 },
          items: {
            item: {
              orderNo: '73575647',
              orderUid: 'OR73575647-1',
              item: {
                no: 12345,
                title: '도매꾹 상품',
                itemCustomCode: 'DG-001',
              },
              buyerInfo: {
                buyerName: '주문자',
                buyerMobile: '010-1111-2222',
              },
              consumer: {
                name: '수취인',
                mobile: '010-3333-4444',
                zipcode: '12345',
                address: '서울시',
                deliReq: '문앞',
              },
              delivery: {
                fee: 3000,
                who: '선결제',
              },
              pay: {
                payAmount: 13000,
              },
              selectOpt: {
                opt: { name: '색상: 빨강' },
              },
            },
          },
        },
      })

    const adapter = new DomeggookAdapter({
      api_key: 'api-key',
      seller_id: 'seller-id',
      session_id: 'password',
    })

    const orders = await adapter.getOrders(new Date())

    expect(orders[0]).toMatchObject({
      buyerName: '주문자',
      recipientName: '수취인',
      totalAmount: 13000,
      shippingFee: 3000,
      deliveryMessage: '문앞',
    })
    expect(orders[0].items[0]).toMatchObject({
      marketplaceItemId: 'OR73575647-1',
      optionText: '색상: 빨강',
      sku: 'DG-001',
      unitPrice: 5000,
    })
    expect(orders[0].rawData.orderIdentity).toMatchObject({
      orderId: '73575647',
      itemIds: ['DG-001', '12345', 'OR73575647-1'],
    })
  })

  it('keeps all Domeggook line items for the same order number', async () => {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    vi.mocked(readDomeggookJson)
      .mockResolvedValueOnce({
        domeggook: {
          header: { numberOfPages: 1 },
          items: {
            item: [
              {
                orderNo: '73575647',
                orderUid: 'OR73575647-1',
                status: '寃곗젣?꾨즺',
                itemNo: 12345,
                itemTitle: 'first',
                orderQty: 1,
                orderAmtPay: 10000,
                date: now,
              },
              {
                orderNo: '73575647',
                orderUid: 'OR73575647-2',
                status: '寃곗젣?꾨즺',
                itemNo: 67890,
                itemTitle: 'second',
                orderQty: 2,
                orderAmtPay: 12000,
                date: now,
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        domeggook: {
          header: { numberOfPages: 1 },
          items: { item: { orderNo: '73575647', orderUid: 'OR73575647-1' } },
        },
      })
      .mockResolvedValueOnce({
        domeggook: {
          header: { numberOfPages: 1 },
          items: { item: { orderNo: '73575647', orderUid: 'OR73575647-2' } },
        },
      })

    const adapter = new DomeggookAdapter({
      api_key: 'api-key',
      seller_id: 'seller-id',
      session_id: 'password',
    })

    const orders = await adapter.getOrders(new Date())

    expect(orders).toHaveLength(1)
    expect(orders[0].marketplaceOrderId).toBe('73575647')
    expect(orders[0].items.map((item) => item.marketplaceItemId)).toEqual(['OR73575647-1', 'OR73575647-2'])
    expect(orders[0].items[1]).toMatchObject({
      productName: 'second',
      quantity: 2,
      unitPrice: 6000,
    })
  })
})
