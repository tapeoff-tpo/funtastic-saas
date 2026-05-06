/**
 * TenByTen (텐바이텐) marketplace adapter.
 *
 * API base: https://api.10x10.co.kr/v2/
 * Auth: Authorization: bearer {api_key}
 * Required credentials: api_key, shop_id (brandId)
 *
 * Spec captured 2026-04-29 from https://api.10x10.co.kr/document/index.html
 */

import ky from 'ky'
import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedOrderItem,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError } from '../../errors'

const TENBYTEN_CONFIG: MarketplaceConfig = {
  id: '10x10',
  name: '텐바이텐',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'shop_id'],
}

const BASE_URL = 'https://api.10x10.co.kr/v2'

/** Common envelope wrapping every 10x10 response */
interface TenByTenEnvelope<T> {
  hasError: boolean
  hasAlert: boolean
  message: string
  code: string
  inputValue?: string
  outPutValue: T
}

interface OrdersListResponse {
  TotalCount: number
  datas: OrderMaster[]
}

interface OrderMaster {
  OrderSerial: string
  OrderDivision?: string
  UserId?: string
  AccountDivision?: string
  AccountNumber?: string
  /** 0:대기 1:실패 2:접수 4:결제완료 5:주문통보 6:상품준비 7:일부출고 8:상품출고 */
  orderState?: string
  depositDate?: string
  orderDate?: string
  ordererName?: string
  ordererPhone?: string
  ordererCellPhone?: string
  ordererEmail?: string
  receiverName?: string
  receiverPhone?: string
  receiverCellPhone?: string
  receiverZipCode?: string
  receiverAddress?: string
  receiverAddressDetail?: string
  orderComment?: string
  shippingPrice?: number
  flowerdate?: string
  flowertime?: string
  cardribbon?: string
  flowermessage?: string
  flowername?: string
  customernumber?: string
  OrderCancel?: string
  details?: OrderDetail[]
}

interface OrderDetail {
  DetailIdx: number
  itemId: number
  itemName?: string
  itemOption?: string
  itemOptionName?: string
  quantity: number
  VendorItemId?: string
  BrandId?: string
  /** 2:업체통보 3:상품준비 7:출고완료 */
  DetailOrderState?: string
  RequireMemo?: string
  OrgItemPrice?: number
  NotCouponPrice?: number
  Price?: number
  BonusCouponPlusPrice?: number
  EtcSalePrice?: number
  buycash?: number
  OrderCancel?: string
}

interface OrderCancelItem {
  OrderSerial: string
  DetailIdx: string
  cancel?: number
  orderqty?: number
  itemId?: string
  RegDate?: string
  FinishDate?: string | null
  itemoption?: string
  itemoptionname?: string
  BrandId?: string
  CsId: number
  currentStatus?: string
}

interface ClaimItem {
  OrderSerial: string
  DetailIdx: string
  CsId: number
  RegDate?: string
  FinishDate?: string | null
  cancel?: number
  itemId?: string
  itemName?: string
  itemoption?: string
  itemoptionname?: string
  BrandId?: string
  CurrentStatus?: string
  Reason?: string
  [key: string]: unknown
}

