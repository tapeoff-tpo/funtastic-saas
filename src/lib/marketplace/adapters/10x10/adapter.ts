/**
 * TenByTen (텐바이텐) marketplace adapter implementing MarketplaceAdapter.
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

const TENBYTEN_CONFIG: MarketplaceConfig = {
  id: '10x10',
  name: '텐바이텐',
  authType: 'api_key',
  rateLimitPerSecond: 20,
  requiredCredentials: ['api_key', 'shop_id'],
}

export class TenByTenAdapter implements MarketplaceAdapter {
  readonly config = TENBYTEN_CONFIG

  async testConnection(
    _credentials?: MarketplaceCredentials
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date }> {
    return {
      success: false,
      error: 'API integration pending - 텐바이텐 API documentation required',
    }
  }

  async authenticate(): Promise<{ success: boolean; expiresAt?: Date }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('10x10', 501, 'TenByTen (텐바이텐) adapter not yet implemented')
  }

  async getOrders(_since: Date): Promise<NormalizedOrder[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('10x10', 501, 'TenByTen (텐바이텐) getOrders not yet implemented')
  }

  async getClaimsOrders(_since: Date): Promise<NormalizedClaim[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('10x10', 501, 'TenByTen (텐바이텐) getClaimsOrders not yet implemented')
  }

  async uploadInvoice(
    _orderId: string,
    _invoice: InvoiceData
  ): Promise<{ success: boolean; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('10x10', 501, 'TenByTen (텐바이텐) uploadInvoice not yet implemented')
  }

  async confirmOrder(
    _marketplaceOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '발주확인 미구현' }
  }

  async getProducts(): Promise<NormalizedProduct[]> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('10x10', 501, 'TenByTen (텐바이텐) getProducts not yet implemented')
  }

  async registerProduct(
    _product: NormalizedProduct
  ): Promise<{ success: boolean; marketplaceProductId?: string; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('10x10', 501, 'TenByTen (텐바이텐) registerProduct not yet implemented')
  }

  async updateProduct(
    _marketplaceProductId: string,
    _product: Partial<NormalizedProduct>
  ): Promise<{ success: boolean; error?: string }> {
    // TODO: Implement when API access is available
    throw new MarketplaceApiError('10x10', 501, 'TenByTen (텐바이텐) updateProduct not yet implemented')
  }
}
