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

/** Normalized order item from marketplace */
export interface NormalizedOrderItem {
  marketplaceItemId: string
  productName: string
  optionText?: string
  quantity: number
  unitPrice: number
  sku?: string
}

/** Normalized order shape -- fully typed for Phase 2 adapters */
export interface NormalizedOrder {
  marketplaceOrderId: string
  marketplaceId: MarketplaceId
  marketplaceStatus: string
  status: OrderStatus
  buyerName: string
  buyerPhone?: string
  recipientName: string
  recipientPhone?: string
  shippingAddress: {
    zipCode: string
    address1: string
    address2?: string
  }
  items: NormalizedOrderItem[]
  orderedAt: Date
  totalAmount: number
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

/** Normalized product shape -- expanded in Phase 5 */
export interface NormalizedProduct {
  productId: string
  marketplaceId: MarketplaceId
  [key: string]: unknown
}

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
  getOrders(since: Date): Promise<NormalizedOrder[]>
  getClaimsOrders(since: Date): Promise<NormalizedClaim[]>
  uploadInvoice(
    orderId: string,
    invoice: InvoiceData
  ): Promise<{ success: boolean; error?: string }>
  getProducts(): Promise<NormalizedProduct[]>
}
