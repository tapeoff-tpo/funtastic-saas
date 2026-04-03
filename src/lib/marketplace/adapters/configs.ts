import { marketplaceRegistry } from '../registry'
import type {
  MarketplaceAdapter,
  MarketplaceCredentials,
  NormalizedOrder,
  NormalizedProduct,
  InvoiceData,
} from '../types'

/**
 * Placeholder adapters for Phase 1 (testConnection stubs).
 * Real implementations come in Phase 2+.
 */

const notImplemented = (method: string) =>
  Promise.reject(new Error(`${method}: Not implemented yet (Phase 2)`))

const coupangAdapter: MarketplaceAdapter = {
  config: {
    id: 'coupang',
    name: '쿠팡',
    authType: 'hmac',
    rateLimitPerSecond: 100,
    requiredCredentials: ['access_key', 'secret_key', 'vendor_id'],
  },
  async testConnection(_credentials: MarketplaceCredentials) {
    return { success: false, error: 'Not implemented yet (Phase 2)' }
  },
  async authenticate() {
    return notImplemented('authenticate') as never
  },
  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    return notImplemented('getOrders') as never
  },
  async uploadInvoice(
    _orderId: string,
    _invoice: InvoiceData
  ) {
    return notImplemented('uploadInvoice') as never
  },
  async getProducts(): Promise<NormalizedProduct[]> {
    return notImplemented('getProducts') as never
  },
}

const naverAdapter: MarketplaceAdapter = {
  config: {
    id: 'naver',
    name: '네이버 스마트스토어',
    authType: 'oauth2',
    rateLimitPerSecond: 50,
    requiredCredentials: ['client_id', 'client_secret'],
  },
  async testConnection(_credentials: MarketplaceCredentials) {
    return { success: false, error: 'Not implemented yet (Phase 2)' }
  },
  async authenticate() {
    return notImplemented('authenticate') as never
  },
  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    return notImplemented('getOrders') as never
  },
  async uploadInvoice(
    _orderId: string,
    _invoice: InvoiceData
  ) {
    return notImplemented('uploadInvoice') as never
  },
  async getProducts(): Promise<NormalizedProduct[]> {
    return notImplemented('getProducts') as never
  },
}

export function registerDefaultAdapters() {
  if (!marketplaceRegistry.has('coupang')) {
    marketplaceRegistry.register(coupangAdapter)
  }
  if (!marketplaceRegistry.has('naver')) {
    marketplaceRegistry.register(naverAdapter)
  }
}

// Auto-register on import
registerDefaultAdapters()
