import type {
  InvoiceData,
  MarketplaceAdapter,
  MarketplaceConfig,
  NormalizedClaim,
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedProduct,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { createPlayautoEmpClient } from './client'
import type {
  PlayautoEmpListResponse,
  PlayautoEmpOrder,
  PlayautoEmpSenderResponse,
} from './types'

const PLAYAUTO_EMP_CONFIG: MarketplaceConfig = {
  id: 'playauto-emp',
  name: '플레이오토 EMP',
  authType: 'api_key',
  rateLimitPerSecond: 10,
  requiredCredentials: ['api_key'],
}

const ORDER_PAGE_SIZE = 100
const MAX_ORDER_PAGES = 100
const DEFAULT_STATES = ['신규주문', '주문확인']

const EMP_CARRIER_CODES: Record<string, string> = {
  CJGLS: 'T025',
  CJ: 'T025',
  HANJIN: 'T026',
  EPOST: 'T027',
  KGB: 'T028',
  LOGEN: 'T028',
  HYUNDAI: 'T029',
  LOTTE: 'T029',
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return ''
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value.replaceAll(',', '').trim())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function parseDate(value: unknown): Date {
  const raw = asString(value)
  if (!raw || raw.startsWith('0001-01-01')) return new Date()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(`${raw.replace(' ', 'T')}+09:00`)
  }
  if (/^\d{8}$/.test(raw)) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00+09:00`)
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function responseOrders(response: PlayautoEmpListResponse): PlayautoEmpOrder[] {
  if (Array.isArray(response)) return response

  const keyed = response as Record<string, unknown>
  const candidates = [
    response.data,
    response.list,
    response.orders,
    response.result,
    response.rows,
    keyed['정상응답'],
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as { list?: PlayautoEmpOrder[]; orders?: PlayautoEmpOrder[] }
      if (Array.isArray(nested.list)) return nested.list
      if (Array.isArray(nested.orders)) return nested.orders
      if ('OrderCode' in candidate || 'Number' in candidate) return [candidate as PlayautoEmpOrder]
    }
  }

  return []
}

function mapOrderStatus(orderState: string): NormalizedOrder['status'] {
  const state = orderState.replace(/\s+/g, '')
  if (state.includes('취소')) return 'cancelled'
  if (state.includes('반품') || state.includes('교환')) return 'cancelled'
  if (state.includes('수취확인') || state.includes('정산완료')) return 'delivered'
  if (state.includes('배송중') || state.includes('출고')) return 'shipped'
  if (state.includes('송장')) return 'ready'
  if (state.includes('주문확인')) return 'confirmed'
  return 'new'
}

function appendMallParams(params: URLSearchParams, malls: string): void {
  const entries = malls
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  entries.forEach((entry, index) => {
    params.append(`malls[${index}]`, entry)
  })
}

function isSuccessfulSenderResponse(response: PlayautoEmpSenderResponse): boolean {
  if (Array.isArray(response.data)) return response.data.every(isSuccessfulSenderResponse)
  if (Array.isArray(response.result)) return response.result.every(isSuccessfulSenderResponse)

  const status = response.status
  if (status === true) return true
  if (typeof status === 'string') {
    const normalized = status.toLowerCase()
    if (['true', 'success', 'ok', '1'].includes(normalized)) return true
    if (['false', 'fail', 'failed', '0'].includes(normalized)) return false
  }

  const message = asString(response.msg ?? response.message)
  if (message.includes('성공')) return true
  if (response.error || message.includes('실패')) return false
  return true
}

function responseMessage(response: PlayautoEmpSenderResponse): string {
  return asString(response.msg ?? response.message ?? response.error) || JSON.stringify(response).slice(0, 500)
}

export class PlayautoEmpAdapter implements MarketplaceAdapter {
  readonly config = PLAYAUTO_EMP_CONFIG

  private readonly client: ReturnType<typeof createPlayautoEmpClient>
  private readonly malls?: string
  private readonly states: string[]

  constructor(credentials: { api_key: string; base_url?: string; malls?: string; states?: string }) {
    this.client = createPlayautoEmpClient(credentials)
    this.malls = credentials.malls?.trim() || undefined
    this.states = (credentials.states?.trim() || DEFAULT_STATES.join(','))
      .split(',')
      .map((state) => state.trim())
      .filter(Boolean)
  }

  async testConnection(): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      await this.client.get('orders/count', {
        searchParams: {
          startDate: formatDate(new Date()),
          endDate: formatDate(new Date()),
          count: '1',
        },
      }).json()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    const result = await this.testConnection()
    if (!result.success) throw new MarketplaceAuthError('playauto-emp', result.error ?? 'EMP authentication failed')
    return { success: true }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    try {
      const orders: PlayautoEmpOrder[] = []

      for (const state of this.states) {
        for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
          const params = new URLSearchParams({
            states: state,
            startDate: formatDate(since),
            endDate: formatDate(until),
            page: String(page),
            count: String(ORDER_PAGE_SIZE),
          })
          if (this.malls) appendMallParams(params, this.malls)

          const response = await this.client.get('orders/', { searchParams: params }).json<PlayautoEmpListResponse>()
          if (!Array.isArray(response) && response.success === false) {
            throw new MarketplaceApiError('playauto-emp', 400, response.message || response.msg || response.error || 'Failed to fetch EMP orders')
          }

          const pageOrders = responseOrders(response)
          orders.push(...pageOrders)
          if (pageOrders.length < ORDER_PAGE_SIZE) break
        }
      }

      return orders.map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('playauto-emp', 'EMP API key authentication failed')
      }
      throw new MarketplaceApiError('playauto-emp', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    const rawData = invoice.rawData && typeof invoice.rawData === 'object'
      ? invoice.rawData as Record<string, unknown>
      : {}
    const empNumber = asString(rawData.empNumber ?? rawData.Number ?? rawData.number)
    const number = empNumber || orderId
    const sender = asString(invoice.empCarrierCode) || EMP_CARRIER_CODES[invoice.carrierId] || invoice.carrierId

    try {
      const response = await this.client.patch('senders', {
        json: {
          changeState: true,
          overWrite: true,
          data: [
            {
              number,
              sender,
              senderno: invoice.trackingNumber,
            },
          ],
        },
      }).json<PlayautoEmpSenderResponse>()

      if (!isSuccessfulSenderResponse(response)) {
        return { success: false, error: responseMessage(response) }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async confirmOrder(): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    return { success: false, error: 'EMP product registration is not wired yet.' }
  }

  async updateProduct(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'EMP product update is not wired yet.' }
  }

  private normalizeOrder(order: PlayautoEmpOrder): NormalizedOrder {
    const orderCode = asString(order.OrderCode) || asString(order.UniqueId) || asString(order.Number)
    const number = asString(order.Number)
    const itemId = number || asString(order.UniqueId) || asString(order.ProdCode) || orderCode
    const quantity = Math.max(1, asNumber(order.Count) || 1)
    const totalAmount = asNumber(order.Price) * quantity
    const buyerName = asString(order.OrderName) || '-'
    const recipientName = asString(order.RecipientName) || buyerName
    const marketplaceStatus = asString(order.OrderState) || '신규주문'
    const optionText = [order.Option, order.PlusOption].map(asString).filter(Boolean).join(' / ')

    const item: NormalizedOrderItem = {
      marketplaceItemId: itemId,
      productName: asString(order.ProdName) || 'EMP 상품',
      optionText: optionText || undefined,
      quantity,
      unitPrice: asNumber(order.Price),
      sku: asString(order.Sku_code ?? order.SellerCode ?? order.ProdCode) || undefined,
    }

    return {
      marketplaceOrderId: orderCode,
      marketplaceId: 'playauto-emp',
      marketplaceStatus,
      status: mapOrderStatus(marketplaceStatus),
      buyerName,
      buyerPhone: asString(order.OrderTel) || undefined,
      buyerPhone2: asString(order.OrderHtel) || undefined,
      recipientName,
      recipientPhone: asString(order.RecipientTel) || undefined,
      recipientPhone2: asString(order.RecipientHtel) || undefined,
      shippingAddress: {
        zipCode: asString(order.RecipientZip),
        address1: asString(order.RecipientAddress),
      },
      items: [item],
      orderedAt: parseDate(order.OrderDate || order.CashDate || order.WriteDate),
      totalAmount,
      shippingType: asString(order.DelivMethod) || null,
      shippingFee: asNumber(order.DelivPrice),
      deliveryMessage: asString(order.Msg) || null,
      rawData: {
        ...order,
        empNumber: number,
        empSiteCode: order.SiteCode,
        empSiteName: order.SiteName,
        empSiteId: order.SiteId,
        originalMarketplaceId: `${asString(order.SiteCode)}:${asString(order.SiteId)}`,
        marketplaceOrderIdentity: {
          orderId: orderCode,
          itemIds: [itemId],
        },
      },
    }
  }
}
