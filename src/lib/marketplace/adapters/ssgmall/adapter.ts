/**
 * Ssgmall (신세계몰) marketplace adapter implementing MarketplaceAdapter.
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
import { createSsgmallClient } from './client'
import { mapSsgmallStatus, mapSsgmallClaimType, mapSsgmallClaimStatus } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  SsgmallApiResponse,
  SsgmallOrder,
  SsgmallClaim,
  SsgmallProduct,
} from './types'

const SSGMALL_CONFIG: MarketplaceConfig = {
  id: 'ssgmall',
  name: '신세계몰',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['api_key', 'vendor_id'],
}

/** Format a Date as ISO date string (yyyy-MM-dd) for API date params */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export class SsgmallAdapter implements MarketplaceAdapter {
  readonly config = SSGMALL_CONFIG

  private readonly client: ReturnType<typeof createSsgmallClient>
  private readonly vendorId: string

  constructor(credentials: { api_key: string; vendor_id: string }) {
    this.client = createSsgmallClient(credentials.api_key)
    this.vendorId = credentials.vendor_id
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      // Keep credential checks away from order endpoints. Some marketplaces
      // mutate order state during "new order" reads.
      const response = await this.client.get('products', {
        searchParams: {
          vendorId: this.vendorId,
          pageSize: '1',
        },
      }).json<SsgmallApiResponse<SsgmallProduct[]>>()

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
          vendorId: this.vendorId,
          dateFrom: formatDate(since),
          dateTo: formatDate(until),
          pageSize: '50',
        },
      }).json<SsgmallApiResponse<SsgmallOrder[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ssgmall', 400, response.message || 'Failed to fetch orders')
      }

      const orders = response.data || []
      return orders.map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ssgmall', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ssgmall', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const now = new Date()

    try {
      const response = await this.client.get('claims', {
        searchParams: {
          vendorId: this.vendorId,
          dateFrom: formatDate(since),
          dateTo: formatDate(now),
          pageSize: '50',
        },
      }).json<SsgmallApiResponse<SsgmallClaim[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ssgmall', 400, response.message || 'Failed to fetch claims')
      }

      const claims = response.data || []
      return claims.map((claim) => this.normalizeClaim(claim))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ssgmall', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ssgmall', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const carrierCode = mapCarrierCode('ssgmall', invoice.carrierId)

      const response = await this.client.post(`orders/${orderId}/invoice`, {
        json: {
          vendorId: this.vendorId,
          carrierCode,
          trackingNumber: invoice.trackingNumber,
        },
      }).json<SsgmallApiResponse<null>>()

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
          vendorId: this.vendorId,
          pageSize: '50',
        },
      }).json<SsgmallApiResponse<SsgmallProduct[]>>()

      if (!response.success) {
        throw new MarketplaceApiError('ssgmall', 400, response.message || 'Failed to fetch products')
      }

      const products = response.data || []
      return products.map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ssgmall', 'API key authentication failed')
      }
      throw new MarketplaceApiError('ssgmall', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('products', {
        json: {
          vendorId: this.vendorId,
          name: product.name,
          price: product.price,
          sku: product.sku,
          description: product.description,
        },
      }).json<SsgmallApiResponse<{ productId: string }>>()

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
          vendorId: this.vendorId,
          ...(product.name != null && { name: product.name }),
          ...(product.price != null && { price: product.price }),
          ...(product.description != null && { description: product.description }),
        },
      }).json<SsgmallApiResponse<null>>()

      if (response.success) {
        return { success: true }
      }
      return { success: false, error: response.message || 'Product update failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: SsgmallOrder): NormalizedOrder {
    return {
      marketplaceOrderId: order.orderId,
      marketplaceId: 'ssgmall',
      marketplaceStatus: order.orderStatus,
      status: mapSsgmallStatus(order.orderStatus),
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

  private normalizeClaim(claim: SsgmallClaim): NormalizedClaim {
    return {
      marketplaceClaimId: claim.claimId,
      marketplaceId: 'ssgmall',
      marketplaceOrderId: claim.orderId,
      claimType: mapSsgmallClaimType(claim.claimType),
      claimStatus: mapSsgmallClaimStatus(claim.claimStatus),
      reason: claim.reason || undefined,
      requestedAt: new Date(claim.createdAt),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: SsgmallProduct): NormalizedProduct {
    return {
      productId: product.productId,
      marketplaceId: 'ssgmall',
      name: product.name,
      price: product.price,
      sku: product.productId,
      status: product.status,
    }
  }
}
