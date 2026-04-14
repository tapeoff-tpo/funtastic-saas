/**
 * Cafe24 marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses OAuth2 Bearer token authentication with a well-documented
 * REST JSON API. Each mall has its own subdomain.
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
import { createCafe24Client } from './client'
import { mapCafe24Status, mapCafe24ClaimStatus, mapCafe24ClaimType } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  Cafe24Order,
  Cafe24OrderResponse,
  Cafe24Claim,
  Cafe24ClaimResponse,
  Cafe24Product,
  Cafe24ProductResponse,
} from './types'

const CAFE24_CONFIG: MarketplaceConfig = {
  id: 'cafe24',
  name: 'Cafe24',
  authType: 'oauth2',
  rateLimitPerSecond: 40,
  requiredCredentials: ['client_id', 'client_secret', 'mall_id', 'access_token'],
}

/** Format a Date as ISO date string (yyyy-MM-dd) for Cafe24 API */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export class Cafe24Adapter implements MarketplaceAdapter {
  readonly config = CAFE24_CONFIG

  private readonly client: ReturnType<typeof createCafe24Client>

  constructor(credentials: { access_token: string; mall_id: string }) {
    this.client = createCafe24Client(credentials.access_token, credentials.mall_id)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      await this.client.get('admin/store').json()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // OAuth2 token is provided at construction time.
    // Token refresh is handled externally via client_id/client_secret.
    return { success: true }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    try {
      const response = await this.client.get('admin/orders', {
        searchParams: {
          shop_no: 1,
          start_date: formatDate(since),
          end_date: formatDate(new Date()),
          limit: 100,
        },
      }).json<Cafe24OrderResponse>()

      return (response.orders ?? []).map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('cafe24', 'OAuth2 token authentication failed', true)
      }
      throw new MarketplaceApiError('cafe24', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const claims: NormalizedClaim[] = []
    const params = {
      start_date: formatDate(since),
      end_date: formatDate(new Date()),
      limit: 100,
    }

    try {
      // Cafe24 has separate endpoints for each claim type
      const [cancellations, returns, exchanges] = await Promise.all([
        this.client.get('admin/cancellation', { searchParams: params }).json<Cafe24ClaimResponse>(),
        this.client.get('admin/return', { searchParams: params }).json<Cafe24ClaimResponse>(),
        this.client.get('admin/exchange', { searchParams: params }).json<Cafe24ClaimResponse>(),
      ])

      for (const claim of cancellations.cancellations ?? []) {
        claims.push(this.normalizeClaim(claim, 'cancellation'))
      }
      for (const claim of returns.returns ?? []) {
        claims.push(this.normalizeClaim(claim, 'return'))
      }
      for (const claim of exchanges.exchanges ?? []) {
        claims.push(this.normalizeClaim(claim, 'exchange'))
      }

      return claims
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('cafe24', 'OAuth2 token authentication failed', true)
      }
      throw new MarketplaceApiError('cafe24', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const carrierCode = mapCarrierCode('cafe24', invoice.carrierId)

      await this.client.put(`admin/orders/${orderId}/shipments.json`, {
        json: {
          shipment: {
            tracking_no: invoice.trackingNumber,
            shipping_company_code: carrierCode,
          },
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
      const response = await this.client.get('admin/products', {
        searchParams: { shop_no: 1, limit: 100 },
      }).json<Cafe24ProductResponse>()

      return (response.products ?? []).map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('cafe24', 'OAuth2 token authentication failed', true)
      }
      throw new MarketplaceApiError('cafe24', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('admin/products', {
        json: {
          product: {
            product_name: product.name,
            selling_price: product.price,
            product_code: product.sku,
          },
        },
      }).json<{ product: { product_no: string } }>()

      return {
        success: true,
        marketplaceProductId: response.product.product_no,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    try {
      const body: Record<string, unknown> = {}
      if (product.name) body.product_name = product.name
      if (product.price != null) body.selling_price = product.price

      await this.client.put(`admin/products/${marketplaceProductId}.json`, {
        json: { product: body },
      }).json()

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: Cafe24Order): NormalizedOrder {
    const items = (order.items ?? []).map((item) => ({
      marketplaceItemId: item.item_no,
      productName: item.product_name,
      optionText: item.option_value || undefined,
      quantity: item.quantity,
      unitPrice: item.product_price,
      sku: item.sku || undefined,
    }))

    return {
      marketplaceOrderId: order.order_id,
      marketplaceId: 'cafe24',
      marketplaceStatus: order.order_status,
      status: mapCafe24Status(order.order_status),
      buyerName: order.buyer_name,
      buyerPhone: order.buyer_cellphone || undefined,
      recipientName: order.receiver_name,
      recipientPhone: order.receiver_cellphone || undefined,
      shippingAddress: {
        zipCode: order.receiver_zipcode,
        address1: order.receiver_address1,
        address2: order.receiver_address2 || undefined,
      },
      items,
      orderedAt: new Date(order.order_date),
      totalAmount: order.total_amount,
      rawData: order as unknown as Record<string, unknown>,
    }
  }

  private normalizeClaim(claim: Cafe24Claim, claimType: string): NormalizedClaim {
    return {
      marketplaceClaimId: claim.claim_id,
      marketplaceId: 'cafe24',
      marketplaceOrderId: claim.order_id,
      claimType: mapCafe24ClaimType(claimType),
      claimStatus: mapCafe24ClaimStatus(claim.claim_status),
      reason: claim.claim_reason || undefined,
      requestedAt: new Date(claim.claim_date),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: Cafe24Product): NormalizedProduct {
    return {
      productId: product.product_no,
      marketplaceId: 'cafe24',
      name: product.product_name,
      price: product.selling_price,
      sku: product.product_code,
      images: product.detail_image
        ? [{ url: product.detail_image, sortOrder: 0 }]
        : [],
      status: product.display,
    }
  }
}
