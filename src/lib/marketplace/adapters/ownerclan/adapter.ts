import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { getCarrierName, mapCarrierCode } from '@/lib/shipping/carrier-codes'
import { createOwnerclanClient } from './client'
import { mapOwnerclanStatus } from './status-map'
import type {
  OwnerclanAllOrdersResponse,
  OwnerclanOrder,
  OwnerclanOrderProduct,
} from './types'

const OWNERCLAN_CONFIG: MarketplaceConfig = {
  id: 'ownerclan',
  name: '오너클랜',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['username', 'password', 'vendor_id', 'vendor_password'],
}

const ORDER_FIELDS = `
  key
  id
  products {
    quantity
    price
    shippingType
    itemKey
    productName
    itemOptionInfo {
      optionAttributes {
        name
        value
      }
      price
    }
    trackingNumber
    shippingCompanyCode
    shippingCompanyName
    shippedDate
    additionalAttributes {
      key
      value
    }
    taxFree
  }
  status
  shippingInfo {
    sender {
      name
      phoneNumber
    }
    recipient {
      name
      phoneNumber
      destinationAddress {
        addr1
        addr2
        postalCode
      }
    }
    shippingFee
  }
  createdAt
  updatedAt
  ordererNote
  isBeingMediated
`

const ALL_ORDERS_QUERY = `
  query OwnerclanAllOrders($first: Int!, $after: String, $dateFrom: Timestamp, $dateTo: Timestamp, $status: OrderStatus) {
    allOrders(first: $first, after: $after, dateFrom: $dateFrom, dateTo: $dateTo, status: $status) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          ${ORDER_FIELDS}
        }
      }
    }
  }
`

const OWNERCLAN_PAGE_SIZE = 10
const OWNERCLAN_MAX_PAGES_PER_WINDOW = 10
const OWNERCLAN_WINDOW_MS = 24 * 60 * 60 * 1000
const OWNERCLAN_MIN_WINDOW_MS = 60 * 60 * 1000
const OWNERCLAN_COLLECTABLE_STATUSES = ['placed', 'paid'] as const

const CHECK_ORDER_MUTATION = `
  mutation OwnerclanCheckOrder($key: ID!) {
    checkOrder(key: $key) {
      key
      status
    }
  }
`

const SET_TRACKING_INFO_MUTATION = `
  mutation OwnerclanSetTrackingInfo($key: ID!, $input: TrackingInfoInput!) {
    setTrackingInfo(key: $key, input: $input) {
      key
      status
      products {
        trackingNumber
        shippingCompanyCode
        shippingCompanyName
        shippedDate
      }
    }
  }
`

function toOwnerclanTimestamp(date: Date): number {
  return date.getTime()
}

function fromUnixSeconds(value?: number | null): Date {
  if (!value) return new Date()
  return new Date(value > 10_000_000_000 ? value : value * 1000)
}

function asNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('timed out') || message.includes('timeout')
}

function buildOptionText(product: OwnerclanOrderProduct): string | undefined {
  const optionParts = product.itemOptionInfo?.optionAttributes
    ?.map((attr) => {
      const name = attr.name?.trim()
      const value = attr.value?.trim()
      if (!name && !value) return ''
      if (!name) return value ?? ''
      if (!value) return name
      return `${name}: ${value}`
    })
    .filter(Boolean) ?? []

  const additionalParts = product.additionalAttributes
    ?.map((attr) => {
      const name = attr.key?.trim()
      const value = attr.value?.trim()
      if (!name && !value) return ''
      if (!name) return value ?? ''
      if (!value) return name
      return `${name}: ${value}`
    })
    .filter(Boolean) ?? []

  const text = [...optionParts, ...additionalParts].join(' / ')
  return text || undefined
}

function normalizeTrackingNumber(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[^0-9A-Za-z]/g, '')
    : ''
}

