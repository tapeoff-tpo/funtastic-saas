import { beforeEach, describe, expect, it, vi } from 'vitest'
import ky from 'ky'
import { SpecialofferAdapter } from '@/lib/marketplace/adapters/specialoffer/adapter'

vi.mock('ky', () => ({
  default: {
    create: vi.fn(),
  },
}))

describe('SpecialofferAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has api_key config for credential registration', () => {
    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })

    expect(adapter.config.id).toBe('specialoffer')
    expect(adapter.config.name).toBe('스페셜오퍼')
    expect(adapter.config.authType).toBe('api_key')
    expect(adapter.config.requiredCredentials).toEqual(['api_key'])
  })

  it('tests credentials with the read-only points endpoint', async () => {
    const get = vi.fn(() => ({
      json: async () => ({ data: { summary: { point: 1000 }, lists: [] } }),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const result = await adapter.testConnection()

    expect(result.success).toBe(true)
    expect(get).toHaveBeenCalledWith('api/points', {
      searchParams: { per_page: '1' },
    })
  })

  it('does not collect buyer-side purchase orders as sales orders', async () => {
    const get = vi.fn()
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-14T00:00:00+09:00'))

    expect(orders).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })

  it('normalizes Specialoffer goods into NormalizedProduct records', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        data: [
          {
            goods_no: '1033108',
            goods_code: 'TC01033108',
            category_code: '512510060',
            smartstore_category_code: '50003994',
            seller_code: 'SC00006287',
            name: '잔솔 여름 끈덧신',
            keywords: '덧신,페이크삭스',
            brand_name: '잔솔',
            model_name: '덧신끈양말',
            origin: '해외|아시아|중국',
            maker: '잔솔',
            state: '1',
            supply_price: 800,
            price: 800,
            origin_price: 1100,
            stock_qty: 3996,
            shipping_fee_type: '3',
            shipping_fee_payment: '0',
            shipping_fee: 3000,
            image_1: 'https://specialoffer.kr/data/goods/a.jpg',
            image_2: null,
            option_values: [
              { values: ['블랙'], option_price: 0, stock_quantity: 999 },
              { values: ['화이트'], option_price: 100, stock_quantity: 50 },
            ],
            goods_info_url: 'https://specialoffer.kr/shop/view.php?index_no=1033108',
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      }),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const products = await adapter.getProducts()

    expect(get).toHaveBeenCalledWith('api/goods', {
      searchParams: {
        page: '1',
        per_page: '100',
        state: '1,2,3,4',
      },
    })
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      productId: '1033108',
      marketplaceId: 'specialoffer',
      name: '잔솔 여름 끈덧신',
      price: 800,
      sku: 'TC01033108',
      categoryId: '512510060',
      marketplaceCategoryId: '512510060',
    })
    expect(products[0].images).toEqual([{ url: 'https://specialoffer.kr/data/goods/a.jpg', sortOrder: 0 }])
    expect(products[0].variants).toHaveLength(2)
    expect(products[0].variants?.[1]).toMatchObject({
      optionValues: { option: '화이트' },
      price: 900,
      stockQuantity: 50,
    })
    expect(products[0].metadata).toMatchObject({
      sellerCode: 'SC00006287',
      smartstoreCategoryCode: '50003994',
      shippingFee: 3000,
      detailUrl: 'https://specialoffer.kr/shop/view.php?index_no=1033108',
    })
  })

  it('passes specialoffer metadata through to supplier product registration', async () => {
    const post = vi.fn(() => ({
      json: async () => ({ data: { goods_no: '2001' } }),
    }))
    vi.mocked(ky.create).mockReturnValue({ post } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const result = await adapter.registerProduct({
      productId: 'local-1',
      marketplaceId: 'specialoffer',
      name: '등록상품',
      price: 30000,
      sku: 'SKU-1',
      images: [{ url: 'https://example.com/image.jpg', sortOrder: 0 }],
      metadata: {
        specialoffer: {
          category_code: '517502020',
          origin: '국내산',
          maker: '테이포프',
          order_end_at: '14:30',
          tax_type: '1',
          state: '1',
          price_type: '0',
          stock_type: '0',
          cert_type: '0',
          info_gubun: '01',
          is_medical: 'N',
          is_healthfood: 'N',
          is_refundable: '1',
          is_overseas_shipping: 'N',
        },
      },
    })

    expect(result).toEqual({ success: true, marketplaceProductId: '2001' })
    expect(post).toHaveBeenCalledWith('api/seller/goods', {
      json: expect.objectContaining({
        category_code: '517502020',
        name: '등록상품',
        supply_price: 30000,
        origin_price: 30000,
        seller_goods_code: 'SKU-1',
        image_1: 'https://example.com/image.jpg',
      }),
    })
  })
})
