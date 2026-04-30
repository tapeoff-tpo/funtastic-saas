import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { createKakaoStoreClient } from './client'
import { mapKakaoStoreStatus, mapKakaoStoreClaimStatus, mapKakaoStoreClaimType } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  KakaoStoreBulkOrdersResponse,
  KakaoStoreChangedOrdersResponse,
  KakaoStoreOrderDetail,
  KakaoStoreProduct,
  KakaoStoreProductResponse,
} from './types'

const KAKAO_STORE_CONFIG: MarketplaceConfig = {
  id: 'kakao-store',
  name: '카카오톡스토어',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['admin_app_key', 'seller_app_key'],
}

function formatKakaoDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function parseKakaoDate(value?: string): Date {
  if (!value) return new Date()
  if (/^\d{14}$/.test(value)) {
    const y = value.slice(0, 4)
    const m = value.slice(4, 6)
    const d = value.slice(6, 8)
    const hh = value.slice(8, 10)
    const mm = value.slice(10, 12)
    const ss = value.slice(12, 14)
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}+09:00`)
  }
  return new Date(value)
}

async function formatKakaoError(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: Response }).response
    if (response) {
      const body = await response.text().catch(() => '')
      return `${response.status} ${response.statusText}${body ? `: ${body}` : ''}`
    }
  }
  return error instanceof Error ? error.message : 'Unknown error'
}

export class KakaoStoreAdapter implements MarketplaceAdapter {
  readonly config = KAKAO_STORE_CONFIG

  private readonly client: ReturnType<typeof createKakaoStoreClient>

  constructor(credentials: { admin_app_key: string; seller_app_key: string; channel_ids?: string }) {
    this.client = createKakaoStoreClient(credentials)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      await this.registerSeller()
      await this.client.get('v2/shopping/orders', {
        searchParams: {
          size: 1,
          orderModifiedAtStart: formatKakaoDateTime(new Date(Date.now() - 60 * 60 * 1000)),
          orderModifiedAtEnd: formatKakaoDateTime(new Date()),
        },
      }).json()
      return { success: true }
    } catch (error) {
      const message = await formatKakaoError(error)
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // API key auth has no separate authentication flow.
    return { success: true }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    try {
      await this.registerSeller()
      const changed = await this.getChangedOrders(since)
      const orderIds = Array.from(new Set(changed.map((order) => order.orderId).filter(Boolean)))
      if (orderIds.length === 0) return []

      const details: KakaoStoreOrderDetail[] = []
      for (let i = 0; i < orderIds.length; i += 300) {
        const chunk = orderIds.slice(i, i + 300)
        const response = await this.client.get('v1/shopping/orders/bulk', {
          searchParams: { order_ids: chunk.join(',') },
        }).json<KakaoStoreBulkOrdersResponse>()
        details.push(...(response.content ?? []))
      }

      return details.map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      const message = await formatKakaoError(error)
      if (message.includes('401') || message.includes('403') || message.includes('-401')) {
        throw new MarketplaceAuthError('kakao-store', `API authentication failed: ${message}`)
      }
      throw new MarketplaceApiError('kakao-store', 500, message)
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    try {
      const orders = await this.getOrders(since)
      return orders.flatMap((order) => {
        const raw = order.rawData as unknown as KakaoStoreOrderDetail
        const claims = [
          { type: 'CANCEL', data: raw.orderClaimCancel },
          { type: 'EXCHANGE', data: raw.orderClaimExchange },
          { type: 'RETURN', data: raw.orderClaimReturn },
        ].filter((claim) => claim.data?.claimId)

        return claims.map((claim) => ({
          marketplaceClaimId: String(claim.data?.claimId),
          marketplaceId: 'kakao-store' as const,
          marketplaceOrderId: order.marketplaceOrderId,
          claimType: mapKakaoStoreClaimType(claim.type),
          claimStatus: mapKakaoStoreClaimStatus(claim.data?.claimItemStatus ?? 'REQUESTED'),
          reason: claim.data?.reasonCodeName || claim.data?.reasonComment || undefined,
          requestedAt: parseKakaoDate(claim.data?.createdAt ?? claim.data?.modifiedAt),
          rawData: claim.data as Record<string, unknown>,
        }))
      })
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      const message = await formatKakaoError(error)
      if (message.includes('401') || message.includes('403') || message.includes('-401')) {
        throw new MarketplaceAuthError('kakao-store', `API authentication failed: ${message}`)
      }
      throw new MarketplaceApiError('kakao-store', 500, message)
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const carrierCode = mapCarrierCode('kakao-store', invoice.carrierId)

      await this.client.post('v1/shopping/orders/deliveries/invoices', {
        json: {
          orderId,
          invoiceNumber: invoice.trackingNumber,
          deliveryCompanyCode: carrierCode,
        },
      }).json()

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async confirmOrder(
    marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.post('v1/shopping/orders/deliveries/status/confirm', {
        json: { orderIds: [Number(marketplaceOrderId)] },
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: await formatKakaoError(error) }
    }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    try {
      const response = await this.client.get('v2/store/products', {
        searchParams: { limit: 100 },
      }).json<KakaoStoreProductResponse>()

      return (response.products ?? []).map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      const message = await formatKakaoError(error)
      if (message.includes('401') || message.includes('403') || message.includes('-401')) {
        throw new MarketplaceAuthError('kakao-store', `API authentication failed: ${message}`)
      }
      throw new MarketplaceApiError('kakao-store', 500, message)
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('v2/store/products', {
        json: {
          product_name: product.name,
          price: product.price,
          product_code: product.sku,
        },
      }).json<{ product: { product_id: string } }>()

      return {
        success: true,
        marketplaceProductId: response.product.product_id,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    try {
      const body: Record<string, unknown> = {}
      if (product.name) body.product_name = product.name
      if (product.price != null) body.price = product.price

      await this.client.put(`v2/store/products/${marketplaceProductId}`, {
        json: body,
      }).json()

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private async getChangedOrders(since: Date): Promise<NonNullable<KakaoStoreChangedOrdersResponse['contents']>> {
    const orders: NonNullable<KakaoStoreChangedOrdersResponse['contents']> = []
    const finalEnd = new Date()
    let windowStart = since

    while (windowStart < finalEnd) {
      const windowEnd = new Date(Math.min(windowStart.getTime() + 24 * 60 * 60 * 1000 - 1000, finalEnd.getTime()))
      let cursor: { lastOrderId?: number; lastModifiedAt?: string } | undefined

      do {
        const searchParams: Record<string, string | number> = {
          size: 100,
          orderModifiedAtStart: formatKakaoDateTime(windowStart),
          orderModifiedAtEnd: formatKakaoDateTime(windowEnd),
        }
        if (cursor?.lastOrderId && cursor.lastModifiedAt) {
          searchParams.lastOrderId = cursor.lastOrderId
          searchParams.lastModifiedAt = cursor.lastModifiedAt
        }

        const response = await this.client.get('v2/shopping/orders', { searchParams }).json<KakaoStoreChangedOrdersResponse>()
        const page = response.contents ?? response.content ?? []
        orders.push(...page)
        cursor = response.token
      } while (cursor?.lastOrderId && cursor.lastModifiedAt)

      windowStart = new Date(windowEnd.getTime() + 1000)
    }

    return orders
  }

  private async registerSeller(): Promise<void> {
    await this.client.post('v1/store/register')
  }

  private normalizeOrder(order: KakaoStoreOrderDetail): NormalizedOrder {
    const status = order.orderBase?.status ?? 'UNKNOWN'
    const product = order.orderProduct
    const delivery = order.orderDeliveryRequest
    const itemPrice = Number(product?.productPrice ?? 0) + Number(product?.optionPrice ?? 0)
    const quantity = Number(product?.quantity ?? 1)
    const orderId = String(order.id ?? order.orderBase?.id)
    const receiverPhone = delivery?.receiverMobileNumber || delivery?.receiverPhoneNumber || undefined
    const itemId = String(product?.id ?? orderId)

    return {
      marketplaceOrderId: orderId,
      marketplaceId: 'kakao-store',
      marketplaceStatus: status,
      status: mapKakaoStoreStatus(status),
      buyerName: order.orderer?.phoneNumber || delivery?.receiverName || '카카오 구매자',
      buyerPhone2: order.orderer?.phoneNumber || undefined,
      recipientName: delivery?.receiverName || '카카오 수령인',
      recipientPhone2: receiverPhone,
      shippingAddress: {
        zipCode: delivery?.roadZipCode || delivery?.zipcode || '',
        address1: delivery?.receiverAddress1 || delivery?.receiverAddress || '',
        address2: delivery?.receiverAddress2 || undefined,
      },
      items: [{
        marketplaceItemId: itemId,
        productName: product?.name || '카카오톡스토어 상품',
        optionText: product?.optionContent || undefined,
        quantity,
        unitPrice: itemPrice,
        sku: product?.sellerItemNo || undefined,
      }],
      orderedAt: parseKakaoDate(order.orderBase?.paidAt ?? order.orderBase?.createdAt),
      totalAmount: itemPrice * quantity + Number(product?.deliveryAmount ?? 0),
      shippingFee: product?.deliveryAmount ?? null,
      deliveryMessage: delivery?.requirement || null,
      rawData: order as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: KakaoStoreProduct): NormalizedProduct {
    return {
      productId: product.product_id,
      marketplaceId: 'kakao-store',
      name: product.product_name,
      price: product.price,
      sku: product.product_code,
      images: product.image_url
        ? [{ url: product.image_url, sortOrder: 0 }]
        : [],
      status: product.status,
    }
  }
}
