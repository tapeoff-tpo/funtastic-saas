/**
 * ESM Trading API marketplace adapter implementing MarketplaceAdapter.
 *
 * A single adapter class that serves both Gmarket and Auction via the
 * unified ESM Trading API at etapi.ebaykorea.com. Instances are
 * differentiated by site_type: 'G' (Gmarket) or 'A' (Auction).
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
import { createEsmClient } from './client'
import { mapEsmStatus, mapEsmClaimStatus, mapEsmClaimType } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  EsmSiteType,
  EsmApiResponse,
  EsmOrder,
  EsmClaim,
  EsmProduct,
} from './types'

function buildEsmConfig(siteType: EsmSiteType): MarketplaceConfig {
  if (siteType === 'G') {
    return {
      id: 'gmarket',
      name: '지마켓',
      authType: 'api_key',
      rateLimitPerSecond: 30,
      requiredCredentials: ['api_key'],
    }
  }
  return {
    id: 'auction',
    name: '옥션',
    authType: 'api_key',
    rateLimitPerSecond: 30,
    requiredCredentials: ['api_key'],
  }
}

export class EsmAdapter implements MarketplaceAdapter {
  readonly config: MarketplaceConfig

  private readonly client: ReturnType<typeof createEsmClient>
  private readonly siteType: EsmSiteType

  constructor(credentials: { api_key: string; site_type: EsmSiteType }) {
    this.siteType = credentials.site_type
    this.config = buildEsmConfig(this.siteType)
    this.client = createEsmClient(credentials.api_key)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      // Lightweight call to verify API key
      await this.client.get('api/v1/orders', {
        searchParams: {
          siteType: this.siteType,
          dateFrom: new Date().toISOString(),
          dateTo: new Date().toISOString(),
          pageSize: 1,
        },
      }).json()

      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // API key auth has no separate authentication flow
    return { success: true }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    const now = new Date()

    try {
      const response = await this.client.get('api/v1/orders', {
        searchParams: {
          siteType: this.siteType,
          dateFrom: since.toISOString(),
          dateTo: now.toISOString(),
          pageSize: 100,
        },
      }).json<EsmApiResponse<EsmOrder[]>>()

      if (response.resultCode !== '0' && response.resultCode !== 'OK') {
        throw new MarketplaceApiError(this.config.id, 500, response.resultMessage)
      }

      return (response.data || []).map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError(this.config.id, 'API key authentication failed')
      }
      throw new MarketplaceApiError(this.config.id, 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const now = new Date()

    try {
      const response = await this.client.get('api/v1/claims', {
        searchParams: {
          siteType: this.siteType,
          dateFrom: since.toISOString(),
          dateTo: now.toISOString(),
          pageSize: 100,
        },
      }).json<EsmApiResponse<EsmClaim[]>>()

      if (response.resultCode !== '0' && response.resultCode !== 'OK') {
        throw new MarketplaceApiError(this.config.id, 500, response.resultMessage)
      }

      return (response.data || []).map((claim) => this.normalizeClaim(claim))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError(this.config.id, 'API key authentication failed')
      }
      throw new MarketplaceApiError(this.config.id, 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.post(`api/v1/orders/${orderId}/delivery`, {
        json: {
          orderNo: orderId,
          orderItemSeq: invoice.orderItemSeq || '1',
          deliveryCompanyCode: mapCarrierCode(this.config.id, invoice.carrierId),
          invoiceNo: invoice.trackingNumber,
        },
      }).json<EsmApiResponse<null>>()

      if (response.resultCode === '0' || response.resultCode === 'OK') {
        return { success: true }
      }

      return { success: false, error: response.resultMessage || `Upload failed with code: ${response.resultCode}` }
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
        searchParams: {
          siteType: this.siteType,
          pageSize: 100,
        },
      }).json<EsmApiResponse<EsmProduct[]>>()

      if (response.resultCode !== '0' && response.resultCode !== 'OK') {
        throw new MarketplaceApiError(this.config.id, 500, response.resultMessage)
      }

      return (response.data || []).map((product) => this.normalizeProduct(product))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError(this.config.id, 'API key authentication failed')
      }
      throw new MarketplaceApiError(this.config.id, 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('api/v1/products', {
        json: {
          siteType: this.siteType,
          itemName: product.name,
          sellPrice: product.price,
          description: product.description || '',
          categoryCode: product.marketplaceCategoryId ?? product.categoryId,
          sellerItemCode: product.sku,
        },
      }).json<EsmApiResponse<{ itemNo: string }>>()

      if (response.resultCode === '0' || response.resultCode === 'OK') {
        return {
          success: true,
          marketplaceProductId: response.data?.itemNo,
        }
      }

      return { success: false, error: response.resultMessage || 'Registration failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.put(`api/v1/products/${marketplaceProductId}`, {
        json: {
          siteType: this.siteType,
          itemName: product.name,
          sellPrice: product.price,
          description: product.description || '',
          categoryCode: product.marketplaceCategoryId ?? product.categoryId,
        },
      }).json<EsmApiResponse<null>>()

      if (response.resultCode === '0' || response.resultCode === 'OK') {
        return { success: true }
      }

      return { success: false, error: response.resultMessage || 'Update failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private normalizeOrder(order: EsmOrder): NormalizedOrder {
    return {
      marketplaceOrderId: order.orderNo,
      marketplaceId: this.config.id,
      marketplaceStatus: order.orderStatus,
      status: mapEsmStatus(order.orderStatus),
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
          marketplaceItemId: order.orderItemSeq,
          productName: order.itemName,
          optionText: order.optionInfo || undefined,
          quantity: order.orderQty,
          unitPrice: order.sellPrice,
          sku: order.sellerItemCode || undefined,
        },
      ],
      orderedAt: new Date(order.orderDate),
      totalAmount: order.payAmount,
      rawData: order as unknown as Record<string, unknown>,
    }
  }

  private normalizeClaim(claim: EsmClaim): NormalizedClaim {
    return {
      marketplaceClaimId: claim.claimNo,
      marketplaceId: this.config.id,
      marketplaceOrderId: claim.orderNo,
      claimType: mapEsmClaimType(claim.claimType),
      claimStatus: mapEsmClaimStatus(claim.claimStatus),
      reason: claim.claimReason || undefined,
      requestedAt: new Date(claim.claimDate),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }

  private normalizeProduct(product: EsmProduct): NormalizedProduct {
    const images: { url: string; sortOrder: number }[] = []
    if (product.imageUrl) {
      images.push({ url: product.imageUrl, sortOrder: 0 })
    }

    const variants = (product.options || []).map((opt) => ({
      sku: opt.sellerItemCode || '',
      optionName: `${opt.optionName}: ${opt.optionValue}`,
      optionValues: { [opt.optionName]: opt.optionValue },
      price: opt.optionPrice,
      isActive: opt.stockQty > 0,
    }))

    return {
      productId: product.itemNo,
      marketplaceId: this.config.id,
      name: product.itemName,
      description: undefined,
      price: product.sellPrice,
      sku: product.sellerItemCode || product.itemNo,
      images,
      categoryId: product.categoryCode || undefined,
      categoryName: product.categoryName || undefined,
      variants,
      status: product.itemStatus,
      rawData: product as unknown as Record<string, unknown>,
    }
  }
}
