import type {
  InvoiceData,
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedClaim,
  NormalizedOrder,
  NormalizedProduct,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { getCarrierName } from '@/lib/shipping/carrier-codes'
import { createSpecialofferClient } from './client'
import type {
  SpecialofferBuyerOrder,
  SpecialofferBuyerOrderRequest,
  SpecialofferItemResponse,
  SpecialofferListResponse,
  SpecialofferMutationResponse,
  SpecialofferPointResponse,
  SpecialofferProduct,
  SpecialofferProductPayload,
} from './types'

const SPECIALOFFER_CONFIG: MarketplaceConfig = {
  id: 'specialoffer',
  name: '스페셜오퍼',
  authType: 'api_key',
  rateLimitPerSecond: 10,
  requiredCredentials: ['api_key'],
}

const PRODUCT_PAGE_SIZE = 100
const MAX_PRODUCT_PAGES = 5
const ORDER_PAGE_SIZE = 30
const MAX_ORDER_PAGES = 100
const COLLECTABLE_ORDER_STATES = new Set(['2', '3'])

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function parseSpecialofferDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}+09:00`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function orderActivityDate(order: SpecialofferBuyerOrder): Date | null {
  const updatedAt = parseSpecialofferDate(order.updated_at)
  const orderedAt = parseSpecialofferDate(order.order_date)
  if (updatedAt && orderedAt) return updatedAt > orderedAt ? updatedAt : orderedAt
  return updatedAt ?? orderedAt
}

function mapOrderStatus(order: SpecialofferBuyerOrder): NormalizedOrder['status'] {
  const state = asString(order.order_state).trim()
  const stateText = state.toLowerCase()

  if (stateText.includes('취소') || state === '0' || state === '9') return 'cancelled'
  if (stateText.includes('완료') || state === '6' || state === '7') return 'delivered'
  if (order.delivery_no || order.delivery_date || state === '5') return 'shipped'
  if (COLLECTABLE_ORDER_STATES.has(state)) return 'new'
  if (stateText.includes('준비') || state === '4') return 'confirmed'
  return 'new'
}

function isCollectableSellerOrder(order: SpecialofferBuyerOrder): boolean {
  const state = asString(order.order_state).trim()
  return COLLECTABLE_ORDER_STATES.has(state) && !order.delivery_no && !order.delivery_date
}

function imagesFromProduct(product: SpecialofferProduct): Array<{ url: string; sortOrder: number }> {
  return [product.image_1, product.image_2, product.image_3, product.image_4, product.image_5, product.image_6]
    .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    .map((url, index) => ({ url, sortOrder: index }))
}

async function toApiMessage(action: string, error: unknown): Promise<string> {
  if (error instanceof Error && 'response' in error) {
    const response = (error as { response: Response }).response
    const body = await response.text().catch(() => '')
    const detail = body ? `: ${body.slice(0, 500)}` : ''
    return `${action} failed: ${response.status} ${response.statusText}${detail}`
  }
  return `${action} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
}

function mutationId(response: SpecialofferMutationResponse): string | undefined {
  return asString(response.goods_no ?? response.no ?? response.id ?? response.data?.goods_no ?? response.data?.no ?? response.data?.id) || undefined
}

function specialofferOrderIdFromInvoice(orderId: string, invoice: InvoiceData): string {
  const rawData = invoice.rawData
  if (rawData && typeof rawData === 'object') {
    const raw = rawData as Record<string, unknown>
    const candidates = [
      raw.order_id,
      raw.id,
      raw.no,
      raw.marketplaceOrderIdentity && typeof raw.marketplaceOrderIdentity === 'object'
        ? (raw.marketplaceOrderIdentity as Record<string, unknown>).itemIds
        : undefined,
      raw.orderIdentity && typeof raw.orderIdentity === 'object'
        ? (raw.orderIdentity as Record<string, unknown>).itemIds
        : undefined,
    ]

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        const first = asString(candidate[0])
        if (first) return first
        continue
      }
      const value = asString(candidate)
      if (value) return value
    }
  }

  return orderId
}

function productPayloadFromNormalized(product: NormalizedProduct): SpecialofferProductPayload {
  const metadata = product.metadata ?? {}
  const specialoffer = metadata.specialoffer
  const source = specialoffer && typeof specialoffer === 'object'
    ? { ...(specialoffer as Record<string, unknown>) }
    : {}

  const imageUrls = product.images?.map((image) => image.url).filter(Boolean) ?? []
  const payload: SpecialofferProductPayload = {
    ...source,
    name: source.name ?? product.name,
    contents: source.contents ?? source.content ?? product.description,
    supply_price: source.supply_price ?? product.price,
    origin_price: source.origin_price ?? product.price,
    seller_goods_code: source.seller_goods_code ?? product.sku,
  }

  for (let index = 0; index < Math.min(imageUrls.length, 6); index++) {
    payload[`image_${index + 1}`] = source[`image_${index + 1}`] ?? imageUrls[index]
  }

  if (product.variants?.length && payload.option_values == null) {
    payload.option_values = product.variants.map((variant) => ({
      values: Object.values(variant.optionValues ?? {}).map(String),
      supply_price: variant.price - product.price,
      stock_qty: variant.stockQuantity ?? 0,
    }))
  }

  return payload
}

