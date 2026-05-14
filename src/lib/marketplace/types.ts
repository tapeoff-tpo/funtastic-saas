/**
 * Marketplace adapter type definitions.
 *
 * These types define the contract that every marketplace integration must implement.
 * The adapter pattern allows adding new marketplaces by implementing MarketplaceAdapter
 * and registering with the registry.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Known marketplace IDs with autocomplete, but extensible for custom marketplaces */
export type MarketplaceId =
  | 'coupang'
  | 'naver'
  | 'elevenst'
  | 'gmarket'
  | 'auction'
  | 'ohouse'
  | 'cafe24'
  | 'cjonestyle'
  | 'kakao-gift'
  | 'kakao-store'
  | 'domeggook'
  | 'onchannel'
  | 'ownerclan'
  | 'ssgmall'
  | 'ably'
  | 'hyundai-hmall'
  | 'gs-shop'
  | 'esm'
  | 'nsmall'
  | 'domesin'
  | 'domechango'
  | 'banana-b2b'
  | 'funtastic-b2b'
  | 'always'
  | 'zigzag'
  | '10x10'
  | 'toss-shopping'
  | 'tobizon'
  | (string & {})

export type ConnectionStatus = 'connected' | 'error' | 'expired' | 'disconnected'

export type AuthType = 'hmac' | 'oauth2' | 'api_key' | 'session'

export interface MarketplaceConfig {
  readonly id: MarketplaceId
  readonly name: string
  readonly authType: AuthType
  readonly rateLimitPerSecond: number
  readonly requiredCredentials: string[]
}

export interface MarketplaceCredentials {
  [key: string]: string
}

/**
 * Normalized order item from marketplace.
 *
 * marketplaceItemId is the marketplace's line/product-order identifier.
 * If a marketplace only exposes one order identifier, use the order ID here too.
 */
export interface NormalizedOrderItem {
  marketplaceItemId: string
  productName: string
  optionText?: string
  quantity: number
  unitPrice: number
  sku?: string
}

/** Normalized marketplace order identity retained in orders.rawData for downstream actions. */
export interface MarketplaceOrderIdentity {
  /** Customer-facing/general marketplace order number. */
  orderId: string
  /** Product/line/order-item identifiers used by marketplace APIs for item-level actions. */
  itemIds: string[]
}

/** Normalized order shape -- fully typed for Phase 2 adapters */
export interface NormalizedOrder {
  /**
   * Customer-facing/general marketplace order number.
   * Do not store product-order/order-item IDs here; those belong in items[].marketplaceItemId.
   */
  marketplaceOrderId: string
  marketplaceId: MarketplaceId
  marketplaceStatus: string
  status: OrderStatus
  buyerName: string
  /** 구매자 전화번호1 — 일반전화/집전화 */
  buyerPhone?: string
  /** 구매자 전화번호2 — 휴대폰 (기본 표기 우선순위) */
  buyerPhone2?: string
  recipientName: string
  /** 수령인 전화번호1 — 일반전화/집전화 */
  recipientPhone?: string
  /** 수령인 전화번호2 — 휴대폰 (기본 표기 우선순위) */
  recipientPhone2?: string
  shippingAddress: {
    zipCode: string
    address1: string
    address2?: string
  }
  items: NormalizedOrderItem[]
  orderedAt: Date
  totalAmount: number
  /** 배송구분 — raw marketplace value or normalized enum (prepaid/cod/free/unknown). Phase 8. */
  shippingType?: string | null
  /** 마켓에서 수집된 배송비 (KRW). Phase 8. */
  shippingFee?: number | null
  /** 배송메세지 — 구매자가 마켓에서 입력한 배송 요청사항 (쿠팡 parcelPrintMessage 등). */
  deliveryMessage?: string | null
  rawData: Record<string, unknown>
}

/** Normalized marketplace inquiry (Phase 8 — Coupang 우선) */
export interface NormalizedInquiry {
  marketplaceInquiryId: string
  marketplaceId: MarketplaceId
  marketplaceOrderId?: string
  inquiryType: 'product' | 'callcenter' | 'online'
  question: string
  answeredAt?: Date
  requestedAt: Date
  rawData: Record<string, unknown>
}

/** Normalized claim from marketplace (per D-02) */
export interface NormalizedClaim {
  marketplaceClaimId: string
  marketplaceId: MarketplaceId
  marketplaceOrderId: string
  claimType: 'cancel' | 'return' | 'exchange'
  claimStatus: 'requested' | 'processing' | 'completed' | 'rejected'
  reason?: string
  requestedAt: Date
  rawData: Record<string, unknown>
}

/** Normalized product shape for sync to marketplaces */
export interface NormalizedProduct {
  productId: string
  marketplaceId: MarketplaceId
  name: string
  description?: string
  price: number
  sku?: string
  categoryId?: string
  marketplaceCategoryId?: string
  images?: Array<{ url: string; sortOrder: number }>
  variants?: Array<{
    sku?: string
    optionName?: string
    optionValues?: Record<string, string>
    price: number
    isActive?: boolean
    stockQuantity?: number
    marketplaceVariantId?: string
    [key: string]: unknown
  }>
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

/** Extracted variant type for adapter use */
export type NormalizedProductVariant = NonNullable<NormalizedProduct['variants']>[number]

/** Invoice data for upload */
export interface InvoiceData {
  trackingNumber: string
  carrierId: string
  [key: string]: unknown
}

export interface MarketplaceAdapter {
  readonly config: MarketplaceConfig

  /** Test if credentials are valid without full authentication flow */
  testConnection(
    credentials: MarketplaceCredentials
  ): Promise<{
    success: boolean
    error?: string
    expiresAt?: Date
  }>

  // Phase 2+ methods
  authenticate(): Promise<{ success: boolean; expiresAt?: Date }>
  getOrders(since: Date, until?: Date): Promise<NormalizedOrder[]>
  getClaimsOrders(since: Date): Promise<NormalizedClaim[]>
  uploadInvoice(
    orderId: string,
    invoice: InvoiceData
  ): Promise<{ success: boolean; error?: string }>
  getProducts(): Promise<NormalizedProduct[]>

  // Order confirmation (발주확인)
  confirmOrder(
    marketplaceOrderId: string,
    rawData?: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }>

  // Phase 5: Product registration and sync
  registerProduct(
    product: NormalizedProduct
  ): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }>
  updateProduct(
    marketplaceProductId: string,
    product: Partial<NormalizedProduct>
  ): Promise<{ success: boolean; error?: string }>

  // Phase 8: Marketplace inquiries (optional — only marketplaces that support it)
  getInquiries?(since: Date): Promise<NormalizedInquiry[]>
}
