/**
 * Ably (에이블리) marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses API key authentication with JSON responses.
 *
 * NOTE: API details are best-effort (per D-03). Endpoints will be updated
 * when real API docs become available.
 */

import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { createAblyClient } from './client'
import { mapAblyStatus, mapAblyClaimType, mapAblyClaimStatus } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  AblyApiResponse,
  AblyOrder,
  AblyClaim,
  AblyProduct,
} from './types'

const ABLY_CONFIG: MarketplaceConfig = {
  id: 'ably',
  name: '에이블리',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['api_key', 'shop_id'],
}

/** Format a Date as ISO date string (yyyy-MM-dd) for API date params */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function normalizeAblyOrderId(orderId: string): string {
  const raw = orderId.trim()
  if (!raw) return raw
  const firstNumericGroup = raw.match(/\d+/)?.[0]
  return firstNumericGroup || raw
}

function asText(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text.length > 0 ? text : undefined
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asText(value)
    if (text) return text
  }
  return undefined
}

function resolveAblyOrderNumber(order: AblyOrder): string {
  const explicitOrderNo = firstText(
    order.orderNo,
    order.orderNumber,
    order.orderCode,
    order.order_no,
    order.order_number,
    order.order_code,
  )
  if (explicitOrderNo) return explicitOrderNo

  const fallback = firstText(order.orderId, order.order_id)
  return fallback ? normalizeAblyOrderId(fallback) : ''
}

function resolveAblyApiOrderId(order: AblyOrder): string {
  return firstText(
    order.orderId,
    order.order_id,
    order.productOrderId,
    order.product_order_id,
    order.orderItemId,
    order.order_item_id,
    order.orderNo,
    order.order_no,
  ) ?? ''
}

function resolveInvoiceOrderId(orderId: string, rawData: unknown): string {
  const raw = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
    ? rawData as Record<string, unknown>
    : {}
  const identity = raw.orderIdentity && typeof raw.orderIdentity === 'object'
    ? raw.orderIdentity as { itemIds?: unknown }
    : null
  const itemIds = Array.isArray(identity?.itemIds) ? identity.itemIds : []

  return firstText(
    raw.ablyApiOrderId,
    itemIds[0],
    raw.originalOrderId,
    raw.originalMarketplaceOrderId,
    raw.orderId,
    raw.order_id,
    orderId,
  ) ?? orderId
}

export class AblyAdapter implements MarketplaceAdapter {
  readonly config = ABLY_CONFIG

  private readonly client: ReturnType<typeof createAblyClient>
  private readonly shopId: string

  constructor(credentials: { api_key: string; shop_id: string }) {
    this.client = createAblyClient(credentials.api_key)
    this.shopId = credentials.shop_id
  }

  async testConnection(): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      // Keep credential checks away from order endpoints. Some marketplaces
      // mutate order state during "new order" reads.
      const response = await this.client.get('products', {
        searchParams: {
          shopId: this.shopId,
          pageSize: '1',
        },
      }).json<AblyApiResponse<AblyProduct[]>>()