export class SpecialofferAdapter implements MarketplaceAdapter {
  readonly config = SPECIALOFFER_CONFIG

  private readonly client: ReturnType<typeof createSpecialofferClient>

  constructor(credentials: { api_key: string }) {
    this.client = createSpecialofferClient(credentials)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      const response = await this.client.get('api/points', {
        searchParams: {
          per_page: '1',
        },
      }).json<SpecialofferPointResponse>()
      if (response.error) return { success: false, error: response.error }
      return { success: true }
    } catch (error) {
      return { success: false, error: await toApiMessage('Specialoffer connection test', error) }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    const result = await this.testConnection()
    if (!result.success) throw new MarketplaceAuthError('specialoffer', result.error ?? '스페셜오퍼 인증 실패')
    return { success: true }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    try {
      const orders: NormalizedOrder[] = []

      for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
        const response = await this.client.get('api/v2/seller/orders', {
          searchParams: {
            page: String(page),
            per_page: String(ORDER_PAGE_SIZE),
          },
        }).json<SpecialofferListResponse<SpecialofferBuyerOrder>>()

        if (response.error) {
          throw new MarketplaceApiError('specialoffer', 400, response.error)
        }

        const data = response.data ?? []
        for (const order of data) {
          if (!isCollectableSellerOrder(order)) continue
          const activityDate = orderActivityDate(order)
          if (activityDate && (activityDate < since || activityDate > until)) continue
          orders.push(this.normalizeOrder(order))
        }

        const lastPage = response.meta?.last_page
        const reachedEnd = !lastPage || page >= lastPage || data.length === 0
        const canStopByDate = data.some((order) => {
          const activityDate = orderActivityDate(order)
          return activityDate ? activityDate < since : false
        })
        if (reachedEnd || canStopByDate) break
      }

      return orders
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      throw new MarketplaceApiError('specialoffer', 500, await toApiMessage('Specialoffer order fetch', error))
    }
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const specialofferOrderId = specialofferOrderIdFromInvoice(orderId, invoice)
      const response = await this.client.patch(`api/v2/seller/orders/${encodeURIComponent(specialofferOrderId)}`, {
        json: {
          delivery_company: getCarrierName(invoice.carrierId),
          delivery_no: invoice.trackingNumber,
        },
      }).json<SpecialofferMutationResponse>()

