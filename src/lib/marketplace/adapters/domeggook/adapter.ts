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
import { createDomeggookClient, postDomeggookFormJson, readDomeggookJson } from './client'
import type { DomeggookListResponse, DomeggookLoginResponse, DomeggookOrder, DomeggookOrderConfirmResponse } from './types'

const DOMEGGOOK_CONFIG: MarketplaceConfig = {
  id: 'domeggook',
  name: '도매꾹',
  authType: 'session',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'seller_id', 'session_id'],
}

const DOMEGGOOK_MAX_LOOKBACK_DAYS = 6
const DAY_MS = 86_400_000

function daysSince(since: Date): number {
  const diffMs = Date.now() - since.getTime()
  const days = Math.ceil(diffMs / DAY_MS)
  return Math.min(DOMEGGOOK_MAX_LOOKBACK_DAYS, Math.max(1, days))
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function ensureArray<T>(value: T | T[] | { item?: T | T[] } | undefined): T[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'object' && 'item' in value) {
    const item = value.item
    if (!item) return []
    return Array.isArray(item) ? item : [item]
  }
  return [value]
}

function parseDomeggookDate(value: unknown): Date {
  const raw = asString(value)
  if (!raw) return new Date()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(`${raw.replace(' ', 'T')}+09:00`)
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function mapStatus(status: string): NormalizedOrder['status'] {
  if (status === '결제완료' || status === 'WAITCHK') return 'new'
  if (status === '배송준비중' || status === 'WAITDELI') return 'confirmed'
  if (status === '배송중' || status === 'WAITOK') return 'shipped'
  if (status === '배송완료' || status === 'WAITRCPT') return 'delivered'
  if (status.includes('취소') || status === 'DENYBUY' || status === 'DENYSELL') return 'cancelled'
  return 'new'
}

function orderKey(order: DomeggookOrder): string {
  return asString(order.orderNo) || order.orderUid || asString(order.itemNo)
}

function toDomeggookOrderNo(marketplaceOrderId: string): string {
  return marketplaceOrderId.replace(/^OR/i, '')
}

export class DomeggookAdapter implements MarketplaceAdapter {
  readonly config = DOMEGGOOK_CONFIG

  private readonly client: ReturnType<typeof createDomeggookClient>
  private readonly apiKey: string
  private readonly sellerId: string
  private readonly sessionSecret: string
  private resolvedSessionId?: string
  private resolvedLoginIp?: string

  constructor(credentials: { api_key: string; seller_id: string; session_id?: string; password?: string }) {
    this.apiKey = credentials.api_key
    this.sellerId = credentials.seller_id
    this.sessionSecret = credentials.password || credentials.session_id || ''
    this.client = createDomeggookClient(credentials.api_key)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      this.assertPrivateApiCredentials()
      await this.fetchOrderPage({ day: 1, page: 1, pageSize: 1 })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    this.assertPrivateApiCredentials()
    return { success: true }
  }

  async getOrders(since: Date, _until?: Date): Promise<NormalizedOrder[]> {
    this.assertPrivateApiCredentials()

    try {
      const lookbackDays = daysSince(since)
      const slices = Array.from({ length: lookbackDays }, (_, index) => index + 1)
      const sliceOrders = await Promise.all(slices.map((day) => this.fetchOrdersForDaySlice(day)))
      const uniqueOrders = new Map<string, DomeggookOrder>()

      for (const order of sliceOrders.flat()) {
        const key = orderKey(order)
        if (key) uniqueOrders.set(key, order)
      }

      return Array.from(uniqueOrders.values()).map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('NO_LOGIN') || error.message.includes('sId'))) {
        throw new MarketplaceAuthError('domeggook', error.message)
      }
      throw new MarketplaceApiError('domeggook', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(_orderId: string, _invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '도매꾹 송장 등록은 아직 연결되지 않았습니다.' }
  }

  async confirmOrder(marketplaceOrderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const orderNo = toDomeggookOrderNo(marketplaceOrderId)
      const response = await postDomeggookFormJson<DomeggookOrderConfirmResponse>(this.client, {
        ver: '1.0',
        mode: 'setOrdChk',
        aid: this.apiKey,
        id: this.sellerId,
        sId: await this.getSessionId(),
        no: orderNo,
        oe: 'utf-8',
        om: 'json',
      })

      const { errorCode, errorMessage } = this.getApiError(response)
      if (errorMessage || (errorCode != null && String(errorCode) !== '0')) {
        return { success: false, error: `${errorCode ? `[${errorCode}] ` : ''}${errorMessage ?? '도매꾹 발주확인 API 오류'}` }
      }

      const result = response.domeggook?.result ?? response.result
      const success = response.domeggook?.success ?? response.success
      const fail = response.domeggook?.fail ?? response.fail

      if (result === true || result === 'true' || result === 'SUCCESS' || this.containsOrderNo(success, orderNo)) {
        return { success: true }
      }

      return { success: false, error: `도매꾹 발주확인 실패${fail ? `: ${JSON.stringify(fail)}` : ''}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(_product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    return { success: false, error: '도매꾹 상품 등록은 아직 연결되지 않았습니다.' }
  }

  async updateProduct(_marketplaceProductId: string, _product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '도매꾹 상품 수정은 아직 연결되지 않았습니다.' }
  }

  private async fetchOrdersForDaySlice(day: number): Promise<DomeggookOrder[]> {
    const orders: DomeggookOrder[] = []
    let page = 1
    let totalPages = 1

    do {
      const response = await this.fetchOrderPage({ day, page, pageSize: 50 })
      orders.push(...ensureArray(response.domeggook?.items ?? response.items).filter((order) => this.isOrderInDaySlice(order, day)))
      totalPages = Math.max(1, asNumber(response.domeggook?.header?.numberOfPages ?? response.header?.numberOfPages) || 1)
      page += 1
    } while (page <= totalPages)

    return orders
  }

  private isOrderInDaySlice(order: DomeggookOrder, day: number): boolean {
    const orderedAt = parseDomeggookDate(order.date || order.pay?.datePay)
    const now = Date.now()
    const endMs = day === 1 ? now : now - (day - 1) * DAY_MS
    const startMs = now - day * DAY_MS
    const orderedMs = orderedAt.getTime()
    return orderedMs >= startMs && orderedMs <= endMs
  }

  private async fetchOrderPage(params: { day: number; page: number; pageSize: number }): Promise<DomeggookListResponse<DomeggookOrder>> {
    const response = await readDomeggookJson<DomeggookListResponse<DomeggookOrder>>(this.client, {
      ver: '4.0',
      mode: 'getOrderList',
      aid: this.apiKey,
      id: this.sellerId,
      sId: await this.getSessionId(),
      day: params.day,
      for: 'sell',
      st: '결제완료',
      pg: params.page,
      ic: params.pageSize,
      oe: 'utf-8',
      om: 'json',
    })

    const { errorCode, errorMessage } = this.getApiError(response)
    if (errorMessage || (errorCode != null && String(errorCode) !== '0')) {
      throw new MarketplaceApiError('domeggook', 400, `${errorCode ? `[${errorCode}] ` : ''}${errorMessage ?? '도매꾹 API 오류'}`)
    }

    return response
  }

  private assertPrivateApiCredentials() {
    if (!this.apiKey || !this.sellerId || !this.sessionSecret) {
      throw new MarketplaceAuthError('domeggook', '도매꾹 Private API는 api_key, seller_id, session_id 칸에 저장한 비밀번호가 필요합니다.')
    }
  }

  private async getSessionId(): Promise<string> {
    if (this.resolvedSessionId) return this.resolvedSessionId

    const response = await postDomeggookFormJson<DomeggookLoginResponse>(this.client, {
      ver: '4.1',
      mode: 'setLogin',
      aid: this.apiKey,
      id: this.sellerId,
      pw: this.sessionSecret,
      loginKeep: 'on',
      userAgent: 'FuntasticSaaS/1.0',
      ip: await this.getLoginIp(),
      device: 'Third Party',
      oe: 'utf-8',
      om: 'json',
    })

    const { errorCode, errorMessage } = this.getApiError(response)
    const sessionId = response.domeggook?.sId
      ?? response.domeggook?.sid
      ?? response.domeggook?.sessionId
      ?? response.sId
      ?? response.sid
      ?? response.sessionId
      ?? response.data?.sId
      ?? response.data?.sid
      ?? response.data?.sessionId

    if (sessionId) {
      this.resolvedSessionId = sessionId
      return sessionId
    }

    if (errorMessage || errorCode != null) {
      throw new MarketplaceAuthError('domeggook', `${errorCode ? `[${errorCode}] ` : ''}${errorMessage ?? '도매꾹 로그인 API에서 sId를 받지 못했습니다.'}`)
    }

    throw new MarketplaceAuthError('domeggook', '도매꾹 로그인 API에서 sId를 받지 못했습니다.')
  }

  private getApiError(response: DomeggookLoginResponse | DomeggookListResponse<DomeggookOrder> | DomeggookOrderConfirmResponse): { errorCode?: string | number; errorMessage?: string } {
    return {
      errorCode: response.errors?.code ?? response.code ?? response.dcode,
      errorMessage: response.errors?.message ?? response.errors?.dmessage ?? response.message ?? response.dmessage,
    }
  }

  private containsOrderNo(value: DomeggookOrderConfirmResponse['success'], orderNo: string): boolean {
    if (value == null || value === '') return false
    if (typeof value === 'string' || typeof value === 'number') return String(value).replace(/^OR/i, '') === orderNo
    if (Array.isArray(value)) return value.some((item) => this.containsOrderNo(item, orderNo))
    return String(value.no ?? '').replace(/^OR/i, '') === orderNo
  }

  private async getLoginIp(): Promise<string> {
    if (this.resolvedLoginIp) return this.resolvedLoginIp
    try {
      const response = await fetch('https://api.ipify.org?format=json')
      const data = await response.json() as { ip?: string }
      if (data.ip) {
        this.resolvedLoginIp = data.ip
        return data.ip
      }
    } catch {
      // Domeggook requires this field. Fall back only if public IP lookup fails.
    }
    this.resolvedLoginIp = '127.0.0.1'
    return this.resolvedLoginIp
  }

  private normalizeOrder(order: DomeggookOrder): NormalizedOrder {
    const orderId = asString(order.orderNo) || order.orderUid || asString(order.itemNo)
    const marketplaceStatus = order.statusMode || order.status || '결제완료'
    const productName = order.itemTitle || order.item?.title || `도매꾹 주문 ${orderId}`
    const quantity = asNumber(order.orderQty) || 1
    const totalAmount = asNumber(order.pay?.payAmount) || asNumber(order.orderAmtPay) || asNumber(order.orderAmt) || asNumber(order.orderAmount)
    const buyerName = order.buyerInfo?.buyerName || order.consumer?.name || '-'
    const recipientName = order.consumer?.name || buyerName
    const buyerPhone = order.buyerInfo?.buyerMobile || order.buyerInfo?.buyerPhone
    const recipientPhone = order.consumer?.mobile || order.consumer?.phone || buyerPhone

    return {
      marketplaceOrderId: orderId,
      marketplaceId: 'domeggook',
      marketplaceStatus,
      status: mapStatus(marketplaceStatus),
      buyerName,
      buyerPhone: buyerPhone || undefined,
      recipientName,
      recipientPhone: recipientPhone || undefined,
      shippingAddress: {
        zipCode: order.consumer?.zipcode || order.buyerInfo?.buyerZipcode || '',
        address1: order.consumer?.address || order.buyerInfo?.buyerAddress || '',
      },
      items: [
        {
          marketplaceItemId: order.orderUid || orderId,
          productName,
          optionText: this.formatOptions(order),
          quantity,
          unitPrice: quantity > 0 ? totalAmount / quantity : totalAmount,
          sku: order.item?.itemCustomCode,
        },
      ],
      orderedAt: parseDomeggookDate(order.date || order.pay?.datePay),
      totalAmount,
      shippingType: order.delivery?.who || null,
      shippingFee: order.delivery?.fee != null ? asNumber(order.delivery.fee) : null,
      deliveryMessage: order.consumer?.deliReq || null,
      rawData: order as unknown as Record<string, unknown>,
    }
  }

  private formatOptions(order: DomeggookOrder): string | undefined {
    const options = ensureArray(order.selectOpt?.opt)
    const text = options
      .map((option) => option.name)
      .filter(Boolean)
      .join(' / ')
    return text || undefined
  }
}
