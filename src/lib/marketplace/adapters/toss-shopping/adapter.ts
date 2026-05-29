import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { createTossShoppingClient } from './client'
import { mapTossShoppingStatus } from './status-map'
import type {
  TossShoppingApiResponse,
  TossShoppingOrderProduct,
  TossShoppingOrdersResponse,
  TossShoppingStatusChangeResponse,
} from './types'

const TOSS_SHOPPING_CONFIG: MarketplaceConfig = {
  id: 'toss-shopping',
  name: '토스쇼핑',
  authType: 'oauth2',
  rateLimitPerSecond: 50,
  requiredCredentials: ['access_key', 'secret_key'],
}

const PARTNER_NAME = 'funtastic-saas'

const TOSS_DELIVERY_COMPANY_MAP: Record<string, string> = {
  CJGLS: 'CJ대한통운',
  HANJIN: '한진택배',
  HYUNDAI: '롯데택배',
  EPOST: '우체국택배',
  KGB: '로젠택배',
  KDEXP: '경동택배',
  CHUNIL: '천일택배',
  DAESIN: '대신택배',
  ILYANG: '일양로지스',
  CVSNET: 'GS25편의점택배',
  ETC: '직접전달',
}

function ymdKst(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const yyyy = kst.getUTCFullYear()
  const MM = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kst.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${MM}-${dd}`
}

function parseTossDate(value: string): Date {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value)
  return new Date(`${value}+09:00`)
}

function tossErrorMessage(error?: { errorCode?: string; reason?: string } | null): string {
  if (!error) return 'Unknown Toss Shopping API error'
  return [error.errorCode, error.reason].filter(Boolean).join(': ') || 'Unknown Toss Shopping API error'
}

function ensureSuccess<T>(response: TossShoppingApiResponse<T>, method: string): T {
  if (response.resultType === 'FAIL') {
    throw new MarketplaceApiError('toss-shopping', 200, `${method}: ${tossErrorMessage(response.error)}`)
  }
  if (!response.success) {
    throw new MarketplaceApiError('toss-shopping', 200, `${method}: response.success missing`)
  }
  return response.success
}

export class TossShoppingAdapter implements MarketplaceAdapter {
  readonly config = TOSS_SHOPPING_CONFIG

  private readonly tossClient: ReturnType<typeof createTossShoppingClient>

  constructor(credentials: { access_key: string; secret_key: string }) {
    this.tossClient = createTossShoppingClient(credentials.access_key, credentials.secret_key)
  }

  async testConnection(): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      await this.tossClient.getToken()
      const state = this.tossClient.getState()
      return {
        success: true,
        expiresAt: state.tokenExpiresAt ? new Date(state.tokenExpiresAt) : undefined,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    try {
      await this.tossClient.getToken()
      const state = this.tossClient.getState()
      return {
        success: true,
        expiresAt: state.tokenExpiresAt ? new Date(state.tokenExpiresAt) : undefined,
      }
    } catch (error) {
      if (error instanceof MarketplaceAuthError) throw error
      throw new MarketplaceAuthError('toss-shopping', error instanceof Error ? error.message : 'Authentication failed')
    }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    const orderProducts: TossShoppingOrderProduct[] = []
    let nextCursor: string | undefined

    try {
      do {
        const searchParams: Record<string, string | number> = {
          startDate: ymdKst(since),
          endDate: ymdKst(until),
          limit: 50,
          partnerName: PARTNER_NAME,
        }
        if (nextCursor) searchParams.nextCursor = nextCursor

        const response = await this.tossClient.client
          .get('api/v3/shopping-fep/orders/v2', { searchParams })
          .json<TossShoppingApiResponse<TossShoppingOrdersResponse>>()
        const success = ensureSuccess(response, 'getOrders')
        orderProducts.push(...(success.results ?? []))
        nextCursor = success.nextCursor ?? undefined
      } while (nextCursor)

      return this.normalizeOrderProducts(
        orderProducts.filter((product) => product.orderProductStatus === 'PAID'),
      )
    } catch (error) {
      if (error instanceof MarketplaceApiError || error instanceof MarketplaceAuthError) throw error
      throw new MarketplaceApiError('toss-shopping', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return []
  }

  async confirmOrder(
    marketplaceOrderId: string,
    rawData?: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    const orderProductIds = this.extractOrderProductIds(rawData)
    if (orderProductIds.length === 0) {
      return { success: false, error: `No orderProductIds for Toss order ${marketplaceOrderId}` }
    }

    try {
      const response = await this.tossClient.client
        .put('api/v3/shopping-fep/orders/products/status', {
          json: {
            orderProductIds,
            status: 'PREPARING_PRODUCT',
            partnerName: PARTNER_NAME,
          },
        })
        .json<TossShoppingApiResponse<TossShoppingStatusChangeResponse>>()
      const success = ensureSuccess(response, 'confirmOrder')
      if ((success.failedCount ?? 0) > 0) {
        return { success: false, error: success.failedReasons?.join('; ') || 'Toss status change partially failed' }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async uploadInvoice(_orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    const rawData = invoice.rawData as Record<string, unknown> | undefined
    const orderProductIds = this.extractOrderProductIds(rawData)
    if (orderProductIds.length === 0) {
      return { success: false, error: 'No Toss orderProductIds in order rawData' }
    }

    try {
      const deliveryCompany = TOSS_DELIVERY_COMPANY_MAP[invoice.carrierId] ?? invoice.carrierId
      for (const orderProductId of orderProductIds) {
        const response = await this.tossClient.client
          .put('api/v3/shopping-fep/orders/products/delivery', {
            json: {
              orderProductId,
              deliveryCompany,
              trackingNumber: invoice.trackingNumber,
              partnerName: PARTNER_NAME,
            },
          })
          .json<TossShoppingApiResponse<Record<string, never>>>()
        ensureSuccess(response, 'uploadInvoice')
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(
    _product: NormalizedProduct,
  ): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    return { success: false, error: 'Toss Shopping product registration not implemented yet' }
  }

  async updateProduct(
    _marketplaceProductId: string,
    _product: Partial<NormalizedProduct>,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Toss Shopping product update not implemented yet' }
  }

  private normalizeOrderProducts(products: TossShoppingOrderProduct[]): NormalizedOrder[] {
    const groups = new Map<string, TossShoppingOrderProduct[]>()
    for (const product of products) {
      const orderId = String(product.orderId)
      const group = groups.get(orderId) ?? []
      group.push(product)
      groups.set(orderId, group)
    }

    return [...groups.values()].map((group) => this.normalizeOrderGroup(group))
  }

  private normalizeOrderGroup(group: TossShoppingOrderProduct[]): NormalizedOrder {
    const first = group[0]
    const items = group.map((item) => ({
      marketplaceItemId: String(item.orderProductId),
      productName: item.productName || '',
      optionText: item.optionName || undefined,
      quantity: item.quantity ?? 1,
      unitPrice: item.price ?? 0,
      sku: item.productItemManagementCode || item.productManagementCode || undefined,
    }))
    const totalAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)

    return {
      marketplaceOrderId: String(first.orderId),
      marketplaceId: 'toss-shopping',
      marketplaceStatus: first.orderProductStatus,
      status: mapTossShoppingStatus(first.orderProductStatus),
      buyerName: first.ordererName || '',
      buyerPhone: first.ordererRealPhone || first.ordererPhone || undefined,
      recipientName: first.receiverName || '',
      recipientPhone: first.receiverRealPhone || first.receiverPhone || undefined,
      shippingAddress: {
        zipCode: first.zipCode || '',
        address1: first.address || '',
        address2: first.detailAddress || undefined,
      },
      items,
      orderedAt: parseTossDate(first.orderedAt),
      totalAmount,
      shippingFee: group.reduce((sum, item) => sum + (item.deliveryFee ?? 0), 0),
      deliveryMessage: first.shippingNote || undefined,
      rawData: {
        ...first,
        orderProducts: group,
        orderProductIds: group.map((item) => String(item.orderProductId)),
      },
    }
  }

  private extractOrderProductIds(rawData?: Record<string, unknown>): Array<string | number> {
    const ids = rawData?.orderProductIds
    if (Array.isArray(ids)) {
      return ids.filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
    }

    const orderProducts = rawData?.orderProducts
    if (Array.isArray(orderProducts)) {
      return orderProducts
        .map((item) => (item as { orderProductId?: string | number }).orderProductId)
        .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
    }

    const identity = rawData?.orderIdentity as { itemIds?: unknown[] } | undefined
    return (identity?.itemIds ?? [])
      .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
  }
}
