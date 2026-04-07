/**
 * Banana B2B (바나나B2B) marketplace adapter stub.
 *
 * This is a stub implementation with TODO markers.
 * testConnection returns success:false with "API integration pending".
 * All data methods throw MarketplaceApiError with TODO message.
 *
 * TODO: Implement when API access is available.
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
import { MarketplaceApiError } from '../../errors'

const BANANA_B2B_CONFIG: MarketplaceConfig = {
  id: 'banana-b2b',
  name: '바나나B2B',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'partner_id'],
}

export class BananaB2bAdapter implements MarketplaceAdapter {
  readonly config = BANANA_B2B_CONFIG

  async testConnection(
    _credentials?: MarketplaceCredentials
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    return {
      success: false,
      error: 'API integration pending - 바나나B2B API documentation required',
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('banana-b2b', 501, 'Not yet implemented - 바나나B2B API integration pending')
  }

  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('banana-b2b', 501, 'Not yet implemented - 바나나B2B getOrders pending API integration')
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('banana-b2b', 501, 'Not yet implemented - 바나나B2B getClaimsOrders pending API integration')
  }

  async uploadInvoice(_orderId: string, _invoice: InvoiceData): Promise<{ success: boolean; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('banana-b2b', 501, 'Not yet implemented - 바나나B2B uploadInvoice pending API integration')
  }

  async confirmOrder(
    _marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '발주확인 미구현' }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('banana-b2b', 501, 'Not yet implemented - 바나나B2B getProducts pending API integration')
  }

  async registerProduct(_product: NormalizedProduct): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('banana-b2b', 501, 'Not yet implemented - 바나나B2B registerProduct pending API integration')
  }

  async updateProduct(_marketplaceProductId: string, _product: Partial<NormalizedProduct>): Promise<{ success: boolean; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('banana-b2b', 501, 'Not yet implemented - 바나나B2B updateProduct pending API integration')
  }
}
