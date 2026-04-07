/**
 * Always (올웨이즈) marketplace adapter implementing MarketplaceAdapter.
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

const ALWAYS_CONFIG: MarketplaceConfig = {
  id: 'always',
  name: '올웨이즈',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'seller_id'],
}

export class AlwaysAdapter implements MarketplaceAdapter {
  readonly config = ALWAYS_CONFIG

  async testConnection(
    _credentials?: MarketplaceCredentials
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    return {
      success: false,
      error: 'API integration pending - 올웨이즈 API documentation required',
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('always', 501, 'Always (올웨이즈) adapter not yet implemented')
  }

  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('always', 501, 'Always (올웨이즈) getOrders not yet implemented')
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('always', 501, 'Always (올웨이즈) getClaimsOrders not yet implemented')
  }

  async uploadInvoice(
    _orderId: string,
    _invoice: InvoiceData
  ): Promise<{ success: boolean; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('always', 501, 'Always (올웨이즈) uploadInvoice not yet implemented')
  }

  async confirmOrder(
    _marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '발주확인 미구현' }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('always', 501, 'Always (올웨이즈) getProducts not yet implemented')
  }

  async registerProduct(
    _product: NormalizedProduct
  ): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('always', 501, 'Always (올웨이즈) registerProduct not yet implemented')
  }

  async updateProduct(
    _marketplaceProductId: string,
    _product: Partial<NormalizedProduct>
  ): Promise<{ success: boolean; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('always', 501, 'Always (올웨이즈) updateProduct not yet implemented')
  }
}