function fmtDate(d: Date): string {
  // 10x10 expects KST wall-clock time as YYYY-MM-DD HH:mm:ss.
  // Railway hosts can run in UTC, which would otherwise miss same-day Korean orders.
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const yyyy = kst.getUTCFullYear()
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kst.getUTCDate()).padStart(2, '0')
  const hh = String(kst.getUTCHours()).padStart(2, '0')
  const mi = String(kst.getUTCMinutes()).padStart(2, '0')
  const ss = String(kst.getUTCSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

function parseTenByTenDate(s: string | null | undefined): Date {
  if (!s) return new Date()
  // formats: "2023-09-12 21:59" or "2023-09-12 21:59:00"
  const iso = s.replace(' ', 'T') + (s.length === 16 ? ':00' : '') + '+09:00'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? new Date() : d
}

async function toTenByTenApiError(action: string, error: unknown): Promise<MarketplaceApiError> {
  if (error instanceof Error && 'response' in error) {
    const response = (error as { response: Response }).response
    const body = await response.text().catch(() => '')
    const detail = body ? `: ${body.slice(0, 500)}` : ''
    return new MarketplaceApiError(
      '10x10',
      response.status,
      `${action} failed: ${response.status} ${response.statusText}${detail}`,
    )
  }

  return new MarketplaceApiError(
    '10x10',
    500,
    `${action} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
  )
}

/**
 * Map 10x10 orderState → our OrderStatus.
 * - 5(주문통보), 6(상품준비) → 'new'
 * - 7(일부출고), 8(상품출고) → 'shipped'
 */
function mapOrderStatus(state: string | undefined): NormalizedOrder['status'] {
  switch (state) {
    case '5':
    case '6':
      return 'new'
    case '7':
    case '8':
      return 'shipped'
    default:
      return 'new'
  }
}

function mapClaimStatus(
  current: string | undefined,
  finishDate: string | null | undefined,
): NormalizedClaim['claimStatus'] {
  if (finishDate) return 'completed'
  if (!current) return 'requested'
  if (/완료/.test(current)) return 'completed'
  if (/처리|진행/.test(current)) return 'processing'
  if (/거부|반려|불가/.test(current)) return 'rejected'
  return 'requested'
}

export class TenByTenAdapter implements MarketplaceAdapter {
  readonly config = TENBYTEN_CONFIG
  private credentials?: MarketplaceCredentials

  constructor(credentials?: MarketplaceCredentials) {
    this.credentials = credentials
  }

  private getCreds(passed?: MarketplaceCredentials): MarketplaceCredentials {
    const c = passed ?? this.credentials
    if (!c) throw new MarketplaceApiError('10x10', 401, 'Credentials not provided')
    if (!c.api_key) throw new MarketplaceApiError('10x10', 401, 'api_key missing')
    return c
  }

  private client(creds: MarketplaceCredentials) {
    return ky.create({
      prefixUrl: BASE_URL,
      headers: {
        Authorization: `bearer ${creds.api_key}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      retry: { limit: 2, methods: ['get'], statusCodes: [408, 429, 500, 502, 503, 504] },
    })
  }

  async testConnection(
    credentials?: MarketplaceCredentials,
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      const creds = this.getCreds(credentials)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const search = new URLSearchParams({
        startdate: fmtDate(since),
        enddate: fmtDate(new Date()),
      })
      if (creds.shop_id) search.set('brandId', String(creds.shop_id))

      // Do not call `orders` here. 10x10's new-order endpoint confirms
      // orders as a side effect, so a credential test must use the read-only
      // history endpoint.
      const env = await this.client(creds)
        .get(`orders/orderhistory?${search.toString()}`)
        .json<TenByTenEnvelope<OrdersListResponse>>()

      if (env.hasError) return { success: false, error: env.message || 'API returned error' }
      return { success: true }
    } catch (e) {
      const error = await toTenByTenApiError('testConnection', e)
      return { success: false, error: error.message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    const r = await this.testConnection()
    return { success: r.success }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    const confirmedBeforeResult = await Promise.resolve()
      .then(() => this.fetchOrderList('orders/orderhistory', since))
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      )

    // 10x10 `orders` is not a pure read: their docs note that new-order
    // inquiry simultaneously confirms the order. Fetch history again after
    // this call so orders moved by the side effect can still be saved locally.
    const newOrdersResult = await Promise.resolve()
      .then(() => this.fetchOrderList('orders', since))
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      )

    const confirmedAfterResult = await Promise.resolve()
      .then(() => this.fetchOrderList('orders/orderhistory', since))
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      )

    const failures = [confirmedBeforeResult, newOrdersResult, confirmedAfterResult].filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (failures.length === 3) {
      const message = failures
        .map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
        .join('; ')
      throw new MarketplaceApiError('10x10', 500, message || 'getOrders failed')
    }

    const confirmedBefore = confirmedBeforeResult.status === 'fulfilled' ? confirmedBeforeResult.value : []
    const newOrders = newOrdersResult.status === 'fulfilled' ? newOrdersResult.value : []
    const confirmedAfter = confirmedAfterResult.status === 'fulfilled'
      ? confirmedAfterResult.value
      : []

    const byOrderSerial = new Map<string, OrderMaster>()
    for (const order of [...confirmedBefore, ...newOrders, ...confirmedAfter]) {
      if (order.OrderSerial) {
        byOrderSerial.set(order.OrderSerial, order)
      }
    }

    return Array.from(byOrderSerial.values()).map((o) => this.toNormalizedOrder(o))
  }

  private async fetchOrderList(path: 'orders' | 'orders/orderhistory', since: Date): Promise<OrderMaster[]> {
    const creds = this.getCreds()
    const withBrandId = await this.fetchOrderListWithBrandOption(path, since, true)
    if (withBrandId.length > 0 || !creds.shop_id) return withBrandId

    return this.fetchOrderListWithBrandOption(path, since, false)
  }

  private async fetchOrderListWithBrandOption(
    path: 'orders' | 'orders/orderhistory',
    since: Date,
    includeBrandId: boolean,
  ): Promise<OrderMaster[]> {
    const creds = this.getCreds()
    const search = new URLSearchParams({
      startdate: fmtDate(since),
      enddate: fmtDate(new Date()),
    })
    if (includeBrandId && creds.shop_id) search.set('brandId', String(creds.shop_id))

    let env: TenByTenEnvelope<OrdersListResponse>
    try {
      env = await this.client(creds)
        .get(`${path}?${search.toString()}`)
        .json<TenByTenEnvelope<OrdersListResponse>>()
    } catch (error) {
      throw await toTenByTenApiError(path, error)
    }

    if (env.hasError) {
      throw new MarketplaceApiError('10x10', 500, env.message || `${path} failed`)
    }

    return env.outPutValue?.datas ?? []
  }

  private toNormalizedOrder(o: OrderMaster): NormalizedOrder {
    const items: NormalizedOrderItem[] = (o.details ?? []).map((d) => ({
      marketplaceItemId: String(d.itemId),
      productName: d.itemName ?? '',
      optionText: d.itemOptionName || d.itemOption || undefined,
      quantity: d.quantity ?? 1,
      unitPrice: Number(d.Price ?? d.OrgItemPrice ?? 0),
      sku: d.VendorItemId || undefined,
    }))

    const totalAmount = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0)

    return {
      marketplaceOrderId: o.OrderSerial,
      marketplaceId: '10x10',
      marketplaceStatus: o.orderState ?? '',
      status: mapOrderStatus(o.orderState),
      buyerName: o.ordererName ?? '',
      buyerPhone: o.ordererPhone || undefined,
      buyerPhone2: o.ordererCellPhone || undefined,
      recipientName: o.receiverName ?? o.ordererName ?? '',
      recipientPhone: o.receiverPhone || undefined,
      recipientPhone2: o.receiverCellPhone || undefined,
      shippingAddress: {
        zipCode: o.receiverZipCode ?? '',
        address1: o.receiverAddress ?? '',
        address2: o.receiverAddressDetail || undefined,
      },
      items,
      orderedAt: parseTenByTenDate(o.orderDate),
      totalAmount,
      shippingFee: o.shippingPrice ?? null,
      shippingType: null,
      deliveryMessage: o.orderComment ?? null,
      rawData: o as unknown as Record<string, unknown>,
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const creds = this.getCreds()
    const baseQs = new URLSearchParams({
      startdate: fmtDate(since),
      enddate: fmtDate(new Date()),
    })
    if (creds.shop_id) baseQs.set('brandId', String(creds.shop_id))

    const client = this.client(creds)
    const claims: NormalizedClaim[] = []

    // 1. cancels — GET /v2/orders/ordercancel (7-day window per spec)
    try {
      const env = await client
        .get(`orders/ordercancel?${baseQs.toString()}`)
        .json<TenByTenEnvelope<OrderCancelItem[]>>()
      if (!env.hasError && Array.isArray(env.outPutValue)) {
        for (const c of env.outPutValue) {
          claims.push({
            marketplaceClaimId: `cancel-${c.CsId}`,
            marketplaceId: '10x10',
            marketplaceOrderId: c.OrderSerial,
            claimType: 'cancel',
            claimStatus: mapClaimStatus(c.currentStatus, c.FinishDate),
            reason: c.itemoptionname || undefined,
            requestedAt: parseTenByTenDate(c.RegDate),
            rawData: c as unknown as Record<string, unknown>,
          })
        }
      }
    } catch {
      /* swallow — try other claim types */
    }

    // 2. returns — GET /v2/retruns/lists (typo "retruns" matches official spec)
    try {
      const env = await client
        .get(`retruns/lists?${baseQs.toString()}`)
        .json<TenByTenEnvelope<ClaimItem[]>>()
      if (!env.hasError && Array.isArray(env.outPutValue)) {
        for (const r of env.outPutValue) {
          claims.push({
            marketplaceClaimId: `return-${r.CsId}`,
            marketplaceId: '10x10',
            marketplaceOrderId: r.OrderSerial,
            claimType: 'return',
            claimStatus: mapClaimStatus(r.CurrentStatus, r.FinishDate),
            reason: r.Reason || r.itemoptionname || undefined,
            requestedAt: parseTenByTenDate(r.RegDate),
            rawData: r as unknown as Record<string, unknown>,
          })
        }
      }
    } catch {
      /* swallow */
    }

    // 3. exchanges — GET /v2/exchange/lists
    try {
      const env = await client
        .get(`exchange/lists?${baseQs.toString()}`)
        .json<TenByTenEnvelope<ClaimItem[]>>()
      if (!env.hasError && Array.isArray(env.outPutValue)) {
        for (const r of env.outPutValue) {
          claims.push({
            marketplaceClaimId: `exchange-${r.CsId}`,
            marketplaceId: '10x10',
            marketplaceOrderId: r.OrderSerial,
            claimType: 'exchange',
            claimStatus: mapClaimStatus(r.CurrentStatus, r.FinishDate),
            reason: r.Reason || r.itemoptionname || undefined,
            requestedAt: parseTenByTenDate(r.RegDate),
            rawData: r as unknown as Record<string, unknown>,
          })
        }
      }
    } catch {
      /* swallow */
    }

    return claims
  }

  async uploadInvoice(
    orderId: string,
    invoice: InvoiceData,
  ): Promise<{ success: boolean; error?: string }> {
    const creds = this.getCreds()
    // 10x10 송장입력 requires `detailIdx` (per-line) in addition to orderSerial.
    // Caller passes it via the loose `[key: string]: unknown` field of InvoiceData.
    const detailIdx = (invoice as Record<string, unknown>).detailIdx as
      | string
      | number
      | undefined
    if (!detailIdx) {
      return {
        success: false,
        error: 'detailIdx required for 10x10 — pass via InvoiceData.detailIdx',
      }
    }

    try {
      const env = await this.client(creds)
        .post('orders/orderconfirm', {
          json: {
            orderSerial: orderId,
            detailIdx: String(detailIdx),
            songjangDiv: invoice.carrierId,
            songjangNo: invoice.trackingNumber,
          },
        })
        .json<TenByTenEnvelope<unknown>>()
      if (env.hasError) return { success: false, error: env.message || 'uploadInvoice failed' }
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  }

  async confirmOrder(
    _marketplaceOrderId: string,
    _rawData?: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    // 10x10 auto-confirms on getOrders ("신규주문조회 ... 동시에 주문 확인이 됩니다")
    return { success: true }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    throw new MarketplaceApiError('10x10', 501, 'getProducts not yet implemented')
  }

  async registerProduct(
    _product: NormalizedProduct,
  ): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    throw new MarketplaceApiError('10x10', 501, 'registerProduct not yet implemented')
  }

  async updateProduct(
    _marketplaceProductId: string,
    _product: Partial<NormalizedProduct>,
  ): Promise<{ success: boolean; error?: string }> {
    throw new MarketplaceApiError('10x10', 501, 'updateProduct not yet implemented')
  }
}
