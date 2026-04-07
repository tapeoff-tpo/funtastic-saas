/**
 * Tobizon (투비즈온) marketplace adapter implementing MarketplaceAdapter.
 *
 * Stub implementation -- API integration pending.
 * // TODO: Implement when API access is available
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

const TOBIZON_CONFIG: MarketplaceConfig = {
  id: 'tobizon',
  name: '투비즈온',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'partner_id'],
}

export class TobizonAdapter implements MarketplaceAdapter {
  readonly config = TOBIZON_CONFIG

  async testConnection(
    _credentials?: MarketplaceCredentials
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    return {
      success: false,
      error: 'API integration pending - 투비즈온 API documentation required',
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('tobizon', 501, 'Tobizon (투비즈온) adapter not yet implemented')
  }

  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('tobizon', 501, 'Tobizon (투비즈온) getOrders not yet implemented')
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('tobizon', 501, 'Tobizon (투비즈온) getClaimsOrders not yet implemented')
  }

  async uploadInvoice(
    _orderId: string,
    _invoice: InvoiceData
  ): Promise<{ success: boolean; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('tobizon', 501, 'Tobizon (투비즈온) uploadInvoice not yet implemented')
  }

  async confirmOrder(
    _marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '발주확인 미구현' }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('tobizon', 501, 'Tobizon (투비즈온) getProducts not yet implemented')
  }

  async registerProduct(
    _product: NormalizedProduct
  ): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('tobizon', 501, 'Tobizon (투비즈온) registerProduct not yet implemented')
  }

  async updateProduct(
    _marketplaceProductId: string,
    _product: Partial<NormalizedProduct>
  ): Promise<{ success: boolean; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('tobizon', 501, 'Tobizon (투비즈온) updateProduct not yet implemented')
  }
}