      if (response.error || response.success === false || response.result === false) {
        return { success: false, error: response.error ?? response.message ?? '스페셜오퍼 송장 전송 실패' }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: await toApiMessage('Specialoffer invoice upload', error) }
    }
  }

  async confirmOrder(_marketplaceOrderId: string): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    try {
      const products: NormalizedProduct[] = []
      for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
        const response = await this.client.get('api/goods', {
          searchParams: {
            page: String(page),
            per_page: String(PRODUCT_PAGE_SIZE),
            state: '1,2,3,4',
          },
        }).json<SpecialofferListResponse<SpecialofferProduct>>()

        if (response.error) {
          throw new MarketplaceApiError('specialoffer', 400, response.error)
        }

        products.push(...(response.data ?? []).map((product) => this.normalizeProduct(product)))

        const lastPage = response.meta?.last_page
        if (!lastPage || page >= lastPage || (response.data ?? []).length === 0) break
      }
      return products
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      throw new MarketplaceApiError('specialoffer', 500, await toApiMessage('Specialoffer product fetch', error))
    }
  }

  async getProduct(goodsNo: string | number): Promise<NormalizedProduct | null> {
    const response = await this.client.get(`api/goods/${encodeURIComponent(String(goodsNo))}`).json<SpecialofferItemResponse<SpecialofferProduct>>()
    if (!response.data) return null
    return this.normalizeProduct(response.data)
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('api/seller/goods', {
        json: productPayloadFromNormalized(product),
      }).json<SpecialofferMutationResponse>()

      if (response.error || response.success === false) {
        return { success: false, error: response.error ?? response.message ?? '스페셜오퍼 상품등록 실패' }
      }
      return { success: true, marketplaceProductId: mutationId(response) }
    } catch (error) {
      return { success: false, error: await toApiMessage('Specialoffer product register', error) }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.post(`api/seller/goods/${encodeURIComponent(marketplaceProductId)}`, {
        json: productPayloadFromNormalized(product as NormalizedProduct),
      }).json<SpecialofferMutationResponse>()

      if (response.error || response.success === false) {
        return { success: false, error: response.error ?? response.message ?? '스페셜오퍼 상품수정 실패' }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: await toApiMessage('Specialoffer product update', error) }
    }
  }

  async createBuyerOrder(payload: SpecialofferBuyerOrderRequest): Promise<SpecialofferMutationResponse> {
    return this.client.post('api/v2/orders', { json: payload }).json<SpecialofferMutationResponse>()
  }

  async getBuyerOrders(page = 1, perPage = 15): Promise<SpecialofferListResponse<SpecialofferBuyerOrder>> {
    return this.client.get('api/v2/orders', {
      searchParams: {
        page: String(page),
        per_page: String(perPage),
      },
    }).json<SpecialofferListResponse<SpecialofferBuyerOrder>>()
  }

  async getSellerOrders(page = 1, perPage = 15): Promise<SpecialofferListResponse<SpecialofferBuyerOrder>> {
    return this.client.get('api/v2/seller/orders', {
      searchParams: {
        page: String(page),
        per_page: String(perPage),
      },
    }).json<SpecialofferListResponse<SpecialofferBuyerOrder>>()
  }

  async cancelBuyerOrder(orderId: string | number, reason: string): Promise<SpecialofferMutationResponse> {
    return this.client.post(`api/v2/orders/${encodeURIComponent(String(orderId))}/cancel`, {
      json: { reason },
    }).json<SpecialofferMutationResponse>()
  }

  private normalizeOrder(order: SpecialofferBuyerOrder): NormalizedOrder {
    const orderId = asString(order.order_id || order.order_no)
    const orderNo = asString(order.order_no || order.order_id)
    const quantity = Math.max(1, asNumber(order.sum_qty))
    const goodsPrice = asNumber(order.goods_price)
    const totalAmount = asNumber(order.total_price || goodsPrice)
    const orderedAt = parseSpecialofferDate(order.order_date) ?? parseSpecialofferDate(order.updated_at) ?? new Date()
    const address2 = [order.receiver_addr2, order.receiver_addr3]
      .map(asString)
      .filter(Boolean)
      .join(' ')

    return {
      marketplaceOrderId: orderNo,
      marketplaceId: 'specialoffer',
      marketplaceStatus: asString(order.order_state),
      status: mapOrderStatus(order),
      buyerName: order.receiver_name ?? '',
      buyerPhone: order.receiver_telephone,
      buyerPhone2: order.receiver_cellphone,
      recipientName: order.receiver_name ?? '',
      recipientPhone: order.receiver_telephone,
      recipientPhone2: order.receiver_cellphone,
      shippingAddress: {
        zipCode: order.receiver_zip ?? '',
        address1: order.receiver_addr ?? '',
        address2: address2 || undefined,
      },
      items: [
        {
          marketplaceItemId: orderId,
          productName: order.goods_name ?? '스페셜오퍼 상품',
          quantity,
          unitPrice: quantity > 0 ? Math.round(goodsPrice / quantity) : goodsPrice,
        },
      ],
      orderedAt,
      totalAmount,
      shippingFee: asNumber(order.shipping_fee),
      deliveryMessage: order.memo ?? null,
      rawData: {
        ...order,
        orderNo,
        marketplaceOrderIdentity: {
          orderId: orderNo,
          itemIds: [orderId],
        },
      },
    }
  }

  private normalizeProduct(product: SpecialofferProduct): NormalizedProduct {
    const productId = asString(product.goods_no ?? product.no)
    const optionValues = product.option_values ?? []
    return {
      productId,
      marketplaceId: 'specialoffer',
      name: product.name ?? '스페셜오퍼 상품',
      description: product.contents ?? product.content ?? undefined,
      price: asNumber(product.price ?? product.supply_price),
      sku: product.goods_code ?? product.code ?? product.seller_goods_code ?? productId,
      categoryId: product.category_code,
      marketplaceCategoryId: product.category_code,
      images: imagesFromProduct(product),
      variants: optionValues.map((option, index) => ({
        sku: `${product.goods_code ?? product.code ?? productId}-${index + 1}`,
        optionValues: { option: (option.values ?? []).join(' / ') },
        price: asNumber(product.price ?? product.supply_price) + asNumber(option.option_price ?? option.supply_price),
        stockQuantity: asNumber(option.stock_quantity ?? option.stock_qty),
        marketplaceVariantId: String(index + 1),
      })),
      metadata: {
        goodsCode: product.goods_code ?? product.code,
        sellerCode: product.seller_code,
        brandName: product.brand_name,
        modelName: product.model_name,
        origin: product.origin,
        maker: product.maker,
        keywords: product.keywords,
        state: product.state,
        supplyPrice: asNumber(product.supply_price),
        originPrice: asNumber(product.origin_price),
        stockType: product.stock_type,
        stockQty: asNumber(product.stock_qty),
        shippingFeeType: product.shipping_fee_type,
        shippingFeePayment: product.shipping_fee_payment,
        shippingFee: asNumber(product.shipping_fee),
        shippingEtc: product.shipping_etc,
        detailUrl: product.goods_info_url ?? product.detail_url,
        smartstoreCategoryCode: product.smartstore_category_code,
        isBundledShipping: product.is_bundled_shipping,
        createdAt: product.created_at,
        updatedAt: product.updated_at,
        raw: product,
      },
    }
  }
}
