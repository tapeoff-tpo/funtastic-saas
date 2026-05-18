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
  Promise.reject(new Error(`${method}: Not implemented yet`))

/** Helper to create a stub adapter with standard not-implemented methods */
function createStubAdapter(config: MarketplaceAdapter['config']): MarketplaceAdapter {
  return {
    config,
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
    async uploadInvoice(_orderId: string, _invoice: InvoiceData) {
      return notImplemented('uploadInvoice') as never
    },
    async confirmOrder(_marketplaceOrderId: string) {
      return { success: false, error: `${config.id}: 발주확인 미구현` }
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
}

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
  async confirmOrder(_marketplaceOrderId: string) {
    return { success: false, error: '발주확인 미구현' }
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
  async confirmOrder(_marketplaceOrderId: string) {
    return { success: false, error: '발주확인 미구현' }
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
  async confirmOrder(_marketplaceOrderId: string) {
    return { success: false, error: '발주확인 미구현' }
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
    requiredCredentials: ['master_id', 'secret_key', 'seller_id'],
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
  async confirmOrder(_marketplaceOrderId: string) {
    return { success: false, error: '발주확인 미구현' }
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
    requiredCredentials: ['master_id', 'secret_key', 'seller_id'],
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
  async confirmOrder(_marketplaceOrderId: string) {
    return { success: false, error: '발주확인 미구현' }
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
  async confirmOrder(_marketplaceOrderId: string) {
    return { success: false, error: '발주확인 미구현' }
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

// --- Tier 1: Cafe24, CJ온스타일, 카카오선물하기, 카카오톡스토어 ---

const cafe24Adapter = createStubAdapter({
  id: 'cafe24',
  name: 'Cafe24',
  authType: 'oauth2',
  rateLimitPerSecond: 40,
  requiredCredentials: ['client_id', 'client_secret', 'mall_id', 'access_token'],
})

const cjonestyleAdapter = createStubAdapter({
  id: 'cjonestyle',
  name: 'CJ온스타일',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['api_key', 'seller_code'],
})

const kakaoGiftAdapter = createStubAdapter({
  id: 'kakao-gift',
  name: '카카오선물하기',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['api_key', 'store_id'],
})

const kakaoStoreAdapter = createStubAdapter({
  id: 'kakao-store',
  name: '카카오톡스토어',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['admin_app_key', 'seller_app_key'],
})

// --- Tier 2: 도매꾹, 온채널, 오너클랜, 신세계몰, 에이블리 ---

const domeggookAdapter = createStubAdapter({
  id: 'domeggook',
  name: '도매꾹',
  authType: 'session',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'seller_id', 'session_id'],
})

const onchannelAdapter = createStubAdapter({
  id: 'onchannel',
  name: '온채널',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'shop_id'],
})

const ownerclanAdapter = createStubAdapter({
  id: 'ownerclan',
  name: '오너클랜',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['username', 'password', 'vendor_id', 'vendor_password'],
})

const ssgmallAdapter = createStubAdapter({
  id: 'ssgmall',
  name: '신세계몰',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['api_key', 'vendor_id'],
})

const ablyAdapter = createStubAdapter({
  id: 'ably',
  name: '에이블리',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['api_key', 'shop_id'],
})

// --- Tier 3A: 현대홈쇼핑, NS홈쇼핑, 도매의신, 도매창고, 바나나B2B ---

const hyundaiHmallAdapter = createStubAdapter({
  id: 'hyundai-hmall',
  name: '현대홈쇼핑',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'seller_id'],
})

const gsShopAdapter = createStubAdapter({
  id: 'gs-shop',
  name: 'GS샵',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'seller_id'],
})

const esmAdapter = createStubAdapter({
  id: 'esm',
  name: 'ESM',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['master_id', 'secret_key', 'seller_id'],
})

const nsmallAdapter = createStubAdapter({
  id: 'nsmall',
  name: 'NS홈쇼핑',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'vendor_code'],
})

const domesinAdapter = createStubAdapter({
  id: 'domesin',
  name: '도매의신',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'seller_id'],
})

const specialofferAdapter = createStubAdapter({
  id: 'specialoffer',
  name: '스페셜오퍼',
  authType: 'api_key',
  rateLimitPerSecond: 10,
  requiredCredentials: ['api_key'],
})

const domechangoAdapter = createStubAdapter({
  id: 'domechango',
  name: '도매창고',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'secure_key'],
})

const bananaB2bAdapter = createStubAdapter({
  id: 'banana-b2b',
  name: '바나나B2B',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'partner_id'],
})

