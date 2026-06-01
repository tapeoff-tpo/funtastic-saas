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

  it('collects supplier orders from the seller order endpoint', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        data: [
          {
            order_id: '571610',
            order_no: '26051415470129',
            order_state: 3,
            goods_name: '휴대용 캠핑 취사용품 스텐 키친툴 조리도구 5종 세트',
            sum_qty: 1,
            goods_price: 8000,
            shipping_fee: 3000,
            total_price: 11000,
            receiver_name: '홍길동',
            receiver_telephone: '02-0000-0000',
            receiver_cellphone: '010-0000-0000',
            receiver_zip: '06000',
            receiver_addr1: '서울시 강남구',
            receiver_addr2: '101호',
            receiver_addr3: '상세',
            option_name: '블랙 / L',
            memo: '문 앞에 놓아주세요.',
            order_date: '2026-05-14 15:47:01',
            updated_at: '2026-05-14 15:47:01',
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      }),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-14T00:00:00+09:00'))

    expect(get).toHaveBeenCalledWith('api/v2/seller/orders', {
      searchParams: {
        page: '1',
        per_page: '30',
      },
    })
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({
      marketplaceOrderId: '26051415470129',
      marketplaceId: 'specialoffer',
      marketplaceStatus: '3',
      marketplaceCollectionStatus: 'ready',
      status: 'new',
      buyerName: '홍길동',
      buyerPhone: '02-0000-0000',
      buyerPhone2: '010-0000-0000',
      recipientName: '홍길동',
      shippingAddress: {
        zipCode: '06000',
        address1: '서울시 강남구',
        address2: '101호 상세',
      },
      totalAmount: 11000,
      shippingFee: 3000,
      deliveryMessage: '문 앞에 놓아주세요.',
    })
    expect(orders[0].orderedAt.toISOString()).toBe('2026-05-14T06:47:01.000Z')
    expect(orders[0].items).toEqual([
      {
        marketplaceItemId: '571610',
        productName: '휴대용 캠핑 취사용품 스텐 키친툴 조리도구 5종 세트',
        optionText: '블랙 / L',
        quantity: 1,
        unitPrice: 8000,
      },
    ])
    expect(orders[0].rawData.marketplaceOrderIdentity).toEqual({
      orderId: '26051415470129',
      itemIds: ['571610'],
    })
  })

  it('maps Specialoffer 배송준비 wording to marketplace shipping preparation', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        data: [
          {
            order_id: '571611',
            order_no: '26051415470130',
            order_state: '배송준비',
            goods_name: '테스트 상품',
            sum_qty: 1,
            goods_price: 8000,
            total_price: 8000,
            receiver_name: '홍길동',
            receiver_zip: '06000',
            receiver_addr1: '서울시 강남구',
            order_date: '2026-05-14 15:47:01',
            updated_at: '2026-05-14 15:47:01',
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      }),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-14T00:00:00+09:00'))

    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({
      marketplaceStatus: '배송준비',
      marketplaceCollectionStatus: 'ready',
    })
  })

  it('fills missing order options from product options when the order price identifies one option', async () => {
    const get = vi.fn((endpoint: string) => ({
      json: async () => {
        if (endpoint === 'api/v2/seller/orders') {
          return {
            data: [
              {
                order_id: '571612',
                order_no: '26051415470131',
                order_state: 2,
                goods_no: '999001',
                goods_name: 'option product',
                sum_qty: 1,
                goods_price: 7600,
                total_price: 10600,
                shipping_fee: 3000,
                receiver_name: 'buyer',
                receiver_zip: '06000',
                receiver_addr1: 'addr',
                order_date: '2026-05-14 15:47:01',
                updated_at: '2026-05-14 15:47:01',
              },
            ],
            meta: { current_page: 1, last_page: 1, total: 1 },
          }
        }
        if (endpoint === 'api/v2/seller/orders/571612') {
          return { data: { order_id: '571612' } }
        }
        if (endpoint === 'api/goods/999001') {
          return {
            data: {
              goods_no: '999001',
              option_titles: ['옵션'],
              option_values: [
                { values: ['기본'], option_price: 0, stock_quantity: 10 },
                { values: ['대형'], option_price: 4400, stock_quantity: 10 },
              ],
              supply_price: 3200,
            },
          }
        }
        return { data: {} }
      },
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-14T00:00:00+09:00'))

    expect(orders[0].items[0].optionText).toBe('옵션: 대형')
  })

  it('fills missing order options from the only in-stock product option when prices are identical', async () => {
    const get = vi.fn((endpoint: string) => ({
      json: async () => {
        if (endpoint === 'api/v2/seller/orders') {
          return {
            data: [
              {
                order_id: '574598',
                order_no: '26052920321507',
                order_state: 2,
                goods_no: '515138',
                goods_name: '캠핑 USB 충전식 점화기 아크 플라즈마 전기 라이터',
                sum_qty: 3,
                goods_price: 4500,
                total_price: 16500,
                shipping_fee: 3000,
                receiver_name: 'buyer',
                receiver_zip: '06000',
                receiver_addr1: 'addr',
                order_date: '2026-05-29 20:32:15',
                updated_at: '2026-05-29 20:32:15',
              },
            ],
            meta: { current_page: 1, last_page: 1, total: 1 },
          }
        }
        if (endpoint === 'api/v2/seller/orders/574598') {
          return { data: { order_id: '574598' } }
        }
        if (endpoint === 'api/goods/515138') {
          return {
            data: {
              goods_no: '515138',
              option_titles: ['옵션'],
              option_values: [
                { values: ['실버'], option_price: 0, stock_quantity: 682 },
                { values: ['블랙'], option_price: 0, stock_quantity: 0 },
                { values: ['로즈골드'], option_price: 0, stock_quantity: 0 },
              ],
              supply_price: 5100,
            },
          }
        }
        return { data: {} }
      },
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-29T00:00:00+09:00'))

    expect(orders[0].items[0].optionText).toBe('옵션: 실버')
  })

  it('confirms collected orders with the seller order PATCH endpoint', async () => {
    const post = vi.fn(() => ({
      json: async () => ({ success: true }),
    }))
    vi.mocked(ky.create).mockReturnValue({ post } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const result = await adapter.confirmOrder('26051415470129', {
      order_id: '571610',
      marketplaceOrderIdentity: {
        orderId: '26051415470129',
        itemIds: ['571610'],
      },
    })

    expect(result.success).toBe(true)
    expect(post).toHaveBeenCalledWith('api/v2/seller/orders/571610', {
      searchParams: { _method: 'PATCH' },
      json: {
        order_state: 4,
        state: 4,
      },
    })
  })

  it('skips seller orders that already have delivery data', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        data: [
          {
            order_id: '570869',
            order_no: '26051208262418',
            order_state: 5,
            goods_name: '이미 출고된 상품',
            sum_qty: 1,
            goods_price: 8000,
            total_price: 8000,
            delivery_no: '1234567890',
            delivery_date: '2026-05-12 15:16:23',
            order_date: '2026-05-12 08:26:24',
            updated_at: '2026-05-15 00:00:00',
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      }),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-14T00:00:00+09:00'))

    expect(orders).toEqual([])
  })

  it('captures selection-labelled order options', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        data: [
          {
            order_id: '571611',
            order_no: '26052608062403',
            order_state: 3,
            goods_name: 'Sample product 선택: Navy',
            선택: 'Navy',
            sum_qty: 1,
            goods_price: 8000,
            total_price: 8000,
            order_date: '2026-05-26 08:06:24',
            updated_at: '2026-05-26 08:06:24',
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      }),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-26T00:00:00+09:00'))

    expect(orders[0].items[0].optionText).toBe('선택: Navy')
  })

  it('loads seller order detail when the list response omits selected options', async () => {
    const get = vi.fn((path: string) => ({
      json: async () => {
        if (path === 'api/v2/seller/orders/573502') {
          return {
            data: {
              order_id: '573502',
              option_name: '화이트',
            },
          }
        }
        return {
          data: [
            {
              order_id: '573502',
              order_no: '26052608062403',
              order_state: 3,
              goods_name: '멀티 야채 쌀씻는도구 믹싱볼 스텐 타공 채반 세척볼',
              sum_qty: 1,
              goods_price: 8000,
              total_price: 8000,
              order_date: '2026-05-26 08:06:24',
              updated_at: '2026-05-26 08:06:24',
            },
          ],
          meta: { current_page: 1, last_page: 1, total: 1 },
        }
      },
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-26T00:00:00+09:00'))

    expect(get).toHaveBeenCalledWith('api/v2/seller/orders/573502')
    expect(orders[0].items[0].optionText).toBe('화이트')
  })

  it('uses a single product option when order responses omit option fields', async () => {
    const get = vi.fn((path: string) => ({
      json: async () => {
        if (path === 'api/v2/seller/orders/573489') {
          return { data: { order_id: '573489' } }
        }
        if (path === 'api/goods/831678') {
          return {
            data: {
              goods_no: '831678',
              option_titles: ['선택'],
              option_values: [{ values: ['화이트'], option_price: 0, stock_quantity: 9992 }],
            },
          }
        }
        return {
          data: [
            {
              order_id: '573489',
              order_no: '26052608061586',
              order_state: 3,
              goods_no: '831678',
              goods_name: '무선 탁상용 리모컨 선풍기 휴대용 접이식 핸디선풍기',
              sum_qty: 1,
              goods_price: 15400,
              total_price: 18400,
              order_date: '2026-05-26 08:06:15',
              updated_at: '2026-05-26 08:06:15',
            },
          ],
          meta: { current_page: 1, last_page: 1, total: 1 },
        }
      },
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-26T00:00:00+09:00'))

    expect(get).toHaveBeenCalledWith('api/goods/831678')
    expect(orders[0].items[0].optionText).toBe('선택: 화이트')
  })

  it('stops paging when a seller order page reaches older records', async () => {
    const get = vi.fn(() => ({
      json: async () => ({
        data: [
          {
            order_id: '571610',
            order_no: '26051415470129',
            order_state: 2,
            goods_name: '신규 상품',
            sum_qty: 1,
            goods_price: 8000,
            total_price: 8000,
            order_date: '2026-05-14 15:47:01',
            updated_at: '2026-05-14 15:47:01',
          },
          {
            order_id: '565375',
            order_no: '26041509321100',
            order_state: 5,
            goods_name: '오래된 상품',
            sum_qty: 1,
            goods_price: 5000,
            total_price: 5000,
            delivery_no: '1234567890',
            order_date: '2026-04-15 09:32:11',
            updated_at: '2026-04-24 00:00:00',
          },
        ],
        meta: { current_page: 1, last_page: 94, total: 2801 },
      }),
    }))
    vi.mocked(ky.create).mockReturnValue({ get } as never)

    const adapter = new SpecialofferAdapter({ api_key: 'test-key' })
    const orders = await adapter.getOrders(new Date('2026-05-13T00:00:00+09:00'))

    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenNthCalledWith(2, 'api/v2/seller/orders/571610')
    expect(orders).toHaveLength(1)
    expect(orders[0].marketplaceOrderId).toBe('26051415470129')
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
