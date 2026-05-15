import type {
  InvoiceData,
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedClaim,
  NormalizedOrder,
  NormalizedProduct,
} from '../../types'

const DOMECHANGO_CONFIG: MarketplaceConfig = {
  id: 'domechango',
  name: '도매창고',
  authType: 'api_key',
  rateLimitPerSecond: 10,
  requiredCredentials: ['api_key', 'secure_key'],
}

export class DomechangoAdapter implements MarketplaceAdapter {
  readonly config = DOMECHANGO_CONFIG

  private readonly apiKey: string
  private readonly secureKey: string

  constructor(credentials: { api_key?: string; apiKey?: string; secure_key?: string; secureKey?: string } = {}) {
    this.apiKey = credentials.api_key ?? credentials.apiKey ?? ''
    this.secureKey = credentials.secure_key ?? credentials.secureKey ?? ''
  }

  async testConnection(
    credentials?: MarketplaceCredentials
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    const apiKey = credentials?.api_key?.trim() ?? this.apiKey.trim()
    const secureKey = credentials?.secure_key?.trim() ?? this.secureKey.trim()

    if (!apiKey) {
      return { success: false, error: '도매창고 API Key를 입력해주세요.' }
    }
    if (!secureKey) {
      return { success: false, error: '도매창고 Secure Key를 입력해주세요.' }
    }

    return { success: true }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    const result = await this.testConnection()
    return { success: result.success }
  }

  async getOrders(): Promise<NormalizedOrder[]> {
    return []
  }

  async getClaimsOrders(): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(
    orderId: string,
    invoice: InvoiceData
  ): Promise<{ success: boolean; error?: string }> {
    void orderId
    void invoice
    return {
      success: false,
      error: '도매창고 송장 업로드는 API 스펙 확인 후 연결됩니다.',
    }
  }

  async confirmOrder(): Promise<{ success: boolean; error?: string }> {
    return {
      success: true,
    }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(
    product: NormalizedProduct
  ): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    void product
    return {
      success: false,
      error: '도매창고 상품 등록은 API 스펙 확인 후 연결됩니다.',
    }
  }

  async updateProduct(
    marketplaceProductId: string,
    product: Partial<NormalizedProduct>
  ): Promise<{ success: boolean; error?: string }> {
    void marketplaceProductId
    void product
    return {
      success: false,
      error: '도매창고 상품 수정은 API 스펙 확인 후 연결됩니다.',
    }
  }
}