      if (response.success) {
        return { success: true }
      }
      return { success: false, error: response.message || 'Unknown error' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    return { success: true }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    try {
      const response = await this.client.get('orders', {
        searchParams: {
          shopId: this.shopId,
          dateFrom: formatDate(since),
          dateTo: formatDate(until),
          pageSize: '50',
        },
      }).json<AblyApiResponse<AblyOrder[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ably', 400, response.message || 'Failed to fetch orders')
      }

      const orders = response.data || []
      return orders.map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ably', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ably', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const now = new Date()

    try {
      const response = await this.client.get('claims', {
        searchParams: {
          shopId: this.shopId,
          dateFrom: formatDate(since),
          dateTo: formatDate(now),
          pageSize: '50',
        },
      }).json<AblyApiResponse<AblyClaim[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ably', 400, response.message || 'Failed to fetch claims')
      }

      const claims = response.data || []
      return claims.map((claim) => this.normalizeClaim(claim))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ably', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ably', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const carrierCode = mapCarrierCode('ably', invoice.carrierId)
      const apiOrderId = resolveInvoiceOrderId(orderId, invoice.rawData)

      const response = await this.client.post(`orders/${apiOrderId}/invoice`, {
        json: {
          shopId: this.shopId,
          carrierCode,
          trackingNumber: invoice.trackingNumber,
        },
      }).json<AblyApiResponse<null>>()

      if (response.success) {
        return { success: true }
      }
      return { success: false, error: response.message || 'Invoice upload failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async confirmOrder(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '발주확인 미구현' }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    try {
      const response = await this.client.get('products', {
        searchParams: {
          shopId: this.shopId,
          pageSize: '50',
        },
      }).json<AblyApiResponse<AblyProduct[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ably', 400, response.message || 'Failed to fetch products')
      }

      const products = response.data || []
      return products.map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ably', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ably', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('products', {
        json: {
          shopId: this.shopId,
          name: product.name,
          price: product.price,
          sku: product.sku,
          description: product.description,
        },
      }).json<AblyApiResponse<{ productId: string }>>()

      if (response.success) {
        return {
          success: true,
          marketplaceProductId: response.data.productId,
        }
      }
      return { success: false, error: response.message || 'Product registration failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.put(`products/${marketplaceProductId}`, {
        json: {
          shopId: this.shopId,
          ...(product.name != null && { name: product.name }),
          ...(product.price != null && { price: product.price }),
          ...(product.description != null && { description: product.description }),
        },
      }).json<AblyApiResponse<null>>()

      if (response.success) {
        return { success: true }
      }
      return { success: false, error: response.message || 'Product update failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: AblyOrder): NormalizedOrder {
    const marketplaceOrderId = resolveAblyOrderNumber(order)
    const apiOrderId = resolveAblyApiOrderId(order) || marketplaceOrderId
    const rawData = {
      ...(order as unknown as Record<string, unknown>),
      originalOrderId: order.orderId,
      normalizedOrderId: marketplaceOrderId,
      ablyApiOrderId: apiOrderId,
      marketplaceOrderIdentity: {
        orderId: marketplaceOrderId,
        itemIds: [apiOrderId],
      },
    }

    return {
      marketplaceOrderId,
      marketplaceId: 'ably',
      marketplaceStatus: order.orderStatus,
      status: mapAblyStatus(order.orderStatus),
      buyerName: order.buyerName,
      buyerPhone: order.buyerPhone || undefined,
      recipientName: order.receiverName,
      recipientPhone: order.receiverPhone || undefined,
      shippingAddress: {
        zipCode: order.receiverZipcode,
        address1: order.receiverAddress,
        address2: order.receiverAddressDetail || undefined,
      },
      items: [
        {
          marketplaceItemId: apiOrderId,
          productName: order.productName,
          optionText: order.options || undefined,
          quantity: order.quantity,
          unitPrice: order.paymentAmount / (order.quantity || 1),
          sku: order.sellerItemCode,
        },
      ],
      orderedAt: new Date(order.orderDate),
      totalAmount: order.paymentAmount,
      rawData,
    }
  }

  private normalizeClaim(claim: AblyClaim): NormalizedClaim {
    return {
      marketplaceClaimId: claim.claimId,
      marketplaceId: 'ably',
      marketplaceOrderId: normalizeAblyOrderId(claim.orderId),
      claimType: mapAblyClaimType(claim.claimType),
      claimStatus: mapAblyClaimStatus(claim.claimStatus),
      reason: claim.reason || undefined,
      requestedAt: new Date(claim.createdAt),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: AblyProduct): NormalizedProduct {
    return {
      productId: product.productId,
      marketplaceId: 'ably',
      name: product.name,
      price: product.price,
      sku: product.productId,
      status: product.status,
    }
  }
}
