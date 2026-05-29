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
import type {
  DomeggookListResponse,
  DomeggookLoginResponse,
  DomeggookOrder,
  DomeggookOrderConfirmResponse,
  DomeggookOrderDetailResponse,
} from './types'

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

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = asString(value).trim()
    if (text) return text
  }
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
    const item = (value as { item?: T | T[] }).item
    if (!item) return []
    return Array.isArray(item) ? item : [item]
  }
  return [value as T]
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

function orderLineKey(order: DomeggookOrder): string {
  const lineId = firstText(order.orderUid, order.itemNo, order.item?.no)
  return [orderKey(order), lineId, JSON.stringify(order.selectOpt ?? {})].filter(Boolean).join(':')
}

function firstOrder(response: DomeggookOrderDetailResponse<DomeggookOrder>): DomeggookOrder | null {
  return ensureArray(response.domeggook?.items ?? response.items)[0] ?? null
}

function mergeOrderDetail(order: DomeggookOrder, detail: DomeggookOrder): DomeggookOrder {
  return {
    ...order,
    ...detail,
    item: {
      ...order.item,
      ...detail.item,
    },
    pay: {
      ...order.pay,
      ...detail.pay,
    },
    buyerInfo: {
      ...order.buyerInfo,
      ...detail.buyerInfo,
    },
    consumer: {
      ...order.consumer,
      ...detail.consumer,
    },
    delivery: {
      ...order.delivery,
      ...detail.delivery,
    },
    selectOpt: {
      ...order.selectOpt,
      ...detail.selectOpt,
    },
  }
}

function toDomeggookOrderNo(marketplaceOrderId: string): string {
  return marketplaceOrderId.replace(/^OR/i, '')
}

function formatDomeggookApiError(
  errorCode: string | number | undefined,
  errorMessage: string | undefined,
  operation: string,
): string {
  const base = `${errorCode != null ? `[${errorCode}] ` : ''}${errorMessage ?? `도매꾹 ${operation} API 오류`}`
  if (String(errorCode) !== '113') return base

  return `${base} 도매꾹 Private API 권한(${operation}) 승인 여부와 저장된 회원 ID/로그인 비밀번호를 확인해주세요.`
}

export class DomeggookAdapter implements MarketplaceAdapter {
  readonly config = DOMEGGOOK_CONFIG

  private readonly client: ReturnType<typeof createDomeggookClient>
  private readonly apiKey: string
  private readonly sellerId: string
  private readonly sessionSecret: string
  private resolvedSessionId?: string
  private resolvingSessionId?: Promise<string>
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
      const uniqueOrderLines = new Map<string, DomeggookOrder>()

      for (const order of sliceOrders.flat()) {
        const key = orderLineKey(order)
        if (key) uniqueOrderLines.set(key, order)
      }

      const enrichedOrders = await Promise.all(
        Array.from(uniqueOrderLines.values()).map((order) => this.enrichOrderDetail(order)),
      )

      const groupedOrders = new Map<string, DomeggookOrder[]>()
      for (const order of enrichedOrders) {
        const key = orderKey(order)
        const group = groupedOrders.get(key) ?? []
        group.push(order)
        groupedOrders.set(key, group)
      }

      return Array.from(groupedOrders.values()).map((orders) => this.normalizeOrderGroup(orders))
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
        return { success: false, error: formatDomeggookApiError(errorCode, errorMessage, '발주처리') }
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

  private async enrichOrderDetail(order: DomeggookOrder): Promise<DomeggookOrder> {
    const orderNo = toDomeggookOrderNo(orderKey(order))
    if (!orderNo) return order

    try {
      const response = await readDomeggookJson<DomeggookOrderDetailResponse<DomeggookOrder>>(this.client, {
        ver: '2.0',
        mode: 'getOrderList',
        aid: this.apiKey,
        id: this.sellerId,
        sId: await this.getSessionId(),
        day: DOMEGGOOK_MAX_LOOKBACK_DAYS,
        for: 'sell',
        view: 'detail',
        no: orderNo,
        pg: 1,
        ic: 1,
        oe: 'utf-8',
        om: 'json',
      })

      const { errorCode, errorMessage } = this.getApiError(response)
      if (errorMessage || (errorCode != null && String(errorCode) !== '0')) {
        return order
      }

      const detail = firstOrder(response)
      return detail ? mergeOrderDetail(order, detail) : order
    } catch {
      return order
    }
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
      throw new MarketplaceApiError('domeggook', 400, formatDomeggookApiError(errorCode, errorMessage, '판매 주문서 조회'))
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
    if (this.resolvingSessionId) return this.resolvingSessionId

    this.resolvingSessionId = (async () => {
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
        throw new MarketplaceAuthError('domeggook', formatDomeggookApiError(errorCode, errorMessage, '로그인'))
      }

      throw new MarketplaceAuthError('domeggook', '도매꾹 로그인 API에서 sId를 받지 못했습니다.')
    })()

