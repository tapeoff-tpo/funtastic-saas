/**
 * Coupang marketplace adapter implementing MarketplaceAdapter.
 *
 * Uses HMAC-SHA256 signed requests to fetch orders and claims
 * from the Coupang WING API, normalizing results to shared interfaces.
 */

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
import { createCoupangClient } from './client'
import { mapCoupangStatus, mapCoupangClaimStatus } from './status-map'
import { mapCarrierCode } from '@/lib/shipping/carrier-codes'
import type { CoupangOrderSheet, CoupangOrderSheetsResponse, CoupangReturnRequestsResponse } from './types'

const COUPANG_CONFIG: MarketplaceConfig = {
  id: 'coupang',
  name: '쿠팡',
  authType: 'hmac',
  rateLimitPerSecond: 100,
  requiredCredentials: ['access_key', 'secret_key', 'vendor_id'],
}

export class CoupangAdapter implements MarketplaceAdapter {
  readonly config = COUPANG_CONFIG

  private readonly client: ReturnType<typeof createCoupangClient>
  private readonly vendorId: string

  constructor(credentials: { access_key: string; secret_key: string; vendor_id: string }) {
    this.client = createCoupangClient(credentials.access_key, credentials.secret_key)
    this.vendorId = credentials.vendor_id
  }

  async testConnection(_credentials?: MarketplaceCredentials): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    try {
      // Make a lightweight call with a 1-minute window to verify credentials
      const now = new Date()
      const oneMinAgo = new Date(now.getTime() - 60_000)
      const path = `v2/providers/openapi/apis/api/v5/vendors/${this.vendorId}/ordersheets`

      await this.client.get(path, {
        searchParams: {
          createdAtFrom: oneMinAgo.toISOString(),
          createdAtTo: now.toISOString(),
          maxPerPage: 1,
        },
      }).json()

      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // HMAC doesn't require a separate authentication flow.
    // Each request is self-signed with the access key + secret key.
    return { success: true }
  }

  async getOrders(since: Date): Promise<NormalizedOrder[]> {
    const now = new Date()
    const path = `v2/providers/openapi/apis/api/v5/vendors/${this.vendorId}/ordersheets`

    try {
      const response = await this.client.get(path, {
        searchParams: {
          createdAtFrom: since.toISOString(),
          createdAtTo: now.toISOString(),
          maxPerPage: 50,
        },
      }).json<CoupangOrderSheetsResponse>()

      if (response.code !== '200' && response.code !== 'SUCCESS') {
        throw new MarketplaceApiError('coupang', Number(response.code) || 500, response.message)
      }

      return (response.data || []).map((sheet) => this.normalizeOrder(sheet))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('coupang', 'HMAC authentication failed')
      }
      throw new MarketplaceApiError('coupang', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async getClaimsOrders(since: Date): Promise<NormalizedClaim[]> {
    const now = new Date()
    const path = `v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/returnRequests`

    try {
      const response = await this.client.get(path, {
        searchParams: {
          createdAtFrom: since.toISOString(),
          createdAtTo: now.toISOString(),
          maxPerPage: 50,
        },
      }).json<CoupangReturnRequestsResponse>()

      if (response.code !== '200' && response.code !== 'SUCCESS') {
        throw new MarketplaceApiError('coupang', Number(response.code) || 500, response.message)
      }

      return (response.data || []).map((req) => this.normalizeClaim(req))
    } catch (error) {
      if (error instanceof MarketplaceApiError) throw error
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
        throw new MarketplaceAuthError('coupang', 'HMAC authentication failed')
      }
      throw new MarketplaceApiError('coupang', 500, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async uploadInvoice(orderId: string, invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    const path = `v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/orders/invoices`

    try {
      const response = await this.client.put(path, {
        json: {
          vendorId: this.vendorId,
          orderSheetInvoiceApplyDtos: [
            {
              shipmentBoxId: invoice.shipmentBoxId,
              orderId,
              vendorItemId: invoice.vendorItemId,
              deliveryCompanyCode: mapCarrierCode('coupang', invoice.carrierId),
              invoiceNumber: invoice.trackingNumber,
              splitShipping: false,
              preSplitShipped: false,
              estimatedShippingDate: undefined,
            },
          ],
        },
      }).json<{ code: string; message: string }>()

      if (response.code === '200' || response.code === 'SUCCESS') {
        return { success: true }
      }

      return { success: false, error: response.message || `Upload failed with code: ${response.code}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    throw new Error('getProducts: Not implemented (Phase 5)')
  }

  private normalizeOrder(sheet: CoupangOrderSheet): NormalizedOrder {
    return {
      marketplaceOrderId: String(sheet.orderId),
      marketplaceId: 'coupang',
      marketplaceStatus: sheet.status,
      status: mapCoupangStatus(sheet.status),
      buyerName: sheet.orderer.name,
      buyerPhone: undefined,
      recipientName: sheet.receiver.name,
      recipientPhone: sheet.receiver.phone,
      shippingAddress: {
        zipCode: sheet.receiver.postCode || sheet.receiver.zipCode,
        address1: sheet.receiver.addr1,
        address2: sheet.receiver.addr2 || undefined,
      },
      items: [
        {
          marketplaceItemId: String(sheet.vendorItemId),
          productName: sheet.vendorItemName,
          quantity: sheet.shippingCount,
          unitPrice: sheet.orderPrice,
        },
      ],
      orderedAt: new Date(sheet.paidAt),
      totalAmount: sheet.paymentPrice,
      rawData: sheet as unknown as Record<string, unknown>,
    }
  }

  private normalizeClaim(req: CoupangReturnRequestsResponse['data'][number]): NormalizedClaim {
    return {
      marketplaceClaimId: String(req.returnId),
      marketplaceId: 'coupang',
      marketplaceOrderId: String(req.orderId),
      claimType: 'return',
      claimStatus: mapCoupangClaimStatus(req.returnStatus),
      reason: req.returnReason || undefined,
      requestedAt: new Date(req.createdAt),
      rawData: req as unknown as Record<string, unknown>,
    }
  }
}
