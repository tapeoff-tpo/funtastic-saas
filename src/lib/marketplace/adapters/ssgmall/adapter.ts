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
import type {
  SsgmallApiResponse,
  SsgmallDirectionOrder,
  SsgmallDirectionRequest,
  SsgmallWarehouseOutRequest,
} from './types'

const SSGMALL_CARRIER_CODES: Record<string, string> = {
  CJGLS: '0000033011',
  HANJIN: '0000033071',
  KDEXP: '0000033027',
  DAESIN: '0000033030',
  CHUNIL: '0000033062',
  ILYANG: '0000033057',
}

const SSGMALL_CONFIG: MarketplaceConfig = {
  id: 'ssgmall',
  name: 'SSG',
  authType: 'api_key',
  rateLimitPerSecond: 5,
  requiredCredentials: ['api_key'],
}

const SSGMALL_DEFAULT_RELEASE_TYPES = '11,15'
const SSGMALL_ORDER_COMPLETED_STATUS = '120'

function formatDate(date: Date): string {
  const kst = new Date(date.getTime() + (9 * 60 * 60 * 1000))
  const yyyy = kst.getUTCFullYear()
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kst.getUTCDate()).padStart(2, '0')
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

function asArray<T>(value: T[] | T | undefined): T[] {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

function getDirections(response: SsgmallApiResponse): SsgmallDirectionOrder[] {
  const orders: SsgmallDirectionOrder[] = []
  orders.push(...asArray(response.shppDirection))

  const directions = response.shppDirections
  if (Array.isArray(directions)) {
    orders.push(...directions)
  } else {
    orders.push(...asArray(directions?.shppDirection))
  }

  return orders
}

function getWarehouseOuts(response: SsgmallApiResponse): SsgmallDirectionOrder[] {
  const orders: SsgmallDirectionOrder[] = []
  orders.push(...asArray(response.warehouseOut))

  const warehouseOuts = response.warehouseOuts
  if (Array.isArray(warehouseOuts)) {
    orders.push(...warehouseOuts)
  } else {
    orders.push(...asArray(warehouseOuts?.warehouseOut))
  }

  return orders
}

function isSuccessResponse(response: SsgmallApiResponse): boolean {
  const code = String(response.result?.resultCode ?? response.resultCode ?? '').trim()
  return code === '' || code === '00' || code === '0000' || code === '200' || code.toUpperCase() === 'SUCCESS'
}

function responseMessage(response: SsgmallApiResponse, fallback: string): string {
  return response.result?.resultDesc
    || response.resultDesc
    || response.result?.resultMessage
    || response.resultMessage
    || fallback
}

function getSsgShippingIdentity(rawData?: Record<string, unknown>): { shppNo: string; shppSeq: string } | null {
  const shppNo = rawData?.shppNo
  const shppSeq = rawData?.shppSeq
  if (shppNo == null || shppSeq == null) return null
  return { shppNo: String(shppNo), shppSeq: String(shppSeq) }
}

function mapCarrierId(carrierId: string): string {
  return SSGMALL_CARRIER_CODES[carrierId] ?? carrierId
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
      return { success: false, error: responseMessage(response, 'SSG API 인증 확인 실패') }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    return { success: true }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    try {
      const directionPeriodTypes: SsgmallDirectionRequest['requestShppDirection']['perdType'][] = ['01', '02', '03']
      const warehousePeriodTypes: SsgmallWarehouseOutRequest['requestWarehouseOut']['perdType'][] = ['01', '02', '03', '04']
      const responses = await Promise.all([
        ...directionPeriodTypes.map((perdType) => this.listShippingDirections(since, until, perdType)),
        ...warehousePeriodTypes.map((perdType) => this.listWarehouseOuts(since, until, perdType)),
      ])

      const orders: SsgmallDirectionOrder[] = []
      for (const response of responses) {
        if (!isSuccessResponse(response)) {
          throw new MarketplaceApiError(
            'ssgmall',
            400,
            responseMessage(response, 'Failed to fetch SSG orders'),
          )
        }
        orders.push(...getDirections(response), ...getWarehouseOuts(response))
      }

      return this.dedupeOrders(orders).map((order) => this.normalizeOrder(order))
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

  async uploadInvoice(_orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    void _orderId
    const identity = getSsgShippingIdentity(invoice.rawData as Record<string, unknown> | undefined)
    if (!identity) {
      return { success: false, error: 'SSG 송장등록에 필요한 배송번호/배송순번이 주문 원본 데이터에 없습니다.' }
    }

    try {
      const response = await this.client
        .post('api/pd/1/saveWblNo.ssg', {
          json: {
            requestWhOutCompleteProcess: {
              shppNo: identity.shppNo,
              shppSeq: identity.shppSeq,
              wblNo: invoice.trackingNumber,
              delicoVenId: mapCarrierId(invoice.carrierId),
              shppTypeCd: '20',
              shppTypeDtlCd: '22',
            },
          },
        })
        .json<SsgmallApiResponse>()

      if (isSuccessResponse(response)) return { success: true }
      return { success: false, error: responseMessage(response, 'SSG 송장등록 실패') }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async confirmOrder(_marketplaceOrderId: string, rawData?: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    void _marketplaceOrderId
    const identity = getSsgShippingIdentity(rawData)
    if (!identity) {
      return { success: false, error: 'SSG 주문확인에 필요한 배송번호/배송순번이 주문 원본 데이터에 없습니다.' }
    }

    try {
      const response = await this.client
        .post('api/pd/1/updateOrderSubjectManage.ssg', {
          json: {
            requestOrderSubjectManage: {
              shppNo: identity.shppNo,
              shppSeq: identity.shppSeq,
            },
          },
        })
        .json<SsgmallApiResponse>()

      if (isSuccessResponse(response)) return { success: true }
      return { success: false, error: responseMessage(response, 'SSG 주문확인 실패') }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
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
            commType: '02',
            commValue: '',
            shppDivDtlCd: SSGMALL_DEFAULT_RELEASE_TYPES,
            ordStatCd: SSGMALL_ORDER_COMPLETED_STATUS,
            shppStatCd: '10',
          },
        } satisfies SsgmallDirectionRequest,
      })
      .json<SsgmallApiResponse>()
  }

  private async listWarehouseOuts(
    since: Date,
    until: Date,
    perdType: SsgmallWarehouseOutRequest['requestWarehouseOut']['perdType'],
  ): Promise<SsgmallApiResponse> {
    return this.client
      .post('api/pd/1/listWarehouseOut.ssg', {
        json: {
          requestWarehouseOut: {
            perdType,
            perdStrDts: formatDate(since),
            perdEndDts: formatDate(until),
            commType: '02',
            commValue: '',
            shppDivDtlCd: SSGMALL_DEFAULT_RELEASE_TYPES,
            shppStatCd: '10',
          },
        } satisfies SsgmallWarehouseOutRequest,
      })
      .json<SsgmallApiResponse>()
  }

  private dedupeOrders(orders: SsgmallDirectionOrder[]): SsgmallDirectionOrder[] {
    const seen = new Set<string>()
    const deduped: SsgmallDirectionOrder[] = []
    for (const order of orders) {
      const key = compactJoin([order.shppNo, order.shppSeq, order.ordNo, order.ordItemSeq])
      if (!key || seen.has(key)) continue
      seen.add(key)
      deduped.push(order)
    }
    return deduped
  }

  private normalizeOrder(order: SsgmallDirectionOrder): NormalizedOrder {
    const orderId = String(order.ordNo ?? order.orordNo ?? order.shppNo ?? '')
    const itemId = compactJoin([orderId, order.ordItemSeq, order.shppNo, order.shppSeq])
    const marketplaceOrderId = itemId || orderId
    const quantity = asNumber(order.ordQty ?? order.dircItemQty, 1)
    const unitPrice = asNumber(order.rlordAmt ?? order.sellprc ?? order.splprc ?? order.splPrc, 0)
    const progressCode = order.shppProgStatDtlCd || order.lastShppProgStatDtlCd || order.shppTabProgStatCd
    const progressName = order.shppStatNm || order.lastShppProgStatDtlNm
    const address1 = order.shpplocBascAddr || order.shpplocRoadAddr || order.ordpeRoadAddr || order.shpplocAddr || ''
    const address2 = order.shpplocDtlAddr || undefined

    return {
      marketplaceOrderId,
      marketplaceId: 'ssgmall',
      marketplaceStatus: compactJoin([progressCode, order.shppStatCd, progressName], ':'),
      status: mapSsgmallStatus(progressCode, order.shppStatCd),
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
