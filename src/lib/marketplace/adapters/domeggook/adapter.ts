/**
 * Domeggook (도매꾹) marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses API key authentication with OpenAPI supporting both XML and JSON.
 * XML responses are parsed with fast-xml-parser (per D-05).
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
import { createDomeggookClient } from './client'
import { mapDomeggookStatus, mapDomeggookClaimType, mapDomeggookClaimStatus } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  DomeggookApiResponse,
  DomeggookOrder,
  DomeggookClaim,
  DomeggookProduct,
} from './types'

const DOMEGGOOK_CONFIG: MarketplaceConfig = {
  id: 'domeggook',
  name: '도매꾹',
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

export class DomeggookAdapter implements MarketplaceAdapter {
  readonly config = DOMEGGOOK_CONFIG

  private readonly client: ReturnType<typeof createDomeggookClient>
  private readonly sellerId: string

  constructor(credentials: { api_key: string; seller_id: string }) {
    this.client = createDomeggookClient(credentials.api_key)
    this.sellerId = credentials.seller_id
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      // Keep credential checks away from order endpoints. Some marketplaces
      // mutate order state during "new order" reads.
      const response = await this.client.get('products', {
        searchParams: {
          sellerId: this.sellerId,
          pageSize: '1',
        },
      }).json<DomeggookApiResponse<DomeggookProduct[]>>()

      if (response.result === 'success') {
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
      }).json<DomeggookApiResponse<DomeggookOrder[]>>()

      if (response.result !== 'success') {
        throw new MarketplaceApiError('domeggook', 400, response.message || 'Failed to fetch orders')
      }

      const orders = response.data || []
      return orders.map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('domeggook', 'API key authentication failed')
      }
      throw new MarketplaceApiError('domeggook', 500, error instanceof Error ? error.message : 'Unknown error')
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
      }).json<DomeggookApiResponse<DomeggookClaim[]>>()

      if (response.result !== 'success') {
        throw new MarketplaceApiError('domeggook', 400, response.message || 'Failed to fetch claims')
      }

      const claims = response.data || []
      return claims.map((claim) => this.normalizeClaim(claim))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('domeggook', 'API key authentication failed')
      }
      throw new MarketplaceApiError('domeggook', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const carrierCode = mapCarrierCode('domeggook', invoice.carrierId)

      const response = await this.client.post(`orders/${orderId}/invoice`, {
        json: {
          sellerId: this.sellerId,
          carrierCode,
          trackingNumber: invoice.trackingNumber,
        },
      }).json<DomeggookApiResponse<null>>()

      if (response.result === 'success') {
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
      }).json<DomeggookApiResponse<DomeggookProduct[]>>()

      if (response.result !== 'success') {
        throw new MarketplaceApiError('domeggook', 400, response.message || 'Failed to fetch products')
      }

      const products = response.data || []
      return products.map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('domeggook', 'API key authentication failed')
      }
      throw new MarketplaceApiError('domeggook', 500, error instanceof Error ? error.message : 'Unknown error')
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
      }).json<DomeggookApiResponse<{ productId: string }>>()

      if (response.result === 'success') {
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
      }).json<DomeggookApiResponse<null>>()

      if (response.result === 'success') {
        return { success: true }
      }
      return { success: false, error: response.message || 'Product update failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: DomeggookOrder): NormalizedOrder {
    return {
      marketplaceOrderId: order.orderId,
      marketplaceId: 'domeggook',
      marketplaceStatus: order.orderStatus,
      status: mapDomeggookStatus(order.orderStatus),
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

  private normalizeClaim(claim: DomeggookClaim): NormalizedClaim {
    return {
      marketplaceClaimId: claim.claimId,
      marketplaceId: 'domeggook',
      marketplaceOrderId: claim.orderId,
      claimType: mapDomeggookClaimType(claim.claimType),
      claimStatus: mapDomeggookClaimStatus(claim.claimStatus),
      reason: claim.reason || undefined,
      requestedAt: new Date(claim.createdAt),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: DomeggookProduct): NormalizedProduct {
    return {
      productId: product.productId,
      marketplaceId: 'domeggook',
      name: product.name,
      price: product.price,
      sku: product.productId,
      status: product.status,
    }
  }
}