// --- Tier 3B: 올웨이즈, 텐바이텐, 토스쇼핑, 투비즈온 ---

const funtasticB2bAdapter = createStubAdapter({
  id: 'funtastic-b2b',
  name: '펀타스틱B2B',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'base_url'],
})

const alwaysAdapter = createStubAdapter({
  id: 'always',
  name: '올웨이즈',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'seller_id'],
})

const zigzagAdapter = createStubAdapter({
  id: 'zigzag',
  name: '지그재그',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'shop_id'],
})

const tenByTenAdapter = createStubAdapter({
  id: '10x10',
  name: '텐바이텐',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'shop_id'],
})

const tossShoppingAdapter = createStubAdapter({
  id: 'toss-shopping',
  name: '토스쇼핑',
  authType: 'oauth2',
  rateLimitPerSecond: 50,
  requiredCredentials: ['access_key', 'secret_key'],
})

const tobizonAdapter = createStubAdapter({
  id: 'tobizon',
  name: '투비즈온',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'secure_key', 'client_server_ip'],
})

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
  // Tier 1
  if (!marketplaceRegistry.has('cafe24')) {
    marketplaceRegistry.register(cafe24Adapter)
  }
  if (!marketplaceRegistry.has('cjonestyle')) {
    marketplaceRegistry.register(cjonestyleAdapter)
  }
  if (!marketplaceRegistry.has('kakao-gift')) {
    marketplaceRegistry.register(kakaoGiftAdapter)
  }
  if (!marketplaceRegistry.has('kakao-store')) {
    marketplaceRegistry.register(kakaoStoreAdapter)
  }
  // Tier 2
  if (!marketplaceRegistry.has('domeggook')) {
    marketplaceRegistry.register(domeggookAdapter)
  }
  if (!marketplaceRegistry.has('onchannel')) {
    marketplaceRegistry.register(onchannelAdapter)
  }
  if (!marketplaceRegistry.has('ownerclan')) {
    marketplaceRegistry.register(ownerclanAdapter)
  }
  if (!marketplaceRegistry.has('ssgmall')) {
    marketplaceRegistry.register(ssgmallAdapter)
  }
  if (!marketplaceRegistry.has('ably')) {
    marketplaceRegistry.register(ablyAdapter)
  }
  // Tier 3A
  if (!marketplaceRegistry.has('hyundai-hmall')) {
    marketplaceRegistry.register(hyundaiHmallAdapter)
  }
  if (!marketplaceRegistry.has('gs-shop')) {
    marketplaceRegistry.register(gsShopAdapter)
  }
  if (!marketplaceRegistry.has('esm')) {
    marketplaceRegistry.register(esmAdapter)
  }
  if (!marketplaceRegistry.has('nsmall')) {
    marketplaceRegistry.register(nsmallAdapter)
  }
  if (!marketplaceRegistry.has('domesin')) {
    marketplaceRegistry.register(domesinAdapter)
  }
  if (!marketplaceRegistry.has('specialoffer')) {
    marketplaceRegistry.register(specialofferAdapter)
  }
  if (!marketplaceRegistry.has('domechango')) {
    marketplaceRegistry.register(domechangoAdapter)
  }
  if (!marketplaceRegistry.has('banana-b2b')) {
    marketplaceRegistry.register(bananaB2bAdapter)
  }
  if (!marketplaceRegistry.has('funtastic-b2b')) {
    marketplaceRegistry.register(funtasticB2bAdapter)
  }
  // Tier 3B
  if (!marketplaceRegistry.has('always')) {
    marketplaceRegistry.register(alwaysAdapter)
  }
  if (!marketplaceRegistry.has('zigzag')) {
    marketplaceRegistry.register(zigzagAdapter)
  }
  if (!marketplaceRegistry.has('10x10')) {
    marketplaceRegistry.register(tenByTenAdapter)
  }
  if (!marketplaceRegistry.has('toss-shopping')) {
    marketplaceRegistry.register(tossShoppingAdapter)
  }
  if (!marketplaceRegistry.has('tobizon')) {
    marketplaceRegistry.register(tobizonAdapter)
  }
}

// Auto-register on import
registerDefaultAdapters()
