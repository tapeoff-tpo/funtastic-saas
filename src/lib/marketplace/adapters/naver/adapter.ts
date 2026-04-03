/**
 * Naver SmartStore marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses OAuth2 token management to fetch orders and claims from the
 * Naver Commerce API, normalizing results to shared interfaces.
 *
 * Order collection uses the two-step pattern (Research Pattern 6):
 * 1. GET lastChangedStatuses to find changed product order IDs
 * 2. POST product-orders/query to fetch full details in batch
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
import { createNaverClient } from './client'
import { mapNaverStatus, mapNaverClaimStatus, NAVER_CLAIM_TYPE_MAP } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type { NaverLastChangedStatusesResponse, NaverProductOrderDetailResponse, NaverProductOrder } from './types'

const NAVER_CONFIG: MarketplaceConfig = {
  id: 'naver',
  name: '네이버 스마트스토어',
  authType: 'oauth2',
  rateLimitPerSecond: 50,
  requiredCredentials: ['client_id', 'client_secret'],
}

/** Order-related lastChangedType values */
const ORDER_CHANGED_TYPES = 'PAYED,DELIVERED,PURCHASE_DECIDED,DELIVERING'

/** Claim-related lastChangedType values */
const CLAIM_CHANGED_TYPES = 'CANCEL,RETURN,EXCHANGE'

export class NaverAdapter implements MarketplaceAdapter {
  readonly config = NAVER_CONFIG

  private readonly naverClient: ReturnType<typeof createNaverClient>

