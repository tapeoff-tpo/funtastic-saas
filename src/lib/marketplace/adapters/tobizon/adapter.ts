import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError } from '../../errors'
import { createTobizonClient } from './client'
import type { TobizonCredentials, TobizonGoodsPayload, TobizonGoodsResponse } from './types'

const TOBIZON_CONFIG: MarketplaceConfig = {
  id: 'tobizon',
  name: '투비즈온',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'secure_key', 'client_server_ip'],
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function getTobizonPayload(product: NormalizedProduct | Partial<NormalizedProduct>): TobizonGoodsPayload | null {
  const metadata = product.metadata && typeof product.metadata === 'object'
    ? product.metadata as Record<string, unknown>
    : {}
  const explicit = metadata.tobizon
  if (explicit && typeof explicit === 'object') {
    return explicit as TobizonGoodsPayload
  }

  const productName = product.name ?? ''
  const productId = product.productId ?? ''
  const price = asNumber(product.price)
  const categoryId = asNumber(product.marketplaceCategoryId ?? product.categoryId)
  const imageUrls = product.images?.map((image) => image.url).filter(Boolean) ?? []
  const keywords = asString(metadata.keywords) || asString(metadata.keyword) || productName
  const origin = asString(metadata.origin) || '기타'
  const maker = asString(metadata.maker) || asString(metadata.manufacturer) || '상세설명참조'
  const longdesc = product.description ?? asString(metadata.longdesc)

  if (!categoryId || !productName || !productId || !price || !longdesc || imageUrls.length === 0) {
    return null
  }

  return {
    catecode: categoryId,
    goodsnm: productName,
    goodssm: productName,
    vgoodscd: product.sku ?? productId,
    tax: 'Y',
    maker,
    origin,
    brand: asString(metadata.brand),
    model: asString(metadata.model),
    keyword: keywords,
    consumer_keep: 'N',
    consumer_print: 'N',
    price_consumer: asNumber(metadata.price_consumer) || price,
    price_supply: price,
    useoption: 'N',
    option_items: [],
    inpuseoption: 'N',
    inpoption: [],
    delivery_type: 'FE',
    delivery_fee_type: 'S',
    delivery_price: asNumber(metadata.delivery_price),
    box_unit: asNumber(metadata.box_unit) || 1,
    foreign_delivery: 'N',
    returnyn: 'Y',
    return_price: asNumber(metadata.return_price),
    exchange_price: asNumber(metadata.exchange_price),
    extra_price: asNumber(metadata.extra_price),
    extra_price2: asNumber(metadata.extra_price2),
    image: imageUrls,
    runout: 'S',
    gstatus: 'N',
    gtype: 'B',
    adult: 'N',
    certtype: 'C',
    cert: [],
    longdesc,
    gosi: Array.isArray(metadata.gosi) ? metadata.gosi as TobizonGoodsPayload['gosi'] : [],
  }
}

function resultFromGoodsResponse(response: TobizonGoodsResponse): {
  success: boolean
  marketplaceProductId?: string
  error?: string
} {
  const message = response.mag ?? response.msg ?? response.message
  if (response.code === 'success') {
    return {
      success: true,
      marketplaceProductId: response.goodscd,
    }
  }
  return {
    success: false,
    error: message ?? '투비즈온 상품 API 요청 실패',
  }
}

export class TobizonAdapter implements MarketplaceAdapter {
  readonly config = TOBIZON_CONFIG

  private readonly credentials: TobizonCredentials | null
  private readonly client: ReturnType<typeof createTobizonClient> | null

  constructor(credentials?: Partial<TobizonCredentials>) {
    const normalized = {
      api_key: credentials?.api_key?.trim() ?? '',
      secure_key: credentials?.secure_key?.trim() ?? '',
      client_server_ip: credentials?.client_server_ip?.trim() ?? '',
    }
    this.credentials = normalized.api_key && normalized.secure_key && normalized.client_server_ip
      ? normalized
      : null
    this.client = this.credentials ? createTobizonClient(this.credentials) : null
  }

  async testConnection(
    credentials?: MarketplaceCredentials
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    const apiKey = credentials?.api_key?.trim() ?? this.credentials?.api_key ?? ''
    const secureKey = credentials?.secure_key?.trim() ?? this.credentials?.secure_key ?? ''
    const clientServerIp = credentials?.client_server_ip?.trim() ?? this.credentials?.client_server_ip ?? ''

    if (!apiKey || !secureKey || !clientServerIp) {
      return { success: false, error: 'api_key, secure_key, client_server_ip를 모두 입력해주세요.' }
    }
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(clientServerIp)) {
      return { success: false, error: 'API 서버 IP는 IPv4 형식으로 입력해주세요.' }
    }
    return { success: true }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    if (!this.credentials) {
      return { success: false }
    }
    return { success: true }
  }

  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    throw new MarketplaceApiError('tobizon', 501, '투비즈온 공급사 API 문서에는 주문 수집 엔드포인트가 없습니다.')
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    throw new MarketplaceApiError('tobizon', 501, '투비즈온 공급사 API 문서에는 클레임 수집 엔드포인트가 없습니다.')
  }

  async uploadInvoice(
    _orderId: string,
    _invoice: InvoiceData
  ): Promise<{ success: boolean; error?: string }> {
    throw new MarketplaceApiError('tobizon', 501, '투비즈온 공급사 API 문서에는 송장 업로드 엔드포인트가 없습니다.')
  }

  async confirmOrder(
    _marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '발주확인 미구현' }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(
    product: NormalizedProduct
  ): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    if (!this.client) return { success: false, error: '투비즈온 인증정보가 없습니다.' }
    const payload = getTobizonPayload(product)
    if (!payload) {
      return {
        success: false,
        error: '투비즈온 상품 등록 필수값이 부족합니다. metadata.tobizon에 전체 상품 payload를 넣거나 카테고리/이미지/상세설명을 입력해주세요.',
      }
    }

    try {
      const response = await this.client.postGoods(payload)
      return resultFromGoodsResponse(response)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '투비즈온 상품 등록 실패' }
    }
  }

  async updateProduct(
    _marketplaceProductId: string,
    product: Partial<NormalizedProduct>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.client) return { success: false, error: '투비즈온 인증정보가 없습니다.' }
    const payload = getTobizonPayload(product)
    if (!payload) {
      return {
        success: false,
        error: '투비즈온 상품 수정 필수값이 부족합니다. metadata.tobizon에 전체 상품 payload를 넣어주세요.',
      }
    }

    try {
      const response = await this.client.putGoods(payload)
      return resultFromGoodsResponse(response)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '투비즈온 상품 수정 실패' }
    }
  }
}
