/**
 * 11st (11번가) marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses API key authentication and XML response parsing to fetch orders
 * and claims from the 11st Open API, normalizing results to shared interfaces.
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
import { createElevenstClient, parseXmlResponse } from './client'
import { mapElevenstStatus, mapElevenstClaimStatus, mapElevenstClaimType } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  ElevenstOrder,
  ElevenstOrderResponse,
  ElevenstClaim,
  ElevenstClaimResponse,
  ElevenstProduct,
  ElevenstProductResponse,
} from './types'

const ELEVENST_CONFIG: MarketplaceConfig = {
  id: 'elevenst',
  name: '11번가',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['api_key'],
}

/**
 * Ensure a parsed XML field is always an array.
 * XML parsers return a single object when there's one element,
 * and an array when there are multiple.
 */
function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/** Format a Date as yyyy-MM-dd for 11st API date params */
function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export class ElevenstAdapter implements MarketplaceAdapter {
  readonly config = ELEVENST_CONFIG

  private readonly client: ReturnType<typeof createElevenstClient>

  constructor(credentials: { api_key: string }) {
    this.client = createElevenstClient(credentials.api_key)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      // Make a lightweight call to verify the API key is valid
      const now = new Date()
      const response = await this.client.get('openapi/v3/orders', {
        searchParams: {
          dateFrom: formatDate(now),
          dateTo: formatDate(now),
          pageSize: 1,
        },
      }).text()

      // If we get an XML response (even empty), the key is valid
      parseXmlResponse(response)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // API key auth has no separate authentication flow.
    // Each request includes the key via the openapikey header.
    return { success: true }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    const now = new Date()

    try {
      const response = await this.client.get('openapi/v3/orders', {
        searchParams: {
          dateFrom: formatDate(since),
          dateTo: formatDate(now),
          pageSize: 50,
        },
      }).text()

      const parsed = parseXmlResponse<ElevenstOrderResponse>(response)
      const orders = ensureArray(parsed.orders?.order)

      return orders.map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('elevenst', 'API key authentication failed')
      }
      throw new MarketplaceApiError('elevenst', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const now = new Date()

    try {
      const response = await this.client.get('openapi/v3/claims', {
        searchParams: {
          dateFrom: formatDate(since),
          dateTo: formatDate(now),
          pageSize: 50,
        },
      }).text()

      const parsed = parseXmlResponse<ElevenstClaimResponse>(response)
      const claims = ensureArray(parsed.claims?.claim)

      return claims.map((claim) => this.normalizeClaim(claim))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('elevenst', 'API key authentication failed')
      }
      throw new MarketplaceApiError('elevenst', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const carrierCode = mapCarrierCode('elevenst', invoice.carrierId)
      const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<deliveryInfo>
  <ordNo>${orderId}</ordNo>
  <ordPrdSeq>1</ordPrdSeq>
  <dlvMthdCd>01</dlvMthdCd>
  <dlvCpnyCd>${carrierCode}</dlvCpnyCd>
  <invoiceNo>${invoice.trackingNumber}</invoiceNo>
</deliveryInfo>`

      const response = await this.client.post(`openapi/v3/orders/${orderId}/delivery`, {
        body: xmlBody,
      }).text()

      const parsed = parseXmlResponse<{ result?: { resultCode?: string; resultMessage?: string } }>(response)

      if (parsed.result?.resultCode === '200' || parsed.result?.resultCode === '0') {
        return { success: true }
      }

      return { success: false, error: parsed.result?.resultMessage || `Upload failed with code: ${parsed.result?.resultCode}` }
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
      const response = await this.client.get('openapi/v3/products', {
        searchParams: { pageSize: 50 },
      }).text()

      const parsed = parseXmlResponse<ElevenstProductResponse>(response)
      const products = ensureArray(parsed.products?.product)

      return products.map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('elevenst', 'API key authentication failed')
      }
      throw new MarketplaceApiError('elevenst', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<product>
  <prdNm>${product.name}</prdNm>
  <selPrice>${product.price}</selPrice>
</product>`

      const response = await this.client.post('openapi/v3/products', {
        body: xmlBody,
      }).text()

      const parsed = parseXmlResponse<{ result?: { resultCode?: string; resultMessage?: string; prdNo?: string } }>(response)

      if (parsed.result?.resultCode === '200' || parsed.result?.resultCode === '0') {
        return {
          success: true,
          marketplaceProductId: parsed.result.prdNo,
        }
      }

      return { success: false, error: parsed.result?.resultMessage || `Registration failed with code: ${parsed.result?.resultCode}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    try {
      const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<product>
  <prdNo>${marketplaceProductId}</prdNo>
  ${product.name ? `<prdNm>${product.name}</prdNm>` : ''}
  ${product.price != null ? `<selPrice>${product.price}</selPrice>` : ''}
</product>`

      const response = await this.client.put(`openapi/v3/products/${marketplaceProductId}`, {
        body: xmlBody,
      }).text()

      const parsed = parseXmlResponse<{ result?: { resultCode?: string; resultMessage?: string } }>(response)

      if (parsed.result?.resultCode === '200' || parsed.result?.resultCode === '0') {
        return { success: true }
      }

      return { success: false, error: parsed.result?.resultMessage || `Update failed with code: ${parsed.result?.resultCode}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: ElevenstOrder): NormalizedOrder {
    return {
      marketplaceOrderId: order.ordNo,
      marketplaceId: 'elevenst',
      marketplaceStatus: order.ordStCd,
      status: mapElevenstStatus(order.ordStCd),
      buyerName: order.buyerNm,
      buyerPhone: order.buyerPhone || undefined,
      recipientName: order.rcvrNm,
      recipientPhone: order.rcvrPhone || undefined,
      shippingAddress: {
        zipCode: order.rcvrZipCd,
        address1: order.rcvrBaseAddr,
        address2: order.rcvrDtlAddr || undefined,
      },
      items: [
        {
          marketplaceItemId: order.ordPrdSeq,
          productName: order.prdNm,
          optionText: order.optNm || undefined,
          quantity: Number(order.ordQty) || 1,
          unitPrice: Number(order.selPrice) || 0,
        },
      ],
      orderedAt: new Date(order.ordDt),
      totalAmount: (Number(order.ordQty) || 1) * (Number(order.selPrice) || 0),
      rawData: order as unknown as Record<string, unknown>,
    }
  }

  private normalizeClaim(claim: ElevenstClaim): NormalizedClaim {
    return {
      marketplaceClaimId: claim.clmNo,
      marketplaceId: 'elevenst',
      marketplaceOrderId: claim.ordNo,
      claimType: mapElevenstClaimType(claim.clmTypCd),
      claimStatus: mapElevenstClaimStatus(claim.clmStCd),
      reason: claim.clmRsnCont || undefined,
      requestedAt: new Date(claim.clmDt),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: ElevenstProduct): NormalizedProduct {
    return {
      productId: product.prdNo,
      marketplaceId: 'elevenst',
      name: product.prdNm,
      price: Number(product.selPrice) || 0,
      sku: product.prdNo, // 11st uses product number as identifier
      images: product.prdImage01
        ? [{ url: product.prdImage01, sortOrder: 0 }]
        : [],
      status: product.prdStatCd,
    }
  }
}
