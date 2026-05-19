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
import { createSsgmallClient } from './client'
import { mapSsgmallStatus } from './status-map'
import type { SsgmallApiResponse, SsgmallDirectionOrder, SsgmallDirectionRequest } from './types'

const SSGMALL_CONFIG: MarketplaceConfig = {
  id: 'ssgmall',
  name: 'SSG',
  authType: 'api_key',
  rateLimitPerSecond: 5,
  requiredCredentials: ['api_key'],
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function compactJoin(parts: Array<string | number | undefined | null>, separator = '-'): string {
  return parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(separator)
}

function parseDate(value?: string): Date {
  if (!value) return new Date()
  const normalized = value.length === 8
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value.replace(' ', 'T')
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function getDirections(response: SsgmallApiResponse): SsgmallDirectionOrder[] {
  const directions = response.shppDirections
  if (Array.isArray(directions)) return directions
  const nested = directions?.shppDirection
  if (Array.isArray(nested)) return nested
  return nested ? [nested] : []
}

function isSuccessResponse(response: SsgmallApiResponse): boolean {
  const code = String(response.resultCode ?? '').trim()
  return code === '' || code === '00' || code === '0000' || code === '200' || code.toUpperCase() === 'SUCCESS'
}

export class SsgmallAdapter implements MarketplaceAdapter {
  readonly config = SSGMALL_CONFIG

  private readonly client: ReturnType<typeof createSsgmallClient>

  constructor(credentials: { api_key: string }) {
    this.client = createSsgmallClient(credentials.api_key)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    void _credentials
    try {
      const today = new Date()
      const response = await this.listShippingDirections(today, today, '02')
      if (isSuccessResponse(response)) return { success: true }
      return { success: false, error: response.resultDesc || response.resultMessage || 'SSG API 인증 확인 실패' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    return { success: true }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    try {
      const response = await this.listShippingDirections(since, until, '02')
      if (!isSuccessResponse(response)) {
        throw new MarketplaceApiError(
          'ssgmall',
          400,
          response.resultDesc || response.resultMessage || 'Failed to fetch SSG shipping directions',
        )
      }

      return getDirections(response).map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('ssgmall', 'SSG API key authentication failed')
      }
      throw new MarketplaceApiError('ssgmall', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    void _since
    return []
  }

  async uploadInvoice(_orderId: string, _invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    void _orderId
    void _invoice
    return { success: false, error: 'SSG 송장등록 API 문서 확인 후 연결됩니다.' }
  }

  async confirmOrder(_marketplaceOrderId: string): Promise<{ success: boolean; error?: string }> {
    void _marketplaceOrderId
    return { success: false, error: 'SSG 주문확인 API 문서 확인 후 연결됩니다.' }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(_product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    void _product
    return { success: false, error: 'SSG 상품등록 API 문서 확인 후 연결됩니다.' }
  }

  async updateProduct(_marketplaceProductId: string, _product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    void _marketplaceProductId
    void _product
    return { success: false, error: 'SSG 상품수정 API 문서 확인 후 연결됩니다.' }
  }

  private async listShippingDirections(
    since: Date,
    until: Date,
    perdType: SsgmallDirectionRequest['requestShppDirection']['perdType'],
  ): Promise<SsgmallApiResponse> {
    return this.client
      .post('api/pd/1/listShppDirection.ssg', {
        json: {
          requestShppDirection: {
            perdType,
            perdStrDts: formatDate(since),
            perdEndDts: formatDate(until),
            shppStatCd: '10',
          },
        } satisfies SsgmallDirectionRequest,
      })
      .json<SsgmallApiResponse>()
  }

  private normalizeOrder(order: SsgmallDirectionOrder): NormalizedOrder {
    const orderId = String(order.ordNo ?? order.orordNo ?? order.shppNo ?? '')
    const itemId = compactJoin([orderId, order.ordItemSeq, order.shppNo, order.shppSeq])
    const quantity = asNumber(order.ordQty ?? order.dircItemQty, 1)
    const unitPrice = asNumber(order.rlordAmt ?? order.sellprc ?? order.splprc, 0)
    const address1 = order.shpplocBascAddr || order.ordpeRoadAddr || order.shpplocAddr || ''
    const address2 = order.shpplocDtlAddr || undefined

    return {
      marketplaceOrderId: orderId || itemId,
      marketplaceId: 'ssgmall',
      marketplaceStatus: compactJoin([order.shppProgStatDtlCd, order.shppStatCd, order.shppStatNm], ':'),
      status: mapSsgmallStatus(order.shppProgStatDtlCd, order.shppStatCd),
      buyerName: order.ordpeNm || order.rcptpeNm || '',
      buyerPhone2: order.ordpeHpno || undefined,
      recipientName: order.rcptpeNm || order.ordpeNm || '',
      recipientPhone: order.rcptpeTelno || undefined,
      recipientPhone2: order.rcptpeHpno || undefined,
      shippingAddress: {
        zipCode: order.shpplocZipcd || order.shpplocOldZipcd || '',
        address1,
        address2,
      },
      items: [
        {
          marketplaceItemId: itemId || orderId,
          productName: order.itemNm || '',
          optionText: order.uitemNm || order.mdlNm || undefined,
          quantity,
          unitPrice,
          sku: order.uSplVenItemId || order.splVenItemId || order.uitemId || order.itemId || undefined,
        },
      ],
      orderedAt: parseDate(order.ordCmplDts || order.ordRcpDts),
      totalAmount: unitPrice * quantity,
      shippingType: order.shppcstCodYn === 'Y' ? 'cod' : 'prepaid',
      shippingFee: asNumber(order.shppcst, 0),
      deliveryMessage: order.ordMemoCntt || undefined,
      rawData: {
        ...order,
        orderIdentity: {
          orderId: orderId || itemId,
          itemIds: [itemId || orderId],
        },
      },
    }
  }
}
