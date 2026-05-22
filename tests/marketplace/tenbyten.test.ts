import { beforeEach, describe, expect, it, vi } from 'vitest'
import ky from 'ky'
import { TenByTenAdapter } from '@/lib/marketplace/adapters/10x10/adapter'

vi.mock('ky', () => ({
  default: {
    create: vi.fn(),
  },
}))

const envelope = (datas: unknown[]) => ({
  hasError: false,
  hasAlert: false,
  message: '',
  code: 'SUCCESS',
  outPutValue: {
    TotalCount: datas.length,
    datas,
  },
})

const order = (OrderSerial: string, itemName: string) => ({
  OrderSerial,
  orderState: '5',
  orderDate: '2026-05-01 10:00',
  ordererName: '주문자',
  receiverName: '수령자',
  receiverZipCode: '04524',
  receiverAddress: '서울특별시 중구',
  details: [
    {
      DetailIdx: 1001,
      itemId: 2001,
      itemName,
      quantity: 1,
      Price: 12000,
    },
  ],
})

describe('TenByTenAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collects both 신규주문 and 미출고 주문 because /v2/orders auto-confirms on read', async () => {
    const get = vi.fn((url: string) => ({
      json: async () => {
        if (url.startsWith('orders/orderhistory?')) {
          return envelope([order('T-1001', '이미 주문확인된 상품')])
        }
        if (url.startsWith('orders?')) {
          return envelope([order('T-1002', '신규 상품')])
        }
        throw new Error(`Unexpected URL: ${url}`)
      },
    }))

    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new TenByTenAdapter({ api_key: 'api-key', shop_id: 'brand' })
    const orders = await adapter.getOrders(new Date('2026-05-01T00:00:00+09:00'))

    expect(get).toHaveBeenCalledWith(expect.stringContaining('orders?'))
    expect(get).toHaveBeenCalledWith(expect.stringContaining('orders/orderhistory?'))
    expect(orders.map((o) => o.marketplaceOrderId).sort()).toEqual(['T-1001', 'T-1002'])
  })

  it('deduplicates the same order when it appears in both 10x10 order endpoints', async () => {
    const get = vi.fn((url: string) => ({
      json: async () => {
        if (url.startsWith('orders/orderhistory?')) {
          return envelope([order('T-1001', '미출고 쪽 상품명')])
        }
        if (url.startsWith('orders?')) {
          return envelope([order('T-1001', '신규 쪽 상품명')])
        }
        throw new Error(`Unexpected URL: ${url}`)
      },
    }))

    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new TenByTenAdapter({ api_key: 'api-key', shop_id: 'brand' })
    const orders = await adapter.getOrders(new Date('2026-05-01T00:00:00+09:00'))

    expect(orders).toHaveLength(1)
    expect(orders[0].marketplaceOrderId).toBe('T-1001')
    expect(orders[0].items[0].productName).toBe('신규 쪽 상품명')
  })

  it('formats order search dates in KST regardless of server timezone', async () => {
    const get = vi.fn(() => ({
      json: async () => envelope([]),
    }))

    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new TenByTenAdapter({ api_key: 'api-key', shop_id: 'brand' })
    await adapter.getOrders(new Date('2026-05-01T00:00:00+09:00'))

    expect(get).toHaveBeenCalledWith(expect.stringContaining('startdate=2026-05-01+00%3A00%3A00'))
  })

  it('keeps 신규주문 when 미출고 조회 fails', async () => {
    const get = vi.fn((url: string) => ({
      json: async () => {
        if (url.startsWith('orders/orderhistory?')) {
          throw new Error('temporary history failure')
        }
        if (url.startsWith('orders?')) {
          return envelope([order('T-1002', '신규 상품')])
        }
        throw new Error(`Unexpected URL: ${url}`)
      },
    }))

    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new TenByTenAdapter({ api_key: 'api-key', shop_id: 'brand' })
    const orders = await adapter.getOrders(new Date('2026-05-01T00:00:00+09:00'))

    expect(orders.map((o) => o.marketplaceOrderId)).toEqual(['T-1002'])
  })

  it('retries without brandId when brand-filtered 10x10 order search returns empty', async () => {
    const get = vi.fn((url: string) => ({
      json: async () => {
        if (url.includes('brandId=brand')) {
          return envelope([])
        }
        if (url.startsWith('orders/orderhistory?')) {
          return envelope([])
        }
        if (url.startsWith('orders?')) {
          return envelope([order('T-1003', '브랜드 미필터 상품')])
        }
        throw new Error(`Unexpected URL: ${url}`)
      },
    }))

    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new TenByTenAdapter({ api_key: 'api-key', shop_id: 'brand' })
    const orders = await adapter.getOrders(new Date('2026-05-01T00:00:00+09:00'))

    expect(get).toHaveBeenCalledWith(expect.stringContaining('brandId=brand'))
    expect(get).toHaveBeenCalledWith(expect.not.stringContaining('brandId=brand'))
    expect(orders.map((o) => o.marketplaceOrderId)).toEqual(['T-1003'])
  })

  it('uploads invoice using detailIdx from stored rawData', async () => {
    const post = vi.fn(() => ({
      json: async () => ({
        hasError: false,
        hasAlert: false,
        message: '',
        code: 'SUCCESS',
        outPutValue: {},
      }),
    }))

    vi.mocked(ky.create).mockReturnValue({ post } as never)

    const adapter = new TenByTenAdapter({ api_key: 'api-key', shop_id: 'brand' })
    const result = await adapter.uploadInvoice('T-1001', {
      trackingNumber: '1234567890',
      carrierId: 'CJ',
      rawData: {
        details: [{ DetailIdx: 1001 }, { DetailIdx: 1002 }],
      },
    })

    expect(result.success).toBe(true)
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenNthCalledWith(1, 'orders/orderconfirm', expect.objectContaining({
      json: expect.objectContaining({ orderSerial: 'T-1001', detailIdx: '1001', songjangNo: '1234567890' }),
    }))
    expect(post).toHaveBeenNthCalledWith(2, 'orders/orderconfirm', expect.objectContaining({
      json: expect.objectContaining({ orderSerial: 'T-1001', detailIdx: '1002', songjangNo: '1234567890' }),
    }))
  })
})
