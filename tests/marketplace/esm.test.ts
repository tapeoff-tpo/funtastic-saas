/**
 * Tests for ESM Trading API marketplace adapter.
 *
 * Tests status mapping, order/claims normalization, and invoice upload
 * for both Gmarket (site_type='G') and Auction (site_type='A') instances
 * via MSW-mocked API responses.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { esmHandlers, MOCK_ESM_ORDERS } from '../helpers/msw-handlers'
import {
  mapEsmStatus,
  mapEsmClaimStatus,
  mapEsmClaimType,
  ESM_STATUS_MAP,
  ESM_CLAIM_STATUS_MAP,
  ESM_CLAIM_TYPE_MAP,
} from '@/lib/marketplace/adapters/esm/status-map'
import { EsmAdapter } from '@/lib/marketplace/adapters/esm/adapter'

const server = setupServer(...esmHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ============================================================================
// Status Mapping Tests
// ============================================================================

describe('mapEsmStatus', () => {
  it('maps ORDER_RECEIVED to new', () => {
    expect(mapEsmStatus('ORDER_RECEIVED')).toBe('new')
  })

  it('maps PAYMENT_COMPLETE to new', () => {
    expect(mapEsmStatus('PAYMENT_COMPLETE')).toBe('new')
  })

  it('maps PRODUCT_PREPARE to preparing', () => {
    expect(mapEsmStatus('PRODUCT_PREPARE')).toBe('preparing')
  })

  it('maps DELIVERING to shipped', () => {
    expect(mapEsmStatus('DELIVERING')).toBe('shipped')
  })

  it('maps DELIVERY_COMPLETE to delivered', () => {
    expect(mapEsmStatus('DELIVERY_COMPLETE')).toBe('delivered')
  })

  it('returns new as fallback for unknown statuses with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapEsmStatus('UNKNOWN_STATUS')
    expect(result).toBe('new')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN_STATUS'))
    warnSpy.mockRestore()
  })

  it('covers all known status codes', () => {
    expect(Object.keys(ESM_STATUS_MAP)).toHaveLength(5)
  })
})

describe('mapEsmClaimStatus', () => {
  it('maps CLAIM_REQUESTED to requested', () => {
    expect(mapEsmClaimStatus('CLAIM_REQUESTED')).toBe('requested')
  })

  it('maps CLAIM_PROCESSING to processing', () => {
    expect(mapEsmClaimStatus('CLAIM_PROCESSING')).toBe('processing')
  })

  it('maps CLAIM_COMPLETED to completed', () => {
    expect(mapEsmClaimStatus('CLAIM_COMPLETED')).toBe('completed')
  })

  it('maps CLAIM_REJECTED to rejected', () => {
    expect(mapEsmClaimStatus('CLAIM_REJECTED')).toBe('rejected')
  })

  it('returns requested as fallback for unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mapEsmClaimStatus('UNKNOWN')).toBe('requested')
    warnSpy.mockRestore()
  })

  it('covers all known claim status codes', () => {
    expect(Object.keys(ESM_CLAIM_STATUS_MAP).length).toBeGreaterThanOrEqual(9)
  })
})

describe('mapEsmClaimType', () => {
  it('maps CANCEL to cancel', () => {
    expect(mapEsmClaimType('CANCEL')).toBe('cancel')
  })

  it('maps RETURN to return', () => {
    expect(mapEsmClaimType('RETURN')).toBe('return')
  })

  it('maps EXCHANGE to exchange', () => {
    expect(mapEsmClaimType('EXCHANGE')).toBe('exchange')
  })

  it('returns cancel as fallback for unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mapEsmClaimType('UNKNOWN')).toBe('cancel')
    warnSpy.mockRestore()
  })
})

// ============================================================================
// Gmarket Adapter Tests
// ============================================================================

describe('EsmAdapter (Gmarket)', () => {
  const adapter = new EsmAdapter({
    master_id: 'test-master',
    secret_key: 'test-secret',
    seller_id: 'test-gmarket-seller',
    site_type: 'G',
  })

  it('has correct Gmarket config', () => {
    expect(adapter.config.id).toBe('gmarket')
    expect(adapter.config.name).toBe('지마켓')
    expect(adapter.config.authType).toBe('api_key')
    expect(adapter.config.rateLimitPerSecond).toBe(30)
    expect(adapter.config.requiredCredentials).toEqual(['master_id', 'secret_key', 'seller_id'])
  })

  it('authenticate() returns success (API key has no separate auth flow)', async () => {
    const result = await adapter.authenticate()
    expect(result.success).toBe(true)
  })

  it('testConnection() returns success', async () => {
    const result = await adapter.testConnection()
    expect(result.success).toBe(true)
  })

  describe('getOrders', () => {
    it('normalizes Gmarket orders to NormalizedOrder[]', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const orders = await adapter.getOrders(since)

      // Only Gmarket orders (siteType='G')
      const gmarketMocks = MOCK_ESM_ORDERS.filter((o) => o.siteType === 'G')
      expect(orders).toHaveLength(gmarketMocks.length)

      const first = orders[0]
      expect(first.marketplaceOrderId).toBe('ESM-G-20260402-001')
      expect(first.marketplaceId).toBe('gmarket')
      expect(first.marketplaceStatus).toBe('PAYMENT_COMPLETE')
      expect(first.status).toBe('new')
      expect(first.buyerName).toBe('김지마켓')
      expect(first.recipientName).toBe('이배송')
      expect(first.recipientPhone).toBe('010-8765-4321')
      expect(first.shippingAddress.zipCode).toBe('06134')
      expect(first.shippingAddress.address1).toBe('서울특별시 강남구 테헤란로 456')
      expect(first.shippingAddress.address2).toBe('7층 701호')
      expect(first.items).toHaveLength(1)
      expect(first.items[0].productName).toBe('지마켓 테스트 상품 1')
      expect(first.items[0].quantity).toBe(2)
      expect(first.items[0].optionText).toBe('색상: 블루 / 사이즈: M')
      expect(first.totalAmount).toBe(30000)
      expect(first.rawData).toBeDefined()
    })
  })

  describe('getClaimsOrders', () => {
    it('returns an empty list until the ESM claims endpoint is wired', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const claims = await adapter.getClaimsOrders(since)

      expect(claims).toEqual([])
    })
  })

  describe('uploadInvoice', () => {
    it('returns success on invoice upload', async () => {
      const result = await adapter.uploadInvoice('ESM-G-20260402-001', {
        trackingNumber: '1234567890',
        carrierId: 'CJGLS',
      })
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// Auction Adapter Tests
// ============================================================================

describe('EsmAdapter (Auction)', () => {
  const adapter = new EsmAdapter({
    master_id: 'test-master',
    secret_key: 'test-secret',
    seller_id: 'test-auction-seller',
    site_type: 'A',
  })

  it('has correct Auction config', () => {
    expect(adapter.config.id).toBe('auction')
    expect(adapter.config.name).toBe('옥션')
    expect(adapter.config.authType).toBe('api_key')
    expect(adapter.config.rateLimitPerSecond).toBe(30)
    expect(adapter.config.requiredCredentials).toEqual(['master_id', 'secret_key', 'seller_id'])
  })

  it('authenticate() returns success', async () => {
    const result = await adapter.authenticate()
    expect(result.success).toBe(true)
  })

  it('testConnection() returns success', async () => {
    const result = await adapter.testConnection()
    expect(result.success).toBe(true)
  })

  describe('getOrders', () => {
    it('normalizes Auction orders to NormalizedOrder[]', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const orders = await adapter.getOrders(since)

      const auctionMocks = MOCK_ESM_ORDERS.filter((o) => o.siteType === 'A')
      expect(orders).toHaveLength(auctionMocks.length)

      const first = orders[0]
      expect(first.marketplaceOrderId).toBe('ESM-A-20260402-002')
      expect(first.marketplaceId).toBe('auction')
      expect(first.marketplaceStatus).toBe('DELIVERING')
      expect(first.status).toBe('shipped')
      expect(first.buyerName).toBe('박옥션')
      expect(first.recipientName).toBe('최수령')
      expect(first.items[0].productName).toBe('옥션 테스트 상품 2')
      expect(first.totalAmount).toBe(25000)
    })
  })

  describe('getClaimsOrders', () => {
    it('returns empty array when no Auction claims exist', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const claims = await adapter.getClaimsOrders(since)

      expect(claims).toEqual([])
    })
  })

  describe('uploadInvoice', () => {
    it('returns success on invoice upload', async () => {
      const result = await adapter.uploadInvoice('ESM-A-20260402-002', {
        trackingNumber: '9876543210',
        carrierId: 'HANJIN',
      })
      expect(result.success).toBe(true)
    })
  })
})
