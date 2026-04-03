/**
 * Marketplace adapter type definitions.
 *
 * These types define the contract that every marketplace integration must implement.
 * The adapter pattern allows adding new marketplaces by implementing MarketplaceAdapter
 * and registering with the registry.
 */

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

/** Normalized order shape — expanded in Phase 2 */
export interface NormalizedOrder {
  orderId: string
  marketplaceId: MarketplaceId
  [key: string]: unknown
}

/** Normalized product shape — expanded in Phase 5 */
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

  // Phase 2+ methods — declared in interface, implementations throw 'Not implemented' until Phase 2
  authenticate(): Promise<{ success: boolean; expiresAt?: Date }>
  getOrders(since: Date): Promise<NormalizedOrder[]>
  uploadInvoice(
    orderId: string,
    invoice: InvoiceData
  ): Promise<{ success: boolean; error?: string }>
  getProducts(): Promise<NormalizedProduct[]>
}
