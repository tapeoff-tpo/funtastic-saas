import { beforeEach, describe, expect, it, vi } from 'vitest'
import ky from 'ky'
import { PlayautoEmpAdapter } from '@/lib/marketplace/adapters/playauto-emp/adapter'

vi.mock('ky', () => ({
  default: {
    create: vi.fn(),
  },
}))

describe('PlayautoEmpAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has api_key config for credential registration', () => {
    const adapter = new PlayautoEmpAdapter({ api_key: 'test-key' })

    expect(adapter.config.id).toBe('playauto-emp')
    expect(adapter.config.name).toBe('플레이오토 EMP')
    expect(adapter.config.authType).toBe('api_key')
    expect(adapter.config.requiredCredentials).toEqual(['api_key'])
  })

  it('collects EMP orders and normalizes them for the SaaS order table', async () => {
    const get = vi.fn(() => ({
      json: async () => ([
        {
          UniqueId: 'u-1',
          Number: '1001',
          SiteCode: 'A112',
          SiteName: '11번가',
          SiteId: 'playauto',
          OrderState: '신규주문',
          OrderCode: '202605190001',
          ProdCode: 'P001',
          ProdName: '테스트 상품',
          Option: '블랙',
          Price: '12000',
          Count: '2',
          DelivMethod: '무료배송',
          DelivPrice: '0',
          OrderName: '구매자',
          OrderHtel: '010-1111-2222',
          RecipientName: '수령자',
          RecipientHtel: '010-3333-4444',
          RecipientZip: '06000',
          RecipientAddress: '서울시 강남구 테스트로 1',
          Msg: '문 앞',
          OrderDate: '2026-05-19 12:10:00',
          Sku_code: 'SKU-1',
        },
      ]),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new PlayautoEmpAdapter({ api_key: 'test-key', states: '신규주문' })
    const orders = await adapter.getOrders(
      new Date('2026-05-19T00:00:00+09:00'),
      new Date('2026-05-19T23:59:59+09:00'),
    )

    expect(get).toHaveBeenCalledWith('orders', {
      searchParams: expect.any(URLSearchParams),
    })
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({
      marketplaceOrderId: '202605190001',
      marketplaceId: 'playauto-emp',
      marketplaceStatus: '신규주문',
      status: 'new',
      buyerName: '구매자',
      buyerPhone2: '010-1111-2222',
      recipientName: '수령자',
      recipientPhone2: '010-3333-4444',
      shippingAddress: {
        zipCode: '06000',
        address1: '서울시 강남구 테스트로 1',
      },
      totalAmount: 24000,
      shippingFee: 0,
      deliveryMessage: '문 앞',
    })
    expect(orders[0].items).toEqual([
      {
        marketplaceItemId: '1001',
        productName: '테스트 상품',
        optionText: '블랙',
        quantity: 2,
        unitPrice: 12000,
        sku: 'SKU-1',
      },
    ])
    expect(orders[0].rawData).toMatchObject({
      empNumber: '1001',
      empSiteName: '11번가',
      originalMarketplaceId: 'A112:playauto',
    })
  })

  it('falls back to the slash orders endpoint when EMP returns 404', async () => {
    const notFound = new Error('not found') as Error & { response: { status: number } }
    notFound.response = { status: 404 }
    const get = vi.fn((path: string) => {
      if (path === 'orders') throw notFound
      return {
        json: async () => [],
      }
    })
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new PlayautoEmpAdapter({ api_key: 'test-key', states: '신규주문' })
    const orders = await adapter.getOrders(
      new Date('2026-05-19T00:00:00+09:00'),
      new Date('2026-05-19T23:59:59+09:00'),
    )

    expect(orders).toEqual([])
    expect(get).toHaveBeenNthCalledWith(1, 'orders', {
      searchParams: expect.any(URLSearchParams),
    })
    expect(get).toHaveBeenNthCalledWith(2, 'orders/', {
      searchParams: expect.any(URLSearchParams),
    })
  })

  it('treats EMP no-order 400/404 responses as an empty collection', async () => {
    const response = new Response(
      JSON.stringify({ status: false, message: '조회된 주문건이 없습니다.' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    )
    const noOrders = new Error('no orders') as Error & { response: Response }
    noOrders.response = response
    const get = vi.fn(() => {
      throw noOrders
    })
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new PlayautoEmpAdapter({ api_key: 'test-key', states: '신규주문' })
    const orders = await adapter.getOrders(
      new Date('2026-05-19T00:00:00+09:00'),
      new Date('2026-05-19T23:59:59+09:00'),
    )

    expect(orders).toEqual([])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('uploads invoice data to EMP senders endpoint using the EMP order number', async () => {
    const patch = vi.fn(() => ({
      json: async () => ({ number: '1001', status: 'true', msg: '성공.' }),
    }))
    vi.mocked(ky.create).mockReturnValue({ patch } as never)

    const adapter = new PlayautoEmpAdapter({ api_key: 'test-key' })
    const result = await adapter.uploadInvoice('202605190001', {
      carrierId: 'CJGLS',
      trackingNumber: '1234567890',
      rawData: { empNumber: '1001' },
    })

    expect(result).toEqual({ success: true })
    expect(patch).toHaveBeenCalledWith('senders', {
      json: {
        changeState: true,
        overWrite: true,
        data: [
          {
            number: '1001',
            sender: 'T025',
            senderno: '1234567890',
          },
        ],
      },
    })
  })
})
