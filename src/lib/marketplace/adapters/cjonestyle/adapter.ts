/**
 * CJ온스타일 marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses API key authentication with a JSON REST API.
 * Endpoints are best-effort based on available documentation (per D-03).
 */

import type {
  MarketplaceAdapter,
  MarketplaceConfig,
  MarketplaceCredentials,
  NormalizedOrder,
  NormalizedClaim,
  NormalizedProduct,
  InvoiceData,
  NormalizedOrderItem,
} from '../../types'
import { MarketplaceApiError, MarketplaceAuthError } from '../../errors'
import { createCjOnestyleClient } from './client'
import { mapCjOnestyleStatus } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type {
  CjOnestyleDeliveryOrder,
  CjOnestyleDeliveryListResponse,
  CjOnestyleStandardResponse,
} from './types'

const CJONESTYLE_CONFIG: MarketplaceConfig = {
  id: 'cjonestyle',
  name: 'CJ온스타일',
  authType: 'api_key',
  rateLimitPerSecond: 30,
  requiredCredentials: ['api_key', 'seller_code'],
}

/** Format a Date as ISO date string for CJ온스타일 API */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export class CjOnestyleAdapter implements MarketplaceAdapter {
  readonly config = CJONESTYLE_CONFIG

  private readonly client: ReturnType<typeof createCjOnestyleClient>

  constructor(credentials: { api_key: string; seller_code: string }) {
    this.client = createCjOnestyleClient({
      apiKey: credentials.api_key,
      vendorCode: credentials.seller_code,
    })
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      const today = formatDate(new Date())
      await this.client.post('delivery/getDeliveryList', {
        json: {
          dateType: '2',
          startDate: today,
          endDate: today,
          deliveryStatus: '2',
        },
      }).json<CjOnestyleDeliveryListResponse>()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // API key auth has no separate authentication flow.
    return { success: true }
  }

  async getOrders(since: Date, until: Date = new Date()): Promise<NormalizedOrder[]> {
    try {
      const response = await this.client.post('delivery/getDeliveryList', {
        json: {
          dateType: '2',
          startDate: formatDate(since),
          endDate: formatDate(until),
          deliveryStatus: '2',
        },
      }).json<CjOnestyleDeliveryListResponse>()

      if (response.error || (response.returnCode && !['OK', '0000'].includes(response.returnCode))) {
        throw new MarketplaceApiError('cjonestyle', response.returnStatus ?? 500, response.returnMessage ?? 'CJ온스타일 주문 조회 실패')
      }

      return this.groupDeliveryRows(response.data ?? [])
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('cjonestyle', 'CJ온스타일 인증키 또는 협력업체코드 인증 실패')
      }
      throw new MarketplaceApiError('cjonestyle', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    return []
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    try {
      const rawData = invoice.rawData as Record<string, unknown> | undefined
      const carrierCode = mapCarrierCode('cjonestyle', invoice.carrierId)
      const response = await this.client.post('delivery/setTakeOutReg', {
        json: {
          orderNo: orderId,
          orderItemSequence: String(rawData?.orderItemSequence ?? ''),
          orderDetailSequence: String(rawData?.orderDetailSequence ?? ''),
          orderProcessingSequence: String(rawData?.orderProcessingSequence ?? ''),
          courierCompany: carrierCode,
          waybillNo: invoice.trackingNumber,
          waybillIdentifierNo: String(rawData?.waybillIdentifierNo ?? ''),
          deliveryLocation1: String(rawData?.deliveryLocation1 ?? ''),
        },
      }).json<CjOnestyleStandardResponse>()

      if (response.error || (response.returnCode && !['OK', '0000'].includes(response.returnCode))) {
        return { success: false, error: response.returnMessage ?? 'CJ온스타일 출고 등록 실패' }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async confirmOrder(
    _marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '발주확인 미구현' }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    return []
  }

  async registerProduct(product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    try {
      const response = await this.client.post('products', {
        json: {
          product_name: product.name,
          price: product.price,
          product_code: product.sku,
        },
      }).json<{ product: { product_id: string } }>()

      return {
        success: true,
        marketplaceProductId: response.product.product_id,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async updateProduct(marketplaceProductId: string, product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    try {
      const body: Record<string, unknown> = {}
      if (product.name) body.product_name = product.name
      if (product.price != null) body.price = product.price

      await this.client.put(`products/${marketplaceProductId}`, {
        json: body,
      }).json()

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private groupDeliveryRows(rows: CjOnestyleDeliveryOrder[]): NormalizedOrder[] {
    const groups = new Map<string, CjOnestyleDeliveryOrder[]>()
    for (const row of rows) {
      const key = String(row.orderNo)
      groups.set(key, [...(groups.get(key) ?? []), row])
    }

    return [...groups.values()].map((group) => this.normalizeOrder(group))
  }

  private normalizeOrder(rows: CjOnestyleDeliveryOrder[]): NormalizedOrder {
    const first = rows[0]
    const items: NormalizedOrderItem[] = rows.map((row) => {
      const quantity = Number(row.count ?? 1) || 1
      const unitPrice = Number(row.paymentPrice ?? row.salesPrice ?? row.supplyPrice ?? 0) || 0
      const itemId = [
        row.orderItemSequence,
        row.orderDetailSequence,
        row.orderProcessingSequence,
      ].filter(Boolean).join('-') || String(row.itemCode ?? row.orderNo)

      return {
        marketplaceItemId: itemId,
        productName: String(row.itemName ?? row.webItemName ?? row.waybillName ?? ''),
        optionText: row.optionName || undefined,
        quantity,
        unitPrice,
        sku: row.vendorItemCode || String(row.optionCode ?? row.itemCode ?? '') || undefined,
      }
    })
    const totalAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)

    return {
      marketplaceOrderId: String(first.orderNo),
      marketplaceId: 'cjonestyle',
      marketplaceStatus: String(first.deliveryStatus ?? ''),
      status: mapCjOnestyleStatus(String(first.deliveryStatus ?? '')),
      buyerName: String(first.ordererName ?? ''),
      buyerPhone: first.ordererTelephoneNo || undefined,
      recipientName: String(first.recipientName ?? first.recipient ?? ''),
      recipientPhone: first.recipientMobilePhoneNo || first.recipientTelephoneNo || undefined,
      shippingAddress: {
        zipCode: String(first.postalCode ?? ''),
        address1: String(first.address ?? ''),
      },
      items,
      orderedAt: new Date(String(first.paymentDate ?? first.deliveryInstructionDate ?? new Date().toISOString())),
      totalAmount,
      shippingFee: Number(first.customerResponsibilityCost ?? 0) || null,
      deliveryMessage: first.deliveryNote || null,
      rawData: first as unknown as Record<string, unknown>,
    }
  }
}
