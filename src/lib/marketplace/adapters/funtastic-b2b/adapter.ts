import type {
  InvoiceData,
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedClaim,
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedProduct,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { createFuntasticB2bClient } from './client'
import type {
  FuntasticB2bListResponse,
  FuntasticB2bMutationResponse,
  FuntasticB2bOrder,
  FuntasticB2bOrderItem,
  FuntasticB2bReturn,
} from './types'

const FUNTASTIC_B2B_CONFIG: MarketplaceConfig = {
  id: 'funtastic-b2b',
  name: '펀타스틱B2B',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'base_url'],
}

const CARRIER_NAMES: Record<string, string> = {
  CJGLS: 'CJ대한통운',
  HANJIN: '한진택배',
  HYUNDAI: '롯데택배',
  EPOST: '우체국택배',
  KGB: '로젠택배',
  KDEXP: '경동택배',
  CHUNIL: '천일택배',
  DAESIN: '대신택배',
  ILYANG: '일양로지스',
  CVSNET: '편의점택배',
  ETC: '기타택배',
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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

function parseDate(value: unknown): Date {
  const raw = asString(value)
  if (!raw) return new Date()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(`${raw.replace(' ', 'T')}+09:00`)
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function listFromResponse<T>(response: FuntasticB2bListResponse<T>, key: 'orders' | 'returns'): T[] {
  if (Array.isArray(response)) return response
  if (Array.isArray(response[key])) return response[key] ?? []
  if (Array.isArray(response.items)) return response.items
  if (Array.isArray(response.data)) return response.data
  if (response.data && typeof response.data === 'object') {
    const data = response.data
    if (Array.isArray(data[key])) return data[key] ?? []
    if (Array.isArray(data.items)) return data.items
  }
  return []
}

function mapOrderStatus(status: string): NormalizedOrder['status'] {
  const normalized = status.toUpperCase()
  if (['CONFIRMED', 'ORDER_CONFIRMED'].includes(normalized)) return 'new'
  if (['PREPARING', 'PREPARING_PRODUCT', 'READY_TO_SHIP'].includes(normalized)) return 'confirmed'
  if (['READY', 'PACKED'].includes(normalized)) return 'ready'
  if (['SHIPPED'].includes(normalized)) return 'shipped'
  if (['DELIVERING', 'IN_DELIVERY'].includes(normalized)) return 'delivering'
  if (['DELIVERED', 'COMPLETED'].includes(normalized)) return 'delivered'
  if (['CANCELLED', 'CANCELED'].includes(normalized)) return 'cancelled'
  return 'cancelled'
}

function getEffectiveShipmentStatus(order: FuntasticB2bOrder): string {
  return (order.shipmentStatus ?? order.shipment?.status ?? '').trim()
}

function getEffectiveMarketplaceStatus(order: FuntasticB2bOrder): string {
  return getEffectiveShipmentStatus(order) || (order.status ?? '').trim()
}

function isCollectableOrder(order: FuntasticB2bOrder): boolean {
  const orderStatus = (order.status ?? '').trim().toUpperCase()
  const shipmentStatus = getEffectiveShipmentStatus(order).toUpperCase()

  return ['CONFIRMED', 'ORDER_CONFIRMED'].includes(orderStatus) && !shipmentStatus
}

function mapClaimType(type: string): 'cancel' | 'return' | 'exchange' {
  const normalized = type.toUpperCase()
  if (normalized.includes('EXCHANGE')) return 'exchange'
  if (normalized.includes('RETURN')) return 'return'
  return 'cancel'
}

function mapClaimStatus(status: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const normalized = status.toUpperCase()
  if (['COMPLETED', 'DONE', 'APPROVED'].includes(normalized)) return 'completed'
  if (['REJECTED', 'DENIED'].includes(normalized)) return 'rejected'
  if (['PROCESSING', 'IN_PROGRESS'].includes(normalized)) return 'processing'
  return 'requested'
}

export class FuntasticB2bAdapter implements MarketplaceAdapter {
  readonly config = FUNTASTIC_B2B_CONFIG

  private readonly client: ReturnType<typeof createFuntasticB2bClient>

  constructor(credentials: { api_key: string; base_url: string }) {
    this.client = createFuntasticB2bClient(credentials)
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      await this.client.get('api/saas/orders', {
        searchParams: {
          dateFrom: formatDate(new Date()),
          dateTo: formatDate(new Date()),
          limit: '1',
        },
      }).json()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    return { success: true }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    try {
      const response = await this.client.get('api/saas/orders', {
        searchParams: {
          dateFrom: formatDate(since),
          dateTo: formatDate(until),
          limit: '50',
        },
      }).json<FuntasticB2bListResponse<FuntasticB2bOrder>>()

      if (response.success === false) {
        throw new MarketplaceApiError('funtastic-b2b', 400, response.message || response.error || 'Failed to fetch orders')
      }

      return listFromResponse(response, 'orders')
        .filter((order) => isCollectableOrder(order))
        .map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('funtastic-b2b', 'API key authentication failed')
      }
      throw new MarketplaceApiError('funtastic-b2b', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    try {
      const response = await this.client.get('api/saas/returns', {
        searchParams: {
          status: 'REQUESTED',
          limit: '50',
        },
      }).json<FuntasticB2bListResponse<FuntasticB2bReturn>>()

      if (response.success === false) {
        throw new MarketplaceApiError('funtastic-b2b', 400, response.message || response.error || 'Failed to fetch returns')
      }

      return listFromResponse(response, 'returns').map((claim) => this.normalizeClaim(claim))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('funtastic-b2b', 'API key authentication failed')
      }
      throw new MarketplaceApiError('funtastic-b2b', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.patch(`api/saas/orders/${encodeURIComponent(orderId)}`, {
        json: {
          status: 'SHIPPED',
          shipmentStatus: 'SHIPPED',
          carrier: CARRIER_NAMES[invoice.carrierId] ?? invoice.carrierId,
          trackingNo: invoice.trackingNumber,
          referenceNo: asString(invoice.rawData && typeof invoice.rawData === 'object' ? (invoice.rawData as Record<string, unknown>).referenceNo : undefined) || undefined,
        },
      }).json<FuntasticB2bMutationResponse>()

      if (response.success === false || response.ok === false) {
        return { success: false, error: response.message || response.error || 'Invoice upload failed' }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async confirmOrder(marketplaceOrderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.patch(`api/saas/orders/${encodeURIComponent(marketplaceOrderId)}`, {
        json: {
          status: 'PREPARING',
          shipmentStatus: 'PREPARING',
        },
      }).json<FuntasticB2bMutationResponse>()

      if (response.success === false || response.ok === false) {
        return { success: false, error: response.message || response.error || 'Order status update failed' }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(_product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    return { success: false, error: '펀타스틱B2B 상품 등록은 아직 연결되지 않았습니다.' }
  }

  async updateProduct(_marketplaceProductId: string, _product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '펀타스틱B2B 상품 수정은 아직 연결되지 않았습니다.' }
  }

  private normalizeOrder(order: FuntasticB2bOrder): NormalizedOrder {
    const orderId = order.orderNo || order.orderId || asString(order.id)
    const rawItems = order.items ?? order.orderItems ?? order.products ?? []
    const items = rawItems.length > 0
      ? rawItems.map((item) => this.normalizeItem(item, orderId))
      : [this.normalizeItem({}, orderId)]
    const totalAmount = asNumber(order.totalAmount ?? order.amount ?? order.paymentAmount)

    return {
      marketplaceOrderId: orderId,
      marketplaceId: 'funtastic-b2b',
      marketplaceStatus: getEffectiveMarketplaceStatus(order) || 'CONFIRMED',
      status: mapOrderStatus(getEffectiveMarketplaceStatus(order) || 'CONFIRMED'),
      buyerName: order.buyerName || order.recipientName || order.receiverName || '-',
      buyerPhone: order.buyerPhone || undefined,
      buyerPhone2: order.buyerPhone2 || undefined,
      recipientName: order.recipientName || order.receiverName || order.buyerName || '-',
      recipientPhone: order.recipientPhone || order.receiverPhone || undefined,
      recipientPhone2: order.recipientPhone2 || undefined,
      shippingAddress: {
        zipCode: order.zipCode || order.zipcode || order.postalCode || '',
        address1: order.address1 || order.address || '',
        address2: order.address2 || order.detailAddress || undefined,
      },
      items,
      orderedAt: parseDate(order.orderedAt ?? order.orderDate ?? order.createdAt),
      totalAmount,
      shippingFee: order.shippingFee != null ? asNumber(order.shippingFee) : null,
      deliveryMessage: order.deliveryMessage ?? order.memo ?? null,
      rawData: order as unknown as Record<string, unknown>,
    }
  }

  private normalizeItem(item: FuntasticB2bOrderItem, fallbackId: string): NormalizedOrderItem {
    const quantity = asNumber(item.quantity ?? item.qty) || 1
    return {
      marketplaceItemId: asString(item.id ?? item.itemId ?? item.productCode ?? item.sku) || fallbackId,
      productName: item.productName || item.name || '펀타스틱B2B 상품',
      optionText: item.optionText || item.optionName || undefined,
      quantity,
      unitPrice: asNumber(item.unitPrice ?? item.price),
      sku: asString(item.sku ?? item.productCode) || undefined,
    }
  }

  private normalizeClaim(claim: FuntasticB2bReturn): NormalizedClaim {
    const claimId = asString(claim.id ?? claim.returnId ?? claim.claimId)
    return {
      marketplaceClaimId: claimId,
      marketplaceId: 'funtastic-b2b',
      marketplaceOrderId: claim.orderNo || claim.orderId || '',
      claimType: mapClaimType(claim.type ?? 'RETURN'),
      claimStatus: mapClaimStatus(claim.status ?? 'REQUESTED'),
      reason: claim.reason || undefined,
      requestedAt: parseDate(claim.requestedAt ?? claim.createdAt),
      rawData: claim as unknown as Record<string, unknown>,
    }
  }
}