  constructor(credentials: { client_id: string; client_secret: string }) {
    this.naverClient = createNaverClient(credentials.client_id, credentials.client_secret)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      const token = await this.naverClient.getToken()
      if (!token) {
        return { success: false, error: 'Failed to obtain access token' }
      }
      const state = this.naverClient.getState()
      return {
        success: true,
        expiresAt: state.tokenExpiresAt ? new Date(state.tokenExpiresAt) : undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    try {
      await this.naverClient.getToken()
      const state = this.naverClient.getState()
      return {
        success: true,
        expiresAt: state.tokenExpiresAt ? new Date(state.tokenExpiresAt) : undefined,
      }
    } catch (error) {
      if (error instanceof MarketplaceAuthError) throw error
      throw new MarketplaceAuthError('naver', error instanceof Error ? error.message : 'Authentication failed')
    }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    try {
      // Step 1: Get changed product order IDs
      const changedIds = await this.fetchChangedIds(since, ORDER_CHANGED_TYPES)
      if (changedIds.length === 0) return []

      // Step 2: Fetch full product order details
      const productOrders = await this.fetchProductOrderDetails(changedIds)

      // Step 3: Normalize to NormalizedOrder[]
      return productOrders.map((po) => this.normalizeOrder(po))
    } catch (error) {
      if (error instanceof MarketplaceApiError || error instanceof MarketplaceAuthError) throw error
      throw new MarketplaceApiError('naver', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    try {
      // Step 1: Get changed claim IDs
      const changedIds = await this.fetchChangedIds(since, CLAIM_CHANGED_TYPES)
      if (changedIds.length === 0) return []

      // Step 2: Fetch full product order details
      const productOrders = await this.fetchProductOrderDetails(changedIds)

      // Step 3: Normalize to NormalizedClaim[]
      return productOrders.map((po) => this.normalizeClaim(po))
    } catch (error) {
      if (error instanceof MarketplaceApiError || error instanceof MarketplaceAuthError) throw error
      throw new MarketplaceApiError('naver', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      // Step 1: Place-order confirmation if required
      if (invoice.requiresConfirmation) {
        const confirmResponse = await this.naverClient.client.post(
          'external/v1/pay-order/seller/product-orders/place-order',
          { json: { productOrderIds: [orderId] } },
        ).json<{
          data: { successProductOrderIds: string[]; failProductOrderIds: string[] }
        }>()

        if (confirmResponse.data.failProductOrderIds?.includes(orderId)) {
          return { success: false, error: `Place-order confirmation failed for ${orderId}` }
        }
      }

      // Step 2: Dispatch with tracking info
      const dispatchResponse = await this.naverClient.client.post(
        'external/v1/pay-order/seller/product-orders/dispatch',
        {
          json: {
            dispatchProductOrders: [
              {
                productOrderId: orderId,
                deliveryMethod: 'DELIVERY',
                deliveryCompanyCode: mapCarrierCode('naver', invoice.carrierId),
                trackingNumber: invoice.trackingNumber,
                dispatchDate: new Date().toISOString(),
              },
            ],
          },
        },
      ).json<{
        data: { successProductOrderIds: string[]; failProductOrderIds: string[] }
      }>()

      if (dispatchResponse.data.failProductOrderIds?.includes(orderId)) {
        return { success: false, error: `Dispatch failed for ${orderId}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    throw new Error('getProducts: Not implemented (Phase 5)')
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const payload = this.buildNaverProductPayload(product)

      const response = await this.naverClient.client.post(
        'external/v2/products',
        { json: payload },
      ).json<{
        code: string
        message: string
        data?: { smartstoreChannelProductNo: number; originProductNo: number }
      }>()

      if (response.data?.originProductNo) {
        return {
          success: true,
          marketplaceProductId: String(response.data.originProductNo),
        }
      }

      return { success: false, error: response.message || 'Product registration failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    try {
      const payload = this.buildNaverProductPayload(product as NormalizedProduct)

      const response = await this.naverClient.client.put(
        `external/v2/products/origin-products/${marketplaceProductId}`,
        { json: payload },
      ).json<{ code: string; message: string }>()

      if (response.code === '200' || !response.code) {
        return { success: true }
      }

      return { success: false, error: response.message || 'Product update failed' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Build Naver Commerce API product payload from NormalizedProduct.
   * Maps internal fields to Naver's product registration format.
   */
  private buildNaverProductPayload(product: Partial<NormalizedProduct>) {
    return {
      originProduct: {
        statusType: 'SALE',
        saleType: 'NEW',
        leafCategoryId: product.marketplaceCategoryId ?? product.categoryId,
        name: product.name,
        detailContent: product.description || '',
        images: {
          representativeImage: product.images?.[0]
            ? { url: product.images[0].url }
            : undefined,
          optionalImages: (product.images || []).slice(1).map((img) => ({
            url: img.url,
          })),
        },
        salePrice: product.price ?? 0,
        stockQuantity: 999,
        deliveryInfo: {
          deliveryType: 'DELIVERY',
          deliveryAttributeType: 'NORMAL',
          deliveryFee: {
            deliveryFeeType: 'FREE',
            baseFee: 0,
          },
        },
        detailAttribute: {
          naverShoppingSearchInfo: {
            manufacturerName: '',
            brandName: '',
            modelName: product.name,
          },
          afterServiceInfo: {
            afterServiceTelephoneNumber: '',
            afterServiceGuideContent: '',
          },
          originAreaInfo: {
            originAreaCode: '00',
            content: '상세설명참조',
          },
        },
        ...(product.variants && product.variants.length > 0
          ? {
              optionInfo: {
                optionCombinationGroupNames: {
                  optionGroupName1: product.variants[0]?.optionName || '옵션',
                },
                optionCombinations: product.variants.map((v, idx) => ({
                  optionName1: Object.values(v.optionValues || {})[0] || v.sku,
                  stockQuantity: 999,
                  price: v.price,
                  usable: v.isActive,
                  sellerManagerCode: v.sku,
                  id: idx + 1,
                })),
              },
            }
          : {}),
      },
      smartstoreChannelProduct: {
        channelProductName: product.name,
        storeKeepExclusiveProduct: false,
        naverShoppingRegistration: true,
      },
    }
  }

  /**
   * Fetch changed product order IDs from the lastChangedStatuses endpoint.
   */
  private async fetchChangedIds(since: Date, lastChangedType: string): Promise<string[]> {
    const now = new Date()

    const response = await this.naverClient.client.get('v1/pay-order/seller/product-orders/last-changed-statuses', {
      searchParams: {
        lastChangedFrom: since.toISOString(),
        lastChangedTo: now.toISOString(),
        lastChangedType,
      },
    }).json<NaverLastChangedStatusesResponse>()

    return (response.data?.lastChangeStatuses || []).map((s) => s.productOrderId)
  }

  /**
   * Fetch full product order details by IDs in batch.
   */
  private async fetchProductOrderDetails(productOrderIds: string[]): Promise<NaverProductOrder[]> {
    const response = await this.naverClient.client.post('v1/pay-order/seller/product-orders/query', {
      json: { productOrderIds },
    }).json<NaverProductOrderDetailResponse>()

    return response.data || []
  }

  private normalizeOrder(po: NaverProductOrder): NormalizedOrder {
    return {
      marketplaceOrderId: po.productOrderId,
      marketplaceId: 'naver',
      marketplaceStatus: po.productOrderStatus,
      status: mapNaverStatus(po.productOrderStatus),
      buyerName: po.ordererName,
      buyerPhone: po.ordererTel || undefined,
      recipientName: po.ordererName, // Naver uses orderer as recipient in most cases
      recipientPhone: po.ordererTel || undefined,
      shippingAddress: {
        zipCode: po.shippingAddress.zipCode,
        address1: po.shippingAddress.baseAddress,
        address2: po.shippingAddress.detailedAddress || undefined,
      },
      items: [
        {
          marketplaceItemId: po.productOrderId,
          productName: po.productName,
          optionText: po.optionInfo || undefined,
          quantity: po.quantity,
          unitPrice: po.unitPrice,
        },
      ],
      orderedAt: new Date(po.paymentDate),
      totalAmount: po.totalPaymentAmount,
      rawData: po as unknown as Record<string, unknown>,
    }
  }

  private normalizeClaim(po: NaverProductOrder): NormalizedClaim {
    const claimType = po.claimType
      ? (NAVER_CLAIM_TYPE_MAP[po.claimType] || 'cancel')
      : 'cancel'

    return {
      marketplaceClaimId: po.productOrderId,
      marketplaceId: 'naver',
      marketplaceOrderId: po.orderId,
      claimType,
      claimStatus: po.claimStatus ? mapNaverClaimStatus(po.claimStatus) : 'requested',
      reason: po.claimReason || undefined,
      requestedAt: new Date(po.paymentDate),
      rawData: po as unknown as Record<string, unknown>,
    }
  }
}
