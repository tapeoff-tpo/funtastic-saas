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

const SSGMALL_ORDER_COMPLETED_STATUS = '120'
const SSGMALL_RELEASE_TYPES = '11,15'

function formatDate(date: Date): string {
  const kst = new Date(date.getTime() + (9 * 60 * 60 * 1000))
  const yyyy = kst.getUTCFullYear()
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kst.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatCompactDate(date: Date): string {
  return formatDate(date).replace(/-/g, '')
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
  orders.push(...asArray(response.data?.shppDirection))
  orders.push(...asArray(response.response?.shppDirection))
  orders.push(...asArray(response.body?.shppDirection))

  for (const directions of [
    response.shppDirections,
    response.data?.shppDirections,
    response.response?.shppDirections,
    response.body?.shppDirections,
  ]) {
    if (Array.isArray(directions)) {
      orders.push(...directions)
    } else {
      orders.push(...asArray(directions?.shppDirection))
    }
  }

  return orders
}

function getWarehouseOuts(response: SsgmallApiResponse): SsgmallDirectionOrder[] {
  const orders: SsgmallDirectionOrder[] = []
  orders.push(...asArray(response.warehouseOut))
  orders.push(...asArray(response.data?.warehouseOut))
  orders.push(...asArray(response.response?.warehouseOut))
  orders.push(...asArray(response.body?.warehouseOut))

  for (const warehouseOuts of [
    response.warehouseOuts,
    response.data?.warehouseOuts,
    response.response?.warehouseOuts,
    response.body?.warehouseOuts,
  ]) {
    if (Array.isArray(warehouseOuts)) {
      orders.push(...warehouseOuts)
    } else {
      orders.push(...asArray(warehouseOuts?.warehouseOut))
    }
  }

  return orders
}

function getOrderInquiryResults(response: SsgmallApiResponse): SsgmallDirectionOrder[] {
  return [
    ...asArray(response.resultList),
    ...asArray(response.data?.resultList),
    ...asArray(response.response?.resultList),
    ...asArray(response.body?.resultList),
  ]
}

function isSuccessResponse(response: SsgmallApiResponse): boolean {
  const code = String(
    response.result?.resultCode
    ?? response.data?.result?.resultCode
    ?? response.data?.resultCode
    ?? response.response?.result?.resultCode
    ?? response.response?.resultCode
    ?? response.body?.result?.resultCode
    ?? response.body?.resultCode
    ?? response.resultCode
    ?? '',
  ).trim()
  return code === '' || code === '00' || code === '0000' || code === '200' || code.toUpperCase() === 'SUCCESS'
}

function responseMessage(response: SsgmallApiResponse, fallback: string): string {
  return response.result?.resultDesc
    || response.data?.result?.resultDesc
    || response.data?.resultDesc
    || response.response?.result?.resultDesc
    || response.response?.resultDesc
    || response.body?.result?.resultDesc
    || response.body?.resultDesc
    || response.resultDesc
    || response.result?.resultMessage
    || response.data?.result?.resultMessage
    || response.data?.resultMessage
    || response.response?.result?.resultMessage
    || response.response?.resultMessage
    || response.body?.result?.resultMessage
    || response.body?.resultMessage
    || response.resultMessage
    || fallback
}

function responseResultCode(response: SsgmallApiResponse): string {
  return String(
    response.result?.resultCode
    ?? response.data?.result?.resultCode
    ?? response.data?.resultCode
    ?? response.response?.result?.resultCode
    ?? response.response?.resultCode
    ?? response.body?.result?.resultCode
    ?? response.body?.resultCode
    ?? response.resultCode
    ?? 'none',
  ).trim()
}

function summarizeResponseShape(response: SsgmallApiResponse): string {
  const nestedKeys = ['data', 'response', 'body']
    .map((key) => {
      const value = response[key as keyof SsgmallApiResponse]
      return value && typeof value === 'object' ? `${key}[${Object.keys(value).join(',')}]` : null
    })
    .filter(Boolean)
    .join(' ')
  return `code=${responseResultCode(response)} keys=[${Object.keys(response).join(',')}]${nestedKeys ? ` ${nestedKeys}` : ''}`
}

function summarizeCollectionResponse(
  label: string,
  response: SsgmallApiResponse,
  count: number,
): string {
  return `${label}:${count}:${summarizeResponseShape(response)}`
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
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
        {
          label: 'order-inquiry-all',
          response: await this.listOrderInquiries(since, until),
        },
        {
          label: 'order-inquiry-120',
          response: await this.listOrderInquiries(since, until, '120'),
        },
        {
          label: 'order-inquiry-140',
          response: await this.listOrderInquiries(since, until, '140'),
        },
        ...directionPeriodTypes.map(async (perdType) => ({
          label: `direction-${perdType}`,
          response: await this.listShippingDirections(since, until, perdType),
        })),
        ...warehousePeriodTypes.map(async (perdType) => ({
          label: `warehouse-${perdType}`,
          response: await this.listWarehouseOuts(since, until, perdType),
        })),
      ])

      const orders: SsgmallDirectionOrder[] = []
      const diagnostics: string[] = []
      for (const { label, response } of responses) {
        if (!isSuccessResponse(response)) {
          throw new MarketplaceApiError(
            'ssgmall',
            400,
            responseMessage(response, 'Failed to fetch SSG orders'),
          )
        }
        const responseOrders = [
          ...getOrderInquiryResults(response),
          ...getDirections(response),
          ...getWarehouseOuts(response),
        ]
        diagnostics.push(summarizeCollectionResponse(label, response, responseOrders.length))
        orders.push(...responseOrders)
      }

      if (orders.length === 0) {
        return []
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
            shppDivDtlCd: SSGMALL_RELEASE_TYPES,
            ordStatCd: SSGMALL_ORDER_COMPLETED_STATUS,
          },
        } satisfies SsgmallDirectionRequest,
      })
      .json<SsgmallApiResponse>()
  }

  private async listOrderInquiries(
    since: Date,
    until: Date,
    ordStatCd?: '120' | '140',
  ): Promise<SsgmallApiResponse> {
    return this.client
      .post('ms/lnkg/listOrderInquiry.ssg', {
        json: {
          travelClaimInfo: {
            travelSearchCondition: removeUndefinedValues({
              ordRcpStrtDt: formatCompactDate(since),
              ordRcpEndDt: formatCompactDate(until),
              ordStatCd,
            }),
          },
        },
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
            shppDivDtlCd: SSGMALL_RELEASE_TYPES,
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
    const quantity = asNumber(order.ordQty ?? order.rlordQty ?? order.dircQty ?? order.dircItemQty, 1)
    const unitPrice = asNumber(order.rlordAmt ?? order.sellprc ?? order.splprc ?? order.splPrc, 0)
    const progressCode = order.ordItemStatCd || order.ordStatCd || order.shppProgStatDtlCd || order.lastShppProgStatDtlCd || order.shppTabProgStatCd
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
      orderedAt: parseDate(order.ordCmplDts || order.ordCmplDt || order.paymtCmplDt || order.ordRcpDts),
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
