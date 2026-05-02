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
import { createOwnerclanClient } from './client'
import { mapOwnerclanStatus } from './status-map'
import type {
  OwnerclanAllOrdersResponse,
  OwnerclanOrder,
  OwnerclanOrderProduct,
  OwnerclanOrderResponse,
} from './types'

const OWNERCLAN_CONFIG: MarketplaceConfig = {
  id: 'ownerclan',
  name: '오너클랜',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['username', 'password'],
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
  query OwnerclanAllOrders($first: Int!, $dateFrom: Timestamp, $dateTo: Timestamp) {
    allOrders(first: $first, dateFrom: $dateFrom, dateTo: $dateTo) {
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

const ORDER_QUERY = `
  query OwnerclanOrder($key: String!) {
    order(key: $key) {
      ${ORDER_FIELDS}
    }
  }
`

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function fromUnixSeconds(value?: number | null): Date {
  return value ? new Date(value * 1000) : new Date()
}

function asNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

export class OwnerclanAdapter implements MarketplaceAdapter {
  readonly config = OWNERCLAN_CONFIG

  private readonly client: ReturnType<typeof createOwnerclanClient>

  constructor(credentials: { username: string; password: string; api_key?: string; seller_id?: string; vendor_id?: string; vendor_password?: string }) {
    this.client = createOwnerclanClient({
      username: credentials.username || credentials.seller_id || credentials.vendor_id || '',
      password: credentials.password || credentials.api_key || credentials.vendor_password || '',
      userType: 'seller',
    })
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      await this.client.authenticate()
      await this.client.query<OwnerclanAllOrdersResponse>(ALL_ORDERS_QUERY, {
        first: 1,
        dateFrom: toUnixSeconds(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        dateTo: toUnixSeconds(new Date()),
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    try {
      await this.client.authenticate()
      return { success: true }
    } catch (error) {
      throw new MarketplaceAuthError('ownerclan', error instanceof Error ? error.message : 'Authentication failed')
    }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    const collected: NormalizedOrder[] = []
    let after: string | null = null

    try {
      for (let page = 0; page < 20; page++) {
        const response: OwnerclanAllOrdersResponse = await this.client.query<OwnerclanAllOrdersResponse>(ALL_ORDERS_QUERY, {
          first: 100,
          dateFrom: toUnixSeconds(since),
          dateTo: toUnixSeconds(new Date()),
        })

        for (const edge of response.allOrders.edges ?? []) {
          collected.push(this.normalizeOrder(edge.node))
        }

        if (!response.allOrders.pageInfo.hasNextPage || !response.allOrders.pageInfo.endCursor) break
        after = response.allOrders.pageInfo.endCursor
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

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(_orderId: string, _invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '오너클랜 송장 업로드 API는 매뉴얼에서 확인되지 않아 비활성화했습니다.' }
  }

  async confirmOrder(marketplaceOrderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.query<OwnerclanOrderResponse>(ORDER_QUERY, { key: marketplaceOrderId })
      if (!response.order) return { success: false, error: '오너클랜 주문을 찾을 수 없습니다.' }
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
