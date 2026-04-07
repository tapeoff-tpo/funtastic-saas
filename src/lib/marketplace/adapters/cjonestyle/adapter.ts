/**
 * CJ온스타일 marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses API key authentication with a JSON REST API.
 * Endpoints are best-effort based on available documentation (per D-03).
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
import { createCjOnestyleClient } from './client'
import { mapCjOnestyleStatus, mapCjOnestyleClaimStatus, mapCjOnestyleClaimType } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  CjOnestyleOrder,
  CjOnestyleOrderResponse,
  CjOnestyleClaimResponse,
  CjOnestyleProduct,
  CjOnestyleProductResponse,
} from './types'

const CJONESTYLE_CONFIG: MarketplaceConfig = {
  id: 'cjonestyle',
  name: 'CJ온스타일',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['api_key', 'seller_code'],
}

/** Format a Date as ISO date string for CJ온스타일 API */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export class CjOnestyleAdapter implements MarketplaceAdapter {
  readonly config = CJONESTYLE_CONFIG

  private readonly client: ReturnType<typeof createCjOnestyleClient>

  constructor(credentials: { api_key: string; seller_code: string }) {
    this.client = createCjOnestyleClient(credentials.api_key)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      await this.client.get('seller/info').json()
      return { success: true }
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
    try {
      const response = await this.client.get('orders', {
        searchParams: {
          start_date: formatDate(since),
          end_date: formatDate(new Date()),
          limit: 100,
        },
      }).json<CjOnestyleOrderResponse>()

      return (response.orders ?? []).map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('cjonestyle', 'API key authentication failed')
      }
      throw new MarketplaceApiError('cjonestyle', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    try {
      const response = await this.client.get('claims', {
        searchParams: {
          start_date: formatDate(since),
          end_date: formatDate(new Date()),
          limit: 100,
        },
      }).json<CjOnestyleClaimResponse>()

      return (response.claims ?? []).map((claim) => ({
        marketplaceClaimId: claim.claim_id,
        marketplaceId: 'cjonestyle' as const,
        marketplaceOrderId: claim.order_id,
        claimType: mapCjOnestyleClaimType(claim.claim_type),
        claimStatus: mapCjOnestyleClaimStatus(claim.claim_status),
        reason: claim.claim_reason || undefined,
        requestedAt: new Date(claim.claim_date),
        rawData: claim as unknown as Record<string, unknown>,
      }))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('cjonestyle', 'API key authentication failed')
      }
      throw new MarketplaceApiError('cjonestyle', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const carrierCode = mapCarrierCode('cjonestyle', invoice.carrierId)

      await this.client.post(`orders/${orderId}/invoice`, {
        json: {
          tracking_number: invoice.trackingNumber,
          carrier_code: carrierCode,
        },
      }).json()

      return { success: true }
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
        searchParams: { limit: 100 },
      }).json<CjOnestyleProductResponse>()

      return (response.products ?? []).map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('cjonestyle', 'API key authentication failed')
      }
      throw new MarketplaceApiError('cjonestyle', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('products', {
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

      await this.client.put(`products/${marketplaceProductId}`, {
        json: body,
      }).json()

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: CjOnestyleOrder): NormalizedOrder {
    const items = (order.items ?? []).map((item) => ({
      marketplaceItemId: item.item_id,
      productName: item.product_name,
      optionText: item.option_name || undefined,
      quantity: item.quantity,
      unitPrice: item.price,
      sku: item.sku || undefined,
    }))

    return {
      marketplaceOrderId: order.order_id,
      marketplaceId: 'cjonestyle',
      marketplaceStatus: order.order_status,
      status: mapCjOnestyleStatus(order.order_status),
      buyerName: order.buyer_name,
      buyerPhone: order.buyer_phone || undefined,
      recipientName: order.receiver_name,
      recipientPhone: order.receiver_phone || undefined,
      shippingAddress: {
        zipCode: order.receiver_zipcode,
        address1: order.receiver_address,
        address2: order.receiver_address_detail || undefined,
      },
      items,
      orderedAt: new Date(order.order_date),
      totalAmount: order.total_amount,
      rawData: order as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: CjOnestyleProduct): NormalizedProduct {
    return {
      productId: product.product_id,
      marketplaceId: 'cjonestyle',
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
