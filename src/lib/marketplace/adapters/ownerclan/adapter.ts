/**
 * Ownerclan (오너클랜) marketplace adapter implementing MarketplaceAdapter.
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
import { createOwnerclanClient } from './client'
import { mapOwnerclanStatus, mapOwnerclanClaimType, mapOwnerclanClaimStatus } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  OwnerclanApiResponse,
  OwnerclanOrder,
  OwnerclanClaim,
  OwnerclanProduct,
} from './types'

const OWNERCLAN_CONFIG: MarketplaceConfig = {
  id: 'ownerclan',
  name: '오너클랜',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'seller_id'],
}

/** Format a Date as ISO date string (yyyy-MM-dd) for API date params */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export class OwnerclanAdapter implements MarketplaceAdapter {
  readonly config = OWNERCLAN_CONFIG

  private readonly client: ReturnType<typeof createOwnerclanClient>
  private readonly sellerId: string

  constructor(credentials: { api_key: string; seller_id: string }) {
    this.client = createOwnerclanClient(credentials.api_key)
    this.sellerId = credentials.seller_id
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      const now = new Date()
      const response = await this.client.get('orders', {
        searchParams: {
          sellerId: this.sellerId,
          dateFrom: formatDate(now),
          dateTo: formatDate(now),
          pageSize: '1',
        },
      }).json<OwnerclanApiResponse<OwnerclanOrder[]>>()

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
          sellerId: this.sellerId,
          dateFrom: formatDate(since),
          dateTo: formatDate(now),
          pageSize: '50',
        },
      }).json<OwnerclanApiResponse<OwnerclanOrder[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ownerclan', 400, response.message || 'Failed to fetch orders')
      }

      const orders = response.data || []
      return orders.map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ownerclan', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ownerclan', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const now = new Date()

    try {
      const response = await this.client.get('claims', {
        searchParams: {
          sellerId: this.sellerId,
          dateFrom: formatDate(since),
          dateTo: formatDate(now),
          pageSize: '50',
        },
      }).json<OwnerclanApiResponse<OwnerclanClaim[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ownerclan', 400, response.message || 'Failed to fetch claims')
      }

      const claims = response.data || []
      return claims.map((claim) => this.normalizeClaim(claim))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ownerclan', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ownerclan', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const carrierCode = mapCarrierCode('ownerclan', invoice.carrierId)

      const response = await this.client.post(`orders/${orderId}/invoice`, {
        json: {
          sellerId: this.sellerId,
          carrierCode,
          trackingNumber: invoice.trackingNumber,
        },
      }).json<OwnerclanApiResponse<null>>()

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
      const response = await this.client.get('products', {
        searchParams: {
          sellerId: this.sellerId,
          pageSize: '50',
        },
      }).json<OwnerclanApiResponse<OwnerclanProduct[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ownerclan', 400, response.message || 'Failed to fetch products')
      }

      const products = response.data || []
      return products.map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ownerclan', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ownerclan', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('products', {
        json: {
          sellerId: this.sellerId,
          name: product.name,
          price: product.price,
          sku: product.sku,
          description: product.description,
        },
      }).json<OwnerclanApiResponse<{ productId: string }>>()

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
          sellerId: this.sellerId,
          ...(product.name != null && { name: product.name }),
          ...(product.price != null && { price: product.price }),
          ...(product.description != null && { description: product.description }),
        },
      }).json<OwnerclanApiResponse<null>>()

      if (response.success) {
        return { success: true }
      }
      return { success: false, error: response.message || 'Product update failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: OwnerclanOrder): NormalizedOrder {
    return {
      marketplaceOrderId: order.orderId,
      marketplaceId: 'ownerclan',
      marketplaceStatus: order.orderStatus,
      status: mapOwnerclanStatus(order.orderStatus),
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

  private normalizeClaim(claim: OwnerclanClaim): NormalizedClaim {
    return {
      marketplaceClaimId: claim.claimId,
      marketplaceId: 'ownerclan',
      marketplaceOrderId: claim.orderId,
      claimType: mapOwnerclanClaimType(claim.claimType),
      claimStatus: mapOwnerclanClaimStatus(claim.claimStatus),
      reason: claim.reason || undefined,
      requestedAt: new Date(claim.createdAt),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: OwnerclanProduct): NormalizedProduct {
    return {
      productId: product.productId,
      marketplaceId: 'ownerclan',
      name: product.name,
      price: product.price,
      sku: product.productId,
      status: product.status,
    }
  }
}
