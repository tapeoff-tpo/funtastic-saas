/**
 * Ohouse (오늘의집) marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses Bearer token authentication and JSON responses to fetch orders
 * and claims from the Ohouse Open API, normalizing results to shared interfaces.
 *
 * NOTE: Ohouse API details are TBD (per D-03). Endpoints are best-effort
 * based on Korean marketplace patterns and will be updated when real API
 * docs become available.
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
import { createOhouseClient } from './client'
import { mapOhouseStatus, mapOhouseClaimType, mapOhouseClaimStatus } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  OhouseApiResponse,
  OhouseOrder,
  OhouseClaim,
  OhouseProduct,
} from './types'

const OHOUSE_CONFIG: MarketplaceConfig = {
  id: 'ohouse',
  name: '오늘의집',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key'],
}

/** Format a Date as ISO date string (yyyy-MM-dd) for Ohouse API date params */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export class OhouseAdapter implements MarketplaceAdapter {
  readonly config = OHOUSE_CONFIG

  private readonly client: ReturnType<typeof createOhouseClient>

  constructor(credentials: { api_key: string }) {
    this.client = createOhouseClient(credentials.api_key)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      const now = new Date()
      const response = await this.client.get('api/v1/orders', {
        searchParams: {
          dateFrom: formatDate(now),
          dateTo: formatDate(now),
          pageSize: '1',
        },
      }).json<OhouseApiResponse<OhouseOrder[]>>()

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
    // API key auth has no separate authentication flow.
    // Each request includes the key via the Authorization header.
    return { success: true }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    const now = new Date()

    try {
      const response = await this.client.get('api/v1/orders', {
        searchParams: {
          dateFrom: formatDate(since),
          dateTo: formatDate(now),
          pageSize: '50',
        },
      }).json<OhouseApiResponse<OhouseOrder[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ohouse', 400, response.message || 'Failed to fetch orders')
      }

      const orders = response.data || []
      return orders.map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ohouse', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ohouse', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const now = new Date()

    try {
      const response = await this.client.get('api/v1/claims', {
        searchParams: {
          dateFrom: formatDate(since),
          dateTo: formatDate(now),
          pageSize: '50',
        },
      }).json<OhouseApiResponse<OhouseClaim[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ohouse', 400, response.message || 'Failed to fetch claims')
      }

      const claims = response.data || []
      return claims.map((claim) => this.normalizeClaim(claim))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ohouse', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ohouse', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const carrierCode = mapCarrierCode('ohouse', invoice.carrierId)

      const response = await this.client.post(`api/v1/orders/${orderId}/invoice`, {
        json: {
          carrierCode,
          trackingNumber: invoice.trackingNumber,
        },
      }).json<OhouseApiResponse<null>>()

      if (response.success) {
        return { success: true }
      }
      return { success: false, error: response.message || 'Invoice upload failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async confirmOrder(
    _marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '발주확인 미구현' }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    try {
      const response = await this.client.get('api/v1/products', {
        searchParams: { pageSize: '50' },
      }).json<OhouseApiResponse<OhouseProduct[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ohouse', 400, response.message || 'Failed to fetch products')
      }

      const products = response.data || []
      return products.map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ohouse', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ohouse', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('api/v1/products', {
        json: {
          name: product.name,
          price: product.price,
          sku: product.sku,
          description: product.description,
        },
      }).json<OhouseApiResponse<{ productId: string }>>()

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
      const response = await this.client.put(`api/v1/products/${marketplaceProductId}`, {
        json: {
          ...(product.name != null && { name: product.name }),
          ...(product.price != null && { price: product.price }),
          ...(product.description != null && { description: product.description }),
        },
      }).json<OhouseApiResponse<null>>()

      if (response.success) {
        return { success: true }
      }
      return { success: false, error: response.message || 'Product update failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: OhouseOrder): NormalizedOrder {
    return {
      marketplaceOrderId: order.orderId,
      marketplaceId: 'ohouse',
      marketplaceStatus: order.orderStatus,
      status: mapOhouseStatus(order.orderStatus),
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

  private normalizeClaim(claim: OhouseClaim): NormalizedClaim {
    return {
      marketplaceClaimId: claim.claimId,
      marketplaceId: 'ohouse',
      marketplaceOrderId: claim.orderId,
      claimType: mapOhouseClaimType(claim.claimType),
      claimStatus: mapOhouseClaimStatus(claim.claimStatus),
      reason: claim.reason || undefined,
      requestedAt: new Date(claim.createdAt),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: OhouseProduct): NormalizedProduct {
    return {
      productId: product.productId,
      marketplaceId: 'ohouse',
      name: product.name,
      price: product.price,
      sku: product.productId, // Use product ID as identifier
      status: product.status,
    }
  }
}
