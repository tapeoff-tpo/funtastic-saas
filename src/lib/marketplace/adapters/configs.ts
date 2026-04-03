import { marketplaceRegistry } from '../registry'
import type {
  MarketplaceAdapter,
  MarketplaceCredentials,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
} from '../types'

/**
 * Placeholder adapters for registry enumeration.
 * Real implementations (CoupangAdapter, NaverAdapter, etc.) are used
 * when credentials are provided in the worker. These stubs allow
 * the registry to list all known marketplaces and their configs.
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
  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return notImplemented('getClaimsOrders') as never
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
  async registerProduct(_product: NormalizedProduct) {
    return notImplemented('registerProduct') as never
  },
  async updateProduct(_id: string, _product: Partial<NormalizedProduct>) {
    return notImplemented('updateProduct') as never
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
  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return notImplemented('getClaimsOrders') as never
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
  async registerProduct(_product: NormalizedProduct) {
    return notImplemented('registerProduct') as never
  },
  async updateProduct(_id: string, _product: Partial<NormalizedProduct>) {
    return notImplemented('updateProduct') as never
  },
}

const elevenstAdapter: MarketplaceAdapter = {
  config: {
    id: 'elevenst',
    name: '11번가',
    authType: 'api_key',
    rateLimitPerSecond: 30,
    requiredCredentials: ['api_key'],
  },
  async testConnection(_credentials: MarketplaceCredentials) {
    return { success: false, error: 'Not implemented yet' }
  },
  async authenticate() {
    return notImplemented('authenticate') as never
  },
  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    return notImplemented('getOrders') as never
  },
  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return notImplemented('getClaimsOrders') as never
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
  async registerProduct(_product: NormalizedProduct) {
    return notImplemented('registerProduct') as never
  },
  async updateProduct(_id: string, _product: Partial<NormalizedProduct>) {
    return notImplemented('updateProduct') as never
  },
}

const gmarketAdapter: MarketplaceAdapter = {
  config: {
    id: 'gmarket',
    name: '지마켓',
    authType: 'api_key',
    rateLimitPerSecond: 30,
    requiredCredentials: ['api_key'],
  },
  async testConnection(_credentials: MarketplaceCredentials) {
    return { success: false, error: 'Not implemented yet' }
  },
  async authenticate() {
    return notImplemented('authenticate') as never
  },
  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    return notImplemented('getOrders') as never
  },
  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return notImplemented('getClaimsOrders') as never
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
  async registerProduct(_product: NormalizedProduct) {
    return notImplemented('registerProduct') as never
  },
  async updateProduct(_id: string, _product: Partial<NormalizedProduct>) {
    return notImplemented('updateProduct') as never
  },
}

const auctionAdapter: MarketplaceAdapter = {
  config: {
    id: 'auction',
    name: '옥션',
    authType: 'api_key',
    rateLimitPerSecond: 30,
    requiredCredentials: ['api_key'],
  },
  async testConnection(_credentials: MarketplaceCredentials) {
    return { success: false, error: 'Not implemented yet' }
  },
  async authenticate() {
    return notImplemented('authenticate') as never
  },
  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    return notImplemented('getOrders') as never
  },
  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return notImplemented('getClaimsOrders') as never
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
  async registerProduct(_product: NormalizedProduct) {
    return notImplemented('registerProduct') as never
  },
  async updateProduct(_id: string, _product: Partial<NormalizedProduct>) {
    return notImplemented('updateProduct') as never
  },
}

const ohouseAdapter: MarketplaceAdapter = {
  config: {
    id: 'ohouse',
    name: '오늘의집',
    authType: 'api_key',
    rateLimitPerSecond: 20,
    requiredCredentials: ['api_key'],
  },
  async testConnection(_credentials: MarketplaceCredentials) {
    return { success: false, error: 'Not implemented yet' }
  },
  async authenticate() {
    return notImplemented('authenticate') as never
  },
  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    return notImplemented('getOrders') as never
  },
  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return notImplemented('getClaimsOrders') as never
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
  async registerProduct(_product: NormalizedProduct) {
    return notImplemented('registerProduct') as never
  },
  async updateProduct(_id: string, _product: Partial<NormalizedProduct>) {
    return notImplemented('updateProduct') as never
  },
}

export function registerDefaultAdapters() {
  if (!marketplaceRegistry.has('coupang')) {
    marketplaceRegistry.register(coupangAdapter)
  }
  if (!marketplaceRegistry.has('naver')) {
    marketplaceRegistry.register(naverAdapter)
  }
  if (!marketplaceRegistry.has('elevenst')) {
    marketplaceRegistry.register(elevenstAdapter)
  }
  if (!marketplaceRegistry.has('gmarket')) {
    marketplaceRegistry.register(gmarketAdapter)
  }
  if (!marketplaceRegistry.has('auction')) {
    marketplaceRegistry.register(auctionAdapter)
  }
  if (!marketplaceRegistry.has('ohouse')) {
    marketplaceRegistry.register(ohouseAdapter)
  }
}

// Auto-register on import
registerDefaultAdapters()
