/**
 * Coupang marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses HMAC-SHA256 signed requests to fetch orders and claims
 * from the Coupang WING API, normalizing results to shared interfaces.
 */

import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedInquiry,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { createCoupangClient } from './client'
import { mapCoupangStatus, mapCoupangClaimStatus } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  CoupangInquiriesResponse,
  CoupangOrderSheet,
  CoupangOrderSheetsResponse,
  CoupangReturnRequestsResponse,
  CoupangSellerProduct,
  CoupangSellerProductItem,
  CoupangSellerProductsResponse,
} from './types'

const COUPANG_CONFIG: MarketplaceConfig = {
  id: 'coupang',
  name: '쿠팡',
  authType: 'hmac',
  rateLimitPerSecond: 100,
  requiredCredentials: ['access_key', 'secret_key', 'vendor_id'],
}

/**
 * Phase 8 — Normalize Coupang's free-form shipping label into a fixed enum.
 *
 * Coupang exposes 배송비 결제 구분 in several Korean fields
 * (deliveryChargeTypeName, parcelPrintMessage, shipmentType). We map them to
 * a 4-value enum used across the SaaS for the 배송구분 column.
 *
 *   '선불' / '선결제'    → 'prepaid'
 *   '착불'              → 'cod'
 *   '무료' / '무료배송'   → 'free'
 *   anything else / null → 'unknown'
 */
export function normalizeCoupangShippingType(
  raw: string | undefined | null,
): 'prepaid' | 'cod' | 'free' | 'unknown' {
  if (!raw) return 'unknown'
  const s = String(raw)
  if (s.includes('선불') || s.includes('선결제')) return 'prepaid'
  if (s.includes('착불')) return 'cod'
  if (s.includes('무료')) return 'free'
  return 'unknown'
}

export class CoupangAdapter implements MarketplaceAdapter {
  readonly config = COUPANG_CONFIG

  private readonly client: ReturnType<typeof createCoupangClient>
  private readonly vendorId: string

