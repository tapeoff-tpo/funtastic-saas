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
  MarketplaceCredentials,
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

export class AblyAdapter implements MarketplaceAdapter {
  readonly config = ABLY_CONFIG

  private readonly client: ReturnType<typeof createAblyClient>
  private readonly shopId: string

  constructor(credentials: { api_key: string; shop_id: string }) {
    this.client = createAblyClient(credentials.api_key)
    this.shopId = credentials.shop_id
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      const now = new Date()
      const response = await this.client.get('orders', {
        searchParams: {
          shopId: this.shopId,
          dateFrom: formatDate(now),
          dateTo: formatDate(now),
          pageSize: '1',
        },
      }).json<AblyApiResponse<AblyOrder[]>>()

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

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    const now = new Date()

    try {
      const response = await this.client.get('orders', {
        searchParams: {
          shopId: this.shopId,
          dateFrom: formatDate(since),
          dateTo: formatDate(now),
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

      const response = await this.client.post(`orders/${orderId}/invoice`, {
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
    return {
      marketplaceOrderId: order.orderId,
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
          marketplaceItemId: order.orderId,
          productName: order.productName,
          optionText: order.options || undefined,
          quantity: order.quantity,
          unitPrice: order.paymentAmount / (order.quantity || 1),
          sku: order.sellerItemCode,
        },
      ],
      orderedAt: new Date(order.orderDate),
      totalAmount: order.paymentAmount,
      rawData: order as unknown as Record<string, unknown>,
    }
  }

  private normalizeClaim(claim: AblyClaim): NormalizedClaim {
    return {
      marketplaceClaimId: claim.claimId,
      marketplaceId: 'ably',
      marketplaceOrderId: claim.orderId,
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