function hasMatchingOwnerclanInvoice(rawData: unknown, trackingNumber: string): boolean {
  const normalizedTarget = normalizeTrackingNumber(trackingNumber)
  if (!normalizedTarget || !rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return false

  const order = rawData as Partial<OwnerclanOrder> & {
    trackingNumber?: unknown
    invoiceNumber?: unknown
  }
  if (
    normalizeTrackingNumber(order.trackingNumber) === normalizedTarget ||
    normalizeTrackingNumber(order.invoiceNumber) === normalizedTarget
  ) {
    return true
  }

  const products = Array.isArray(order.products) ? order.products : []
  return products.some((product) => normalizeTrackingNumber(product?.trackingNumber) === normalizedTarget)
}

export class OwnerclanAdapter implements MarketplaceAdapter {
  readonly config = OWNERCLAN_CONFIG

  private readonly authClient: ReturnType<typeof createOwnerclanClient>
  private readonly orderClient: ReturnType<typeof createOwnerclanClient>

  constructor(credentials: { username?: string; password?: string; api_key?: string; seller_id?: string; vendor_id?: string; vendor_password?: string }) {
    const sellerUsername = credentials.username || credentials.seller_id || ''
    const sellerPassword = credentials.password || credentials.api_key || ''
    const vendorUsername = credentials.vendor_id || ''
    const vendorPassword = credentials.vendor_password || ''

    this.authClient = createOwnerclanClient({
      username: sellerUsername,
      password: sellerPassword,
      userType: 'seller',
    })

    this.orderClient = createOwnerclanClient({
      username: vendorUsername || sellerUsername,
      password: vendorPassword || sellerPassword,
      userType: vendorUsername && vendorPassword ? 'vendor' : 'seller',
    })
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      await this.authClient.authenticate()
      await this.orderClient.authenticate()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    try {
      await this.authClient.authenticate()
      await this.orderClient.authenticate()
      return { success: true }
    } catch (error) {
      throw new MarketplaceAuthError('ownerclan', error instanceof Error ? error.message : 'Authentication failed')
    }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    const collected: NormalizedOrder[] = []
    const seenOrderIds = new Set<string>()

    try {
      for (let windowStart = new Date(since); windowStart < until;) {
        const windowEnd = new Date(Math.min(windowStart.getTime() + OWNERCLAN_WINDOW_MS, until.getTime()))
        await this.collectOrdersWindow(windowStart, windowEnd, collected, seenOrderIds)
        windowStart = windowEnd
      }

      return collected
    } catch (error) {
      if (error instanceof MarketplaceApiError || error instanceof MarketplaceAuthError) throw error
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('401') || message.includes('403') || message.toLowerCase().includes('auth')) {
        throw new MarketplaceAuthError('ownerclan', message)
      }
      throw new MarketplaceApiError('ownerclan', 500, message)
    }
  }

  private async collectOrdersWindow(
    dateFrom: Date,
    dateTo: Date,
    collected: NormalizedOrder[],
    seenOrderIds: Set<string>,
  ): Promise<void> {
    try {
      await this.fetchOrdersWindow(dateFrom, dateTo, collected, seenOrderIds)
    } catch (error) {
      const windowMs = dateTo.getTime() - dateFrom.getTime()
      if (isTimeoutError(error) && windowMs > OWNERCLAN_MIN_WINDOW_MS) {
        const midpoint = new Date(dateFrom.getTime() + Math.floor(windowMs / 2))
        await this.collectOrdersWindow(dateFrom, midpoint, collected, seenOrderIds)
        await this.collectOrdersWindow(midpoint, dateTo, collected, seenOrderIds)
        return
      }
      throw error
    }
  }

  private async fetchOrdersWindow(
    dateFrom: Date,
    dateTo: Date,
    collected: NormalizedOrder[],
    seenOrderIds: Set<string>,
  ): Promise<void> {
    for (const status of OWNERCLAN_COLLECTABLE_STATUSES) {
      await this.fetchOrdersWindowByStatus(dateFrom, dateTo, status, collected, seenOrderIds)
    }
  }

  private async fetchOrdersWindowByStatus(
    dateFrom: Date,
    dateTo: Date,
    status: string | null,
    collected: NormalizedOrder[],
    seenOrderIds: Set<string>,
  ): Promise<void> {
    let after: string | null = null

    for (let page = 0; page < OWNERCLAN_MAX_PAGES_PER_WINDOW; page++) {
      const response: OwnerclanAllOrdersResponse = await this.orderClient.query<OwnerclanAllOrdersResponse>(ALL_ORDERS_QUERY, {
        first: OWNERCLAN_PAGE_SIZE,
        after,
        dateFrom: toOwnerclanTimestamp(dateFrom),
        dateTo: toOwnerclanTimestamp(dateTo),
        ...(status ? { status } : {}),
      })

      for (const edge of response.allOrders.edges ?? []) {
        if (seenOrderIds.has(edge.node.key)) continue
        seenOrderIds.add(edge.node.key)
        collected.push(this.normalizeOrder(edge.node))
      }

      if (!response.allOrders.pageInfo.hasNextPage || !response.allOrders.pageInfo.endCursor) break
      after = response.allOrders.pageInfo.endCursor
    }
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    if (hasMatchingOwnerclanInvoice(invoice.rawData, invoice.trackingNumber)) {
      return { success: true }
    }

    try {
      const trackingNumber = invoice.trackingNumber?.trim()
      if (!trackingNumber) return { success: false, error: '오너클랜 송장번호가 비어 있습니다.' }

      const shippingCompanyCode = mapCarrierCode('ownerclan', invoice.carrierId)
      if (shippingCompanyCode === invoice.carrierId) {
        return {
          success: false,
          error: `오너클랜 택배사 코드를 찾지 못했습니다. (${getCarrierName(invoice.carrierId)})`,
        }
      }

      const response = await this.orderClient.mutate<{
        setTrackingInfo: {
          key?: string | null
          status?: string | null
          products?: Array<{
            trackingNumber?: string | null
            shippingCompanyCode?: string | null
            shippingCompanyName?: string | null
            shippedDate?: number | null
          }> | null
        } | null
      }>(SET_TRACKING_INFO_MUTATION, {
        key: orderId,
        input: {
          shippingCompanyCode,
          trackingNumber,
        },
      })

      if (!response.setTrackingInfo) {
        return { success: false, error: '오너클랜 송장 정보를 등록하지 못했습니다.' }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '오너클랜 송장 업로드 실패' }
    }
  }

  async confirmOrder(marketplaceOrderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.orderClient.mutate<{ checkOrder: { key?: string | null; status?: string | null } | null }>(
        CHECK_ORDER_MUTATION,
        { key: marketplaceOrderId },
      )
      if (!response.checkOrder) return { success: false, error: '오너클랜 주문을 배송준비중으로 변경하지 못했습니다.' }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    return { success: false, error: '오너클랜 상품 등록은 아직 구현되지 않았습니다.' }
  }

  async updateProduct(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '오너클랜 상품 수정은 아직 구현되지 않았습니다.' }
  }

  private normalizeOrder(order: OwnerclanOrder): NormalizedOrder {
    const products = order.products?.length ? order.products : []
    const recipient = order.shippingInfo?.recipient
    const destination = recipient?.destinationAddress
    const sender = order.shippingInfo?.sender
    const shippingFee = asNumber(order.shippingInfo?.shippingFee)
    const items = products.map((product, index) => {
      const quantity = asNumber(product.quantity) || 1
      const unitPrice = asNumber(product.price ?? product.itemOptionInfo?.price)
      return {
        marketplaceItemId: `${order.key}-${product.itemKey ?? index}`,
        productName: product.productName ?? product.itemKey ?? order.key,
        optionText: buildOptionText(product),
        quantity,
        unitPrice,
        sku: product.itemKey ?? undefined,
      }
    })

    const itemTotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)

    return {
      marketplaceOrderId: order.key,
      marketplaceId: 'ownerclan',
      marketplaceStatus: order.status ?? '',
      status: mapOwnerclanStatus(order.status),
      buyerName: sender?.name ?? '오너클랜',
      buyerPhone: sender?.phoneNumber ?? undefined,
      recipientName: recipient?.name ?? '',
      recipientPhone: recipient?.phoneNumber ?? undefined,
      shippingAddress: {
        zipCode: destination?.postalCode ?? '',
        address1: destination?.addr1 ?? '',
        address2: destination?.addr2 ?? undefined,
      },
      items,
      orderedAt: fromUnixSeconds(order.createdAt),
      totalAmount: itemTotal + shippingFee,
      shippingFee,
      deliveryMessage: order.ordererNote ?? null,
      rawData: order as unknown as Record<string, unknown>,
    }
  }
}
