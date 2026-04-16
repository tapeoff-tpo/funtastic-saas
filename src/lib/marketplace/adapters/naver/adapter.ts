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
import type {
  NaverLastChangedStatusesResponse,
  NaverProductOrderDetailResponse,
  NaverProductOrder,
  NaverChannelProduct,
  NaverProductsResponse,
} from './types'

const NAVER_CONFIG: MarketplaceConfig = {
  id: 'naver',
  name: '네이버 스마트스토어',
  authType: 'oauth2',
  rateLimitPerSecond: 50,
  requiredCredentials: ['client_id', 'client_secret'],
}

/** Order-related lastChangedType values */
const ORDER_CHANGED_TYPES = ['PAYED', 'DELIVERING', 'DELIVERED', 'PURCHASE_DECIDED']

/** Claim-related lastChangedType values */
const CLAIM_CHANGED_TYPES = ['CLAIM_REQUESTED', 'CLAIM_COMPLETED', 'COLLECT_DONE']

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
      const changedIds = await this.fetchChangedIds(since, CLAIM_CHANGED_TYPES)
      if (changedIds.length === 0) return []

      const productOrders = await this.fetchProductOrderDetails(changedIds)
      return productOrders.map((po) => this.normalizeClaim(po))
    } catch (error) {
      if (error instanceof MarketplaceApiError || error instanceof MarketplaceAuthError) throw error
      throw new MarketplaceApiError('naver', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async confirmOrder(
    marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.naverClient.client.post(
        'external/v1/pay-order/seller/product-orders/place-order',
        { json: { productOrderIds: [marketplaceOrderId] } },
      ).json<{
        data: { successProductOrderIds: string[]; failProductOrderIds: string[] }
      }>()

      if (response.data.failProductOrderIds?.includes(marketplaceOrderId)) {
        return { success: false, error: `발주확인 실패: ${marketplaceOrderId}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      // Step 1: Place-order confirmation if not already confirmed
      if (invoice.requiresConfirmation) {
        const confirmResult = await this.confirmOrder(orderId)
        if (!confirmResult.success) {
          return confirmResult
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
    const allProducts: NormalizedProduct[] = []
    let page = 1
    const size = 100

    try {
      let hasMore = true
      while (hasMore) {
        const response = await this.naverClient.client.get('v2/products', {
          searchParams: { page, size },
        }).json<NaverProductsResponse>()

        for (const product of response.contents || []) {
          allProducts.push(this.normalizeProduct(product))
        }

        hasMore = page < response.totalPages
        page++
      }

      return allProducts
    } catch (error) {
      if (error instanceof MarketplaceApiError || error instanceof MarketplaceAuthError) throw error
      throw new MarketplaceApiError('naver', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  private normalizeProduct(product: NaverChannelProduct): NormalizedProduct {
    // Collect images: representative + optional
    const images: { url: string; sortOrder: number }[] = []
    if (product.representativeImage) {
      images.push({ url: product.representativeImage.url, sortOrder: 0 })
    }
    for (const img of product.optionalImages || []) {
      images.push({ url: img.url, sortOrder: img.imageOrder })
    }

    // Map option combinations to variants
    const variants = (product.optionCombinations || []).map((opt) => {
      const optionValues: Record<string, string> = {}
      const optionParts: string[] = []

      if (opt.optionName1) {
        optionValues['option1'] = opt.optionName1
        optionParts.push(opt.optionName1)
      }
      if (opt.optionName2) {
        optionValues['option2'] = opt.optionName2
        optionParts.push(opt.optionName2)
      }
      if (opt.optionName3) {
        optionValues['option3'] = opt.optionName3
        optionParts.push(opt.optionName3)
      }

      return {
        marketplaceVariantId: String(opt.id),
        optionName: optionParts.join('/') || product.name,
        optionValues,
        price: opt.price,
        sku: opt.sellerManagerCode || undefined,
        stockQuantity: opt.stockQuantity,
      } satisfies import('../../types').NormalizedProductVariant
    })

    return {
      productId: String(product.channelProductNo),
      marketplaceId: 'naver',
      name: product.name,
      description: product.detailContent || undefined,
      price: product.salePrice,
      costPrice: undefined,
      images,
      categoryId: product.categoryId || undefined,
      categoryName: product.wholeCategoryName || undefined,
      variants,
      status: product.statusType,
      rawData: product as unknown as Record<string, unknown>,
    }
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
  private async fetchChangedIds(since: Date, lastChangedTypes: string[]): Promise<string[]> {
    const now = new Date()

    // Naver API max window is 1 hour — split into 1-hour chunks
    const HOUR_MS = 60 * 60 * 1000
    const allIds: string[] = []
    let chunkStart = since

    while (chunkStart < now) {
      const chunkEnd = new Date(Math.min(chunkStart.getTime() + HOUR_MS, now.getTime()))

      const params = new URLSearchParams({
        lastChangedFrom: chunkStart.toISOString(),
        lastChangedTo: chunkEnd.toISOString(),
      })
      for (const t of lastChangedTypes) {
        params.append('lastChangedType', t)
      }

      try {
        const response = await this.naverClient.client.get(
          `external/v1/pay-order/seller/product-orders/last-changed-statuses?${params.toString()}`
        ).json<NaverLastChangedStatusesResponse>()
        const ids = (response.data?.lastChangeStatuses || []).map((s) => s.productOrderId)
        allIds.push(...ids)
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'response' in err) {
          const body = await (err as { response: Response }).response.text()
          throw new Error(`Naver API error: ${body}`)
        }
        throw err
      }

      chunkStart = chunkEnd
    }

    return [...new Set(allIds)]
  }

  /**
   * Fetch full product order details by IDs in batch.
   */
  private async fetchProductOrderDetails(productOrderIds: string[]): Promise<NaverProductOrder[]> {
    const response = await this.naverClient.client.post('external/v1/pay-order/seller/product-orders/query', {
      json: { productOrderIds },
    }).json<NaverProductOrderDetailResponse>()

    return response.data || []
  }

  private normalizeOrder(po: NaverProductOrder): NormalizedOrder {
    const { order, productOrder } = po
    const addr = productOrder.shippingAddress
    return {
      marketplaceOrderId: productOrder.productOrderId,
      marketplaceId: 'naver',
      marketplaceStatus: productOrder.productOrderStatus,
      status: mapNaverStatus(productOrder.productOrderStatus),
      buyerName: order.ordererName,
      buyerPhone: order.ordererTel || undefined,
      recipientName: addr?.name ?? order.ordererName,
      recipientPhone: addr?.tel1 || order.ordererTel || undefined,
      shippingAddress: addr ? {
        zipCode: addr.zipCode ?? '',
        address1: addr.baseAddress ?? '',
        address2: addr.detailedAddress || undefined,
      } : { zipCode: '', address1: '' },
      items: [
        {
          marketplaceItemId: productOrder.productOrderId,
          productName: productOrder.productName,
          optionText: productOrder.productOption || undefined,
          quantity: productOrder.quantity,
          unitPrice: productOrder.unitPrice,
          sku: (productOrder as Record<string, unknown>).optionManageCode
            ? String((productOrder as Record<string, unknown>).optionManageCode)
            : undefined,
        },
      ],
      orderedAt: order.paymentDate ? new Date(order.paymentDate) : new Date(order.orderDate),
      totalAmount: productOrder.totalPaymentAmount,
      rawData: po as unknown as Record<string, unknown>,
    }
  }

  private normalizeClaim(po: NaverProductOrder): NormalizedClaim {
    const { order, productOrder } = po
    const claimType = productOrder.claimType
      ? (NAVER_CLAIM_TYPE_MAP[productOrder.claimType] || 'cancel')
      : 'cancel'

    return {
      marketplaceClaimId: productOrder.productOrderId,
      marketplaceId: 'naver',
      marketplaceOrderId: productOrder.productOrderId,
      claimType,
      claimStatus: productOrder.claimStatus ? mapNaverClaimStatus(productOrder.claimStatus) : 'requested',
      reason: productOrder.claimReason || undefined,
      requestedAt: order.paymentDate ? new Date(order.paymentDate) : new Date(order.orderDate),
      rawData: po as unknown as Record<string, unknown>,
    }
  }
}
