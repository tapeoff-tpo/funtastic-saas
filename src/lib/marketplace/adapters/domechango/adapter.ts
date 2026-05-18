import type {
  InvoiceData,
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedClaim,
  NormalizedOrder,
  NormalizedProduct,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import {
  createDomechangoClient,
  DEFAULT_DOMECHANGO_SERVER_IP,
  type DomechangoResponse,
} from './client'

const DOMECHANGO_CONFIG: MarketplaceConfig = {
  id: 'domechango',
  name: '도매창고',
  authType: 'api_key',
  rateLimitPerSecond: 10,
  requiredCredentials: ['api_key', 'secure_key'],
}

interface DomechangoCategory {
  id: number | string
  cate1?: string
  cate2?: string
  cate3?: string
  cate4?: string
}

export class DomechangoAdapter implements MarketplaceAdapter {
  readonly config = DOMECHANGO_CONFIG

  private readonly apiKey: string
  private readonly secureKey: string
  private readonly serverIp: string

  constructor(credentials: {
    api_key?: string
    apiKey?: string
    secure_key?: string
    secureKey?: string
    server_ip?: string
    serverIp?: string
  } = {}) {
    this.apiKey = credentials.api_key ?? credentials.apiKey ?? ''
    this.secureKey = credentials.secure_key ?? credentials.secureKey ?? ''
    this.serverIp = credentials.server_ip ?? credentials.serverIp ?? DEFAULT_DOMECHANGO_SERVER_IP
  }

  async testConnection(
    credentials?: MarketplaceCredentials
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    const apiKey = credentials?.api_key?.trim() ?? this.apiKey.trim()
    const secureKey = credentials?.secure_key?.trim() ?? this.secureKey.trim()
    const serverIp = credentials?.server_ip?.trim() ?? this.serverIp.trim()

    if (!apiKey) {
      return { success: false, error: '도매창고 API Key를 입력해주세요.' }
    }
    if (!secureKey) {
      return { success: false, error: '도매창고 Secure Key를 입력해주세요.' }
    }

    try {
      const response = await createDomechangoClient({
        apiKey,
        secureKey,
        serverIp,
      }).request<DomechangoCategory[]>('GET', '/v2/vendor/category')

      assertSuccess(response)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '도매창고 API 연결에 실패했습니다.',
      }
    }
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
      error: '도매창고 Vendor API 문서에서 송장 업로드 API를 확인하지 못했습니다.',
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
      error: '도매창고 상품 등록은 별도 상품 매핑 설계 후 연결됩니다.',
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
      error: '도매창고 상품 수정은 별도 상품 매핑 설계 후 연결됩니다.',
    }
  }
}

function assertSuccess<T>(response: DomechangoResponse<T>): void {
  if (response.statusCode === '200') return

  const message = typeof response.data === 'string'
    ? response.data
    : JSON.stringify(response.data)

  if (response.statusCode === '401' || response.statusCode === '403') {
    throw new MarketplaceAuthError('domechango', message)
  }

  throw new MarketplaceApiError('domechango', Number(response.statusCode) || 400, message)
}