    try {
      return await this.resolvingSessionId
    } finally {
      this.resolvingSessionId = undefined
    }
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

  private normalizeOrderGroup(group: DomeggookOrder[]): NormalizedOrder {
    const order = group[0]
    const orderId = asString(order.orderNo) || order.orderUid || asString(order.itemNo)
    const marketplaceStatus = order.statusMode || order.status || '寃곗젣?꾨즺'
    const shippingFee = order.delivery?.fee != null ? asNumber(order.delivery.fee) : 0
    const items = group.map((line) => this.normalizeOrderItem(line, orderId))
    const itemsAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    const totalAmount = asNumber(order.pay?.payAmount) || itemsAmount + shippingFee
    const buyerName = firstText(order.buyerInfo?.buyerName, order.consumer?.name, '-')
    const recipientName = order.consumer?.name || buyerName
    const buyerPhone = firstText(order.buyerInfo?.buyerMobile, order.buyerInfo?.buyerPhone)
    const recipientPhone = firstText(order.consumer?.mobile, order.consumer?.phone, buyerPhone)
    const itemIds = Array.from(new Set(group.flatMap((line) => [
      firstText(line.item?.itemCustomCode, line.item?.no, line.itemNo),
      asString(line.item?.no),
      asString(line.itemNo),
      line.orderUid,
    ]).filter(Boolean)))
    const rawData = {
      ...(order as unknown as Record<string, unknown>),
      orderLines: group,
      orderIdentity: {
        orderId,
        itemIds,
      },
    }

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
      items,
      orderedAt: parseDomeggookDate(order.date || order.pay?.datePay),
      totalAmount,
      shippingType: order.delivery?.who || null,
      shippingFee: order.delivery?.fee != null ? shippingFee : null,
      deliveryMessage: order.consumer?.deliReq || null,
      rawData,
    }
  }

  private normalizeOrderItem(order: DomeggookOrder, orderId: string): NormalizedOrder['items'][number] {
    const productName = order.itemTitle || order.item?.title || `?꾨ℓ袁?二쇰Ц ${orderId}`
    const quantity = asNumber(order.orderQty) || 1
    const itemAmount = asNumber(order.orderAmtPay) || asNumber(order.orderAmount) || asNumber(order.orderAmt)
    const productCode = firstText(order.item?.itemCustomCode, order.item?.no, order.itemNo)
    const itemIdentity = firstText(order.orderUid, productCode ? `${orderId}-${productCode}` : '', orderId)

    return {
      marketplaceItemId: itemIdentity,
      productName,
      optionText: this.formatOptions(order),
      quantity,
      unitPrice: quantity > 0 ? itemAmount / quantity : itemAmount,
      sku: productCode || undefined,
    }
  }

  private normalizeOrder(order: DomeggookOrder): NormalizedOrder {
    const orderId = asString(order.orderNo) || order.orderUid || asString(order.itemNo)
    const marketplaceStatus = order.statusMode || order.status || '결제완료'
    const productName = order.itemTitle || order.item?.title || `도매꾹 주문 ${orderId}`
    const quantity = asNumber(order.orderQty) || 1
    const shippingFee = order.delivery?.fee != null ? asNumber(order.delivery.fee) : 0
    const itemAmount = asNumber(order.orderAmtPay) || asNumber(order.orderAmount) || asNumber(order.orderAmt)
    const totalAmount = asNumber(order.pay?.payAmount) || itemAmount + shippingFee
    const buyerName = firstText(order.buyerInfo?.buyerName, order.consumer?.name, '-')
    const recipientName = order.consumer?.name || buyerName
    const buyerPhone = firstText(order.buyerInfo?.buyerMobile, order.buyerInfo?.buyerPhone)
    const recipientPhone = firstText(order.consumer?.mobile, order.consumer?.phone, buyerPhone)
    const productCode = firstText(order.item?.itemCustomCode, order.item?.no, order.itemNo)
    const itemIdentity = firstText(order.orderUid, productCode ? `${orderId}-${productCode}` : '', orderId)
    const rawData = {
      ...(order as unknown as Record<string, unknown>),
      orderIdentity: {
        orderId,
        itemIds: Array.from(new Set([productCode, asString(order.item?.no), asString(order.itemNo), order.orderUid].filter(Boolean))),
      },
    }

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
          marketplaceItemId: itemIdentity,
          productName,
          optionText: this.formatOptions(order),
          quantity,
          unitPrice: quantity > 0 ? itemAmount / quantity : itemAmount,
          sku: productCode || undefined,
        },
      ],
      orderedAt: parseDomeggookDate(order.date || order.pay?.datePay),
      totalAmount,
      shippingType: order.delivery?.who || null,
      shippingFee: order.delivery?.fee != null ? shippingFee : null,
      deliveryMessage: order.consumer?.deliReq || null,
      rawData,
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
