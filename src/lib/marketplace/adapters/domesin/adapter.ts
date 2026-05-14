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
import { postDomesinForm, postDomesinJson } from './client'
import type { DomesinBaseResponse, DomesinCashResponse, DomesinProduct, DomesinProductListResponse } from './types'

const DOMESIN_CONFIG: MarketplaceConfig = {
  id: 'domesin',
  name: '도매의신',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'seller_id'],
}

function todayKst(): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date())
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function assertSuccess(response: DomesinBaseResponse): void {
  if (response.code === '0000') return
  const message = response.message || '도매의신 API 요청이 실패했습니다.'
  if (response.code === '10' || response.code === '11' || response.code === '16' || response.code === '17') {
    throw new MarketplaceAuthError('domesin', `${message} (code: ${response.code})`)
  }
  throw new MarketplaceApiError('domesin', 400, `${message} (code: ${response.code})`)
}

export class DomesinAdapter implements MarketplaceAdapter {
  readonly config = DOMESIN_CONFIG

  private readonly apiKey: string
  private readonly memberId: string

  constructor(credentials: { api_key: string; seller_id?: string; m_id?: string }) {
    this.apiKey = credentials.api_key
    this.memberId = credentials.seller_id ?? credentials.m_id ?? ''
  }

  async testConnection(credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    void credentials
    try {
      const response = await postDomesinJson<DomesinCashResponse>('/API/v11/my_cash.php', this.basePayload())
      assertSuccess(response)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    const result = await this.testConnection()
    if (!result.success) throw new MarketplaceAuthError('domesin', result.error ?? '도매의신 인증 실패')
    return { success: true }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    void since
    // Domesin's public manual provides order creation/status APIs, not an inbound order-list collection API.
    return []
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    void since
    return []
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    void orderId
    void invoice
    return {
      success: false,
      error: '도매의신 API는 판매회원 발주/상태조회 중심이며 송장 업로드 API는 매뉴얼에서 확인되지 않았습니다.',
    }
  }

  async confirmOrder(marketplaceOrderId: string): Promise<{ success: boolean; error?: string }> {
    void marketplaceOrderId
    return { success: true }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    const today = todayKst()
    const response = await postDomesinForm<DomesinProductListResponse>('/API/v13/item_list.php', {
      ...this.basePayload(),
      page: 1,
      rows: 100,
      start_date: today,
      end_date: today,
    })
    assertSuccess(response)
    return (response.items ?? []).map((product) => this.normalizeProduct(product))
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    void product
    return { success: false, error: '도매의신 상품등록 API는 공급사 전용이라 판매회원 연동에서는 비활성화했습니다.' }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    void marketplaceProductId
    void product
    return { success: false, error: '도매의신 상품수정 API는 현재 구현되어 있지 않습니다.' }
  }

  private basePayload(): { api_key: string; m_id: string } {
    return {
      api_key: this.apiKey,
      m_id: this.memberId,
    }
  }

  private normalizeProduct(product: DomesinProduct): NormalizedProduct {
    const imageUrls = Array.isArray(product.img) ? product.img.filter(Boolean) : []
    return {
      productId: product.icode,
      marketplaceId: 'domesin',
      name: product.iname,
      price: asNumber(product.price),
      sku: product.icode,
      status: String(product.status ?? ''),
      images: imageUrls.map((url, index) => ({ url, sortOrder: index })),
      metadata: {
        consumerPrice: asNumber(product.price_consumer),
        deliveryType: product.delivery_type,
        deliveryAmount: asNumber(product.delivery_amount),
        brand: product.brand,
        model: product.model,
        keyword: product.keyword,
        content: product.content,
      },
    }
  }
}