  constructor(credentials: { access_key: string; secret_key: string; vendor_id: string }) {
    this.client = createCoupangClient(credentials.access_key, credentials.secret_key, credentials.vendor_id)
    this.vendorId = credentials.vendor_id
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      // Make a lightweight call with a 1-minute window to verify credentials
      const now = new Date()
      const oneMinAgo = new Date(now.getTime() - 60_000)
      const fmt = (d: Date) => {
        const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
        const yyyy = kst.getUTCFullYear()
        const MM = String(kst.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(kst.getUTCDate()).padStart(2, '0')
        return `${yyyy}-${MM}-${dd}+09:00`
      }
      const qs = `createdAtFrom=${encodeURIComponent(fmt(oneMinAgo))}&createdAtTo=${encodeURIComponent(fmt(now))}&status=ACCEPT&maxPerPage=1`
      const path = `v2/providers/openapi/apis/api/v5/vendors/${this.vendorId}/ordersheets?${qs}`

      await this.client.get(path).json()

      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // HMAC doesn't require a separate authentication flow.
    // Each request is self-signed with the access key + secret key.
    return { success: true }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    const now = new Date()

    // Coupang API requires KST date: yyyy-MM-dd+09:00 (date only, no time)
    const fmt = (d: Date) => {
      const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
      const yyyy = kst.getUTCFullYear()
      const MM = String(kst.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(kst.getUTCDate()).padStart(2, '0')
      return `${yyyy}-${MM}-${dd}+09:00`
    }

    const qs = `createdAtFrom=${encodeURIComponent(fmt(since))}&createdAtTo=${encodeURIComponent(fmt(now))}&status=ACCEPT&maxPerPage=50`
    const path = `v2/providers/openapi/apis/api/v5/vendors/${this.vendorId}/ordersheets?${qs}`

    try {
      const response = await this.client.get(path).json<CoupangOrderSheetsResponse>()

      const codeStr = String(response.code)
      if (codeStr !== '200' && codeStr !== 'SUCCESS' && codeStr !== 'OK') {
        throw new MarketplaceApiError('coupang', Number(response.code) || 500, response.message)
      }

      return (response.data || []).map((sheet) => this.normalizeOrder(sheet))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      // Extract actual API response for debugging
      if (error instanceof Error && 'response' in error) {
        const res = (error as unknown as { response: Response }).response
        const body = await res.text().catch(() => '')
        console.error('[Coupang] getOrders error response:', res.status, body)
        throw new MarketplaceApiError('coupang', res.status, `${res.status}: ${body}`)
      }
      throw new MarketplaceApiError('coupang', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const now = new Date()
    // returnRequests v4 uses plain date: yyyy-MM-dd (no timezone)
    const fmt = (d: Date) => {
      const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
      const yyyy = kst.getUTCFullYear()
      const MM = String(kst.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(kst.getUTCDate()).padStart(2, '0')
      return `${yyyy}-${MM}-${dd}`
    }
    // Valid return statuses: RU(접수), CC(수거완료), PR(환불처리중), UC(철회)
    const qs = `createdAtFrom=${fmt(since)}&createdAtTo=${fmt(now)}&status=RU&maxPerPage=50`
    const path = `v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/returnRequests?${qs}`

    try {
      const response = await this.client.get(path).json<CoupangReturnRequestsResponse>()

      const codeStr = String(response.code)
      if (codeStr !== '200' && codeStr !== 'SUCCESS' && codeStr !== 'OK') {
        throw new MarketplaceApiError('coupang', Number(response.code) || 500, response.message)
      }

      return (response.data || []).map((req) => this.normalizeClaim(req))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && 'response' in error) {
        const res = (error as unknown as { response: Response }).response
        const body = await res.text().catch(() => '')
        console.error('[Coupang] getClaimsOrders error response:', res.status, body)
        throw new MarketplaceApiError('coupang', res.status, `${res.status}: ${body}`)
      }
      throw new MarketplaceApiError('coupang', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * Phase 8 — Fetch online inquiries (온라인 문의) registered between `since`
   * and now. Coupang uses KST datetimes formatted yyyy-MM-ddTHH:mm:ss for the
   * onlineInquiries endpoint (no timezone suffix; documentation shows naive
   * KST values). pageSize fixed at 50 — pagination beyond a single page is
   * deferred (Phase 8 ends at "수집 가능" per plan).
   */
  async getInquiries(since: Date): Promise<NormalizedInquiry[]> {
    const fmt = (d: Date) => {
      const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
      const yyyy = kst.getUTCFullYear()
      const MM = String(kst.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(kst.getUTCDate()).padStart(2, '0')
      const HH = String(kst.getUTCHours()).padStart(2, '0')
      const mm = String(kst.getUTCMinutes()).padStart(2, '0')
      const ss = String(kst.getUTCSeconds()).padStart(2, '0')
      return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}`
    }

    const qs = `inquiryStartAt=${encodeURIComponent(fmt(since))}&inquiryEndAt=${encodeURIComponent(fmt(new Date()))}&pageSize=50`
    const path = `v2/providers/openapi/apis/api/v5/vendors/${this.vendorId}/onlineInquiries?${qs}`

    try {
      const res = await this.client.get(path).json<CoupangInquiriesResponse>()
      return (res.data ?? []).map((raw) => ({
        marketplaceInquiryId: String(raw.inquiryId),
        marketplaceId: 'coupang' as const,
        marketplaceOrderId: raw.orderId !== undefined && raw.orderId !== null
          ? String(raw.orderId)
          : undefined,
        inquiryType: 'online' as const,
        question: raw.content ?? raw.title ?? '',
        answeredAt: raw.answeredAt ? new Date(raw.answeredAt) : undefined,
        requestedAt: new Date(raw.inquiryRegisteredAt),
        rawData: raw as unknown as Record<string, unknown>,
      }))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && 'response' in error) {
        const r = (error as unknown as { response: Response }).response
        const body = await r.text().catch(() => '')
        console.error('[Coupang] getInquiries error response:', r.status, body)
        throw new MarketplaceApiError('coupang', r.status, `${r.status}: ${body}`)
      }
      throw new MarketplaceApiError('coupang', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async confirmOrder(
    marketplaceOrderId: string,
    rawData?: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> {
    // Coupang requires shipmentBoxId for order confirmation
    const shipmentBoxId = rawData?.shipmentBoxId as number | undefined
    if (!shipmentBoxId) {
      return { success: false, error: 'shipmentBoxId가 없습니다 (rawData 확인 필요)' }
    }

    const path = `v2/providers/openapi/apis/api/v5/vendors/${this.vendorId}/ordersheets/acknowledgement`

    try {
      const response = await this.client.put(path, {
        json: {
          vendorId: this.vendorId,
          shipmentBoxIds: [shipmentBoxId],
        },
      }).json<{ code: number | string; message: string; data: unknown }>()

      const codeStr = String(response.code)
      if (codeStr === '200' || codeStr === 'SUCCESS' || codeStr === 'OK') {
        return { success: true }
      }

      return { success: false, error: response.message || `발주확인 실패: ${codeStr}` }
    } catch (error) {
      if (error instanceof Error && 'response' in error) {
        const res = (error as unknown as { response: Response }).response
        const body = await res.text().catch(() => '')
        return { success: false, error: `${res.status}: ${body}` }
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    const path = `v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/orders/invoices`

    try {
      const response = await this.client.put(path, {
        json: {
          vendorId: this.vendorId,
          orderSheetInvoiceApplyDtos: [
            {
              shipmentBoxId: invoice.shipmentBoxId,
              orderId,
              vendorItemId: invoice.vendorItemId,
              deliveryCompanyCode: mapCarrierCode('coupang', invoice.carrierId),
              invoiceNumber: invoice.trackingNumber,
              splitShipping: false,
              preSplitShipped: false,
              estimatedShippingDate: undefined,
            },
          ],
        },
      }).json<{ code: string; message: string }>()

      if (response.code === '200' || response.code === 'SUCCESS') {
        return { success: true }
      }

      return { success: false, error: response.message || `Upload failed with code: ${response.code}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    const path = `v2/providers/seller_api/apis/api/v1/marketplace/seller-products`
    const allProducts: NormalizedProduct[] = []
    let nextToken: string | undefined

    try {
      do {
        const searchParams: Record<string, string | number> = {
          vendorId: this.vendorId,
          maxPerPage: 50,
        }
        if (nextToken) {
          searchParams.nextToken = nextToken
        }

        const response = await this.client.get(path, { searchParams })
          .json<CoupangSellerProductsResponse>()

        if (response.code !== '200' && response.code !== 'SUCCESS') {
          throw new MarketplaceApiError('coupang', Number(response.code) || 500, response.message)
        }

        for (const product of response.data || []) {
          allProducts.push(this.normalizeProduct(product))
        }

        nextToken = response.nextToken
      } while (nextToken)

      return allProducts
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('coupang', 'HMAC authentication failed')
      }
      throw new MarketplaceApiError('coupang', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  private normalizeProduct(product: CoupangSellerProduct): NormalizedProduct {
    // Collect all images from items, deduped by cdnPath
    const imageSet = new Map<string, { url: string; sortOrder: number }>()
    let sortOrder = 0
    for (const item of product.items) {
      for (const img of item.images || []) {
        if (!imageSet.has(img.cdnPath)) {
          imageSet.set(img.cdnPath, { url: img.cdnPath, sortOrder: sortOrder++ })
        }
      }
    }

    // Use the first item's sale price as the base price
    const basePrice = product.items[0]?.salePrice ?? 0

    return {
      productId: String(product.sellerProductId),
      marketplaceId: 'coupang',
      name: product.sellerProductName,
      description: undefined,
      price: basePrice,
      costPrice: undefined,
      images: Array.from(imageSet.values()),
      categoryId: product.displayCategoryCode ? String(product.displayCategoryCode) : undefined,
      categoryName: undefined,
      variants: product.items.map((item) => this.normalizeProductVariant(item)),
      status: product.statusName,
      rawData: product as unknown as Record<string, unknown>,
    }
  }

  private normalizeProductVariant(item: CoupangSellerProductItem): import('../../types').NormalizedProductVariant {
    const optionValues: Record<string, string> = {}
    const optionParts: string[] = []

    for (const attr of item.attributes || []) {
      optionValues[attr.attributeTypeName] = attr.valueName
      optionParts.push(attr.valueName)
    }

    return {
      marketplaceVariantId: String(item.vendorItemId),
      optionName: optionParts.join('/') || item.itemName,
      optionValues,
      price: item.salePrice,
      sku: item.externalVendorSku || undefined,
      stockQuantity: undefined, // Coupang doesn't include stock in product list
    }
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    const path = `v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/products`

    try {
      const payload = this.buildCoupangProductPayload(product)

      const response = await this.client.post(path, {
        json: payload,
      }).json<{ code: string; message: string; data?: { productId: number } }>()

      if (response.code === '200' || response.code === 'SUCCESS') {
        return {
          success: true,
          marketplaceProductId: response.data?.productId ? String(response.data.productId) : undefined,
        }
      }

      return { success: false, error: response.message || `Registration failed with code: ${response.code}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    const path = `v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/products/${marketplaceProductId}`

    try {
      const payload = this.buildCoupangProductPayload(product as NormalizedProduct)

      const response = await this.client.put(path, {
        json: payload,
      }).json<{ code: string; message: string }>()

      if (response.code === '200' || response.code === 'SUCCESS') {
        return { success: true }
      }

      return { success: false, error: response.message || `Update failed with code: ${response.code}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Build Coupang-specific product payload from NormalizedProduct.
   * Maps internal fields to Coupang WING API product registration format.
   */
  private buildCoupangProductPayload(product: Partial<NormalizedProduct>) {
    return {
      displayCategoryCode: product.marketplaceCategoryId ?? product.categoryId,
      sellerProductName: product.name,
      vendorId: this.vendorId,
      saleStartedAt: new Date().toISOString(),
      saleEndedAt: '2099-01-01T00:00:00',
      brand: '',
      generalProductName: product.name,
      productGroup: '',
      deliveryChargeType: 'FREE',
      deliveryCharge: 0,
      freeShipOverAmount: 0,
      deliveryChargeOnReturn: 5000,
      remoteAreaDeliverable: 'N',
      unionDeliveryType: 'UNION_DELIVERY',
      returnCenterCode: '',
      returnChargeName: '',
      companyContactNumber: '',
      returnZipCode: '',
      returnAddress: '',
      returnAddressDetail: '',
      returnCharge: 5000,
      returnChargeVendor: 'VENDOR',
      afterServiceInformation: '',
      afterServiceContactNumber: '',
      outboundShippingPlaceCode: 0,
      vendorUserId: '',
      requested: false,
      items: (product.variants || []).map((v) => ({
        itemName: v.optionName || product.name,
        originalPrice: v.price,
        salePrice: v.price,
        maximumBuyCount: 999,
        maximumBuyForPerson: 0,
        outboundShippingTimeDay: 2,
        unitCount: 1,
        adultOnly: 'EVERYONE',
        taxType: 'TAX',
        parallelImported: 'NOT_PARALLEL_IMPORTED',
        overseasPurchased: 'NOT_OVERSEAS_PURCHASED',
        externalVendorSku: v.sku,
        barcode: '',
        emptyBarcode: true,
        images: (product.images || []).map((img) => ({
          imageOrder: img.sortOrder,
          imageType: img.sortOrder === 0 ? 'REPRESENTATIVE' : 'DETAIL',
          vendorPath: img.url,
        })),
        notices: [],
        attributes: [],
        contents: [
          {
            contentsType: 'TEXT',
            contentDetails: [
              {
                content: product.description || '',
                detailType: 'TEXT',
              },
            ],
          },
        ],
      })),
    }
  }

  private normalizeOrder(sheet: CoupangOrderSheet): NormalizedOrder {
    // v5 API returns orderItems array inside each shipment box
    const items = (sheet.orderItems || []).map((item) => ({
      marketplaceItemId: String(item.vendorItemId),
      productName: item.vendorItemName || item.sellerProductName,
      optionText: item.sellerProductItemName || undefined,
      quantity: item.shippingCount || 1,
      unitPrice: item.orderPrice?.units ?? 0,
      sku: item.externalVendorSkuCode || undefined,
    }))

    const totalAmount = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    )

    return {
      marketplaceOrderId: String(sheet.orderId),
      marketplaceId: 'coupang',
      marketplaceStatus: sheet.status,
      status: mapCoupangStatus(sheet.status),
      buyerName: sheet.orderer.name,
      buyerPhone: sheet.orderer.safeNumber || undefined,
      recipientName: sheet.receiver.name,
      recipientPhone: sheet.receiver.safeNumber || sheet.receiver.receiverNumber || undefined,
      shippingAddress: {
        zipCode: sheet.receiver.postCode,
        address1: sheet.receiver.addr1,
        address2: sheet.receiver.addr2 || undefined,
      },
      items,
      orderedAt: new Date(sheet.paidAt),
      totalAmount,
      // Phase 8: 마켓에서 수집된 배송비 (KRW)
      shippingFee: typeof sheet.shippingPrice?.units === 'number' ? sheet.shippingPrice.units : null,
      // Phase 8: 배송구분 enum (prepaid/cod/free/unknown) - per CONTEXT.md D-04
      shippingType: normalizeCoupangShippingType(
        sheet.deliveryChargeTypeName ?? sheet.parcelPrintMessage ?? sheet.shipmentType,
      ),
      rawData: sheet as unknown as Record<string, unknown>,
    }
  }

  private normalizeClaim(req: CoupangReturnRequestsResponse['data'][number]): NormalizedClaim {
    return {
      marketplaceClaimId: String(req.returnId),
      marketplaceId: 'coupang',
      marketplaceOrderId: String(req.orderId),
      claimType: 'return',
      claimStatus: mapCoupangClaimStatus(req.returnStatus),
      reason: req.returnReason || undefined,
      requestedAt: new Date(req.createdAt),
      rawData: req as unknown as Record<string, unknown>,
    }
  }
}
