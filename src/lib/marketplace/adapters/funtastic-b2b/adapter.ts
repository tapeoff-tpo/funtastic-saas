import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
} from '../../types'
import { MarketplaceApiError } from '../../errors'
import { createFuntasticB2bClient } from './client'
import { mapFuntasticB2bStatus } from './status-map'
import type {
  FuntasticB2bInvoiceResponse,
  FuntasticB2bOrder,
  FuntasticB2bOrdersResponse,
} from './types'

const FUNTASTIC_B2B_CONFIG: MarketplaceConfig = {
  id: 'funtastic-b2b',
  name: '퍼스트몰',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_base_url', 'api_token'],
}

export class FuntasticB2bAdapter implements MarketplaceAdapter {
  readonly config = FUNTASTIC_B2B_CONFIG

  private readonly client: ReturnType<typeof createFuntasticB2bClient>

  constructor(credentials: { api_base_url: string; api_token: string }) {
    this.client = createFuntasticB2bClient(credentials.api_base_url, credentials.api_token)
  }

  async testConnection(): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      const res = await this.client.get('health').json<{ success?: boolean; error?: string }>()
      if (res.success === false) return { success: false, error: res.error ?? '퍼스트몰 health check failed' }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    const result = await this.testConnection()
    if (!result.success) {
      throw new MarketplaceApiError('funtastic-b2b', 401, result.error ?? 'Authentication failed')
    }
    return { success: true }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    try {
      const response = await this.client.get('orders', {
        searchParams: {
          since: since.toISOString(),
        },
      }).json<FuntasticB2bOrdersResponse>()

      if (response.success === false) {
        throw new MarketplaceApiError('funtastic-b2b', 500, response.error ?? 'Order collection failed')
      }

      return (response.orders ?? []).map((order) => this.normalizeOrder(order))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      throw new MarketplaceApiError('funtastic-b2b', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(
    orderId: string,
    invoice: InvoiceData,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.post('invoices', {
        json: {
          orderId,
          trackingNumber: invoice.trackingNumber,
          carrierId: invoice.carrierId,
          rawData: invoice.rawData,
        },
      }).json<FuntasticB2bInvoiceResponse>()

      if (response.success === false) {
        return { success: false, error: response.error ?? 'Invoice upload failed' }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async confirmOrder(_marketplaceOrderId: string): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(
    _product: NormalizedProduct,
  ): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    return { success: false, error: '퍼스트몰 product registration not implemented yet' }
  }

  async updateProduct(
    _marketplaceProductId: string,
    _product: Partial<NormalizedProduct>,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '퍼스트몰 product update not implemented yet' }
  }

  private normalizeOrder(order: FuntasticB2bOrder): NormalizedOrder {
    const items = (order.items ?? []).map((item) => ({
      marketplaceItemId: String(item.itemId),
      productName: item.productName,
      optionText: item.optionText ?? undefined,
      quantity: Number(item.quantity) || 1,
      unitPrice: Number(item.unitPrice) || 0,
      sku: item.sku ?? undefined,
    }))
    const itemTotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)

    return {
      marketplaceOrderId: String(order.orderId),
      marketplaceId: 'funtastic-b2b',
      marketplaceStatus: order.status,
      status: mapFuntasticB2bStatus(order.status),
      buyerName: order.buyerName,
      buyerPhone: order.buyerPhone ?? undefined,
      buyerPhone2: order.buyerPhone2 ?? undefined,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone ?? undefined,
      recipientPhone2: order.recipientPhone2 ?? undefined,
      shippingAddress: {
        zipCode: order.zipCode,
        address1: order.address1,
        address2: order.address2 ?? undefined,
      },
      items,
      orderedAt: new Date(order.orderedAt),
      totalAmount: Number(order.totalAmount ?? itemTotal) || itemTotal,
      shippingFee: order.shippingFee ?? null,
      deliveryMessage: order.deliveryMessage ?? null,
      rawData: order as unknown as Record<string, unknown>,
    }
  }
}
