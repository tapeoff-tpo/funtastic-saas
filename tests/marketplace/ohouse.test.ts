/**
 * Tests for Ohouse (오늘의집) marketplace adapter.
 *
 * Tests Bearer auth, JSON parsing, status mapping,
 * order/claims normalization, and registry registration
 * via MSW-mocked JSON API responses.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { ohouseHandlers, MOCK_OHOUSE_ORDERS, MOCK_OHOUSE_CLAIMS } from '../helpers/msw-handlers'
import {
  mapOhouseStatus,
  mapOhouseClaimType,
  mapOhouseClaimStatus,
  OHOUSE_STATUS_MAP,
  OHOUSE_CLAIM_TYPE_MAP,
  OHOUSE_CLAIM_STATUS_MAP,
} from '@/lib/marketplace/adapters/ohouse/status-map'
import { OhouseAdapter } from '@/lib/marketplace/adapters/ohouse/adapter'

const server = setupServer(...ohouseHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('mapOhouseStatus', () => {
  it('maps PAID to new', () => {
    expect(mapOhouseStatus('PAID')).toBe('new')
  })

  it('maps PREPARING to preparing', () => {
    expect(mapOhouseStatus('PREPARING')).toBe('preparing')
  })

  it('maps SHIPPED to shipped', () => {
    expect(mapOhouseStatus('SHIPPED')).toBe('shipped')
  })

  it('maps DELIVERED to delivered', () => {
    expect(mapOhouseStatus('DELIVERED')).toBe('delivered')
  })

  it('returns new as fallback for unknown statuses with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapOhouseStatus('UNKNOWN_STATUS')
    expect(result).toBe('new')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN_STATUS'))
    warnSpy.mockRestore()
  })
})

describe('mapOhouseClaimType', () => {
  it('maps CANCEL to cancel', () => {
    expect(mapOhouseClaimType('CANCEL')).toBe('cancel')
  })

  it('maps RETURN to return', () => {
    expect(mapOhouseClaimType('RETURN')).toBe('return')
  })

  it('maps EXCHANGE to exchange', () => {
    expect(mapOhouseClaimType('EXCHANGE')).toBe('exchange')
  })

  it('returns cancel as fallback for unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mapOhouseClaimType('UNKNOWN')).toBe('cancel')
    warnSpy.mockRestore()
  })
})

describe('mapOhouseClaimStatus', () => {
  it('maps REQUESTED to requested', () => {
    expect(mapOhouseClaimStatus('REQUESTED')).toBe('requested')
  })

  it('maps PROCESSING to processing', () => {
    expect(mapOhouseClaimStatus('PROCESSING')).toBe('processing')
  })

  it('maps COMPLETED to completed', () => {
    expect(mapOhouseClaimStatus('COMPLETED')).toBe('completed')
  })

  it('maps REJECTED to rejected', () => {
    expect(mapOhouseClaimStatus('REJECTED')).toBe('rejected')
  })

  it('returns requested as fallback for unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mapOhouseClaimStatus('UNKNOWN')).toBe('requested')
    warnSpy.mockRestore()
  })
})

describe('OhouseAdapter', () => {
  const adapter = new OhouseAdapter({ api_key: 'test-ohouse-api-key' })

  it('has correct config', () => {
    expect(adapter.config.id).toBe('ohouse')
    expect(adapter.config.name).toBe('오늘의집')
    expect(adapter.config.authType).toBe('api_key')
    expect(adapter.config.rateLimitPerSecond).toBe(20)
    expect(adapter.config.requiredCredentials).toContain('api_key')
  })

  it('authenticate() returns success (API key has no separate auth flow)', async () => {
    const result = await adapter.authenticate()
    expect(result.success).toBe(true)
  })

  describe('testConnection', () => {
    it('returns success with valid API key', async () => {
      const result = await adapter.testConnection()
      expect(result.success).toBe(true)
    })
  })

  describe('getOrders', () => {
    it('normalizes Ohouse JSON orders to NormalizedOrder[]', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const orders = await adapter.getOrders(since)

      expect(orders).toHaveLength(MOCK_OHOUSE_ORDERS.length)

      // Check first order normalization
      const first = orders[0]
      expect(first.marketplaceOrderId).toBe('OH-20260402-001')
      expect(first.marketplaceId).toBe('ohouse')
      expect(first.marketplaceStatus).toBe('PAID')
      expect(first.status).toBe('new')
      expect(first.buyerName).toBe('김오하우스')
      expect(first.buyerPhone).toBe('010-1234-5678')
      expect(first.recipientName).toBe('이수령')
      expect(first.recipientPhone).toBe('010-8765-4321')
      expect(first.shippingAddress.zipCode).toBe('06134')
      expect(first.shippingAddress.address1).toBe('서울특별시 강남구 테헤란로 789')
      expect(first.shippingAddress.address2).toBe('10층 1001호')
      expect(first.items).toHaveLength(1)
      expect(first.items[0].productName).toBe('오늘의집 테스트 상품 A')
      expect(first.items[0].quantity).toBe(2)
      expect(first.items[0].optionText).toBe('색상: 네이비')
      expect(first.totalAmount).toBe(59800)
      expect(first.rawData).toBeDefined()

      // Check second order has different status mapping
      const second = orders[1]
      expect(second.status).toBe('shipped')
      expect(second.marketplaceStatus).toBe('SHIPPED')
      expect(second.buyerName).toBe('박구매')
    })
  })

  describe('getClaimsOrders', () => {
    it('normalizes Ohouse claims to NormalizedClaim[]', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const claims = await adapter.getClaimsOrders(since)

      expect(claims).toHaveLength(MOCK_OHOUSE_CLAIMS.length)

      const claim = claims[0]
      expect(claim.marketplaceClaimId).toBe('CLM-OH-001')
      expect(claim.marketplaceId).toBe('ohouse')
      expect(claim.marketplaceOrderId).toBe('OH-20260402-001')
      expect(claim.claimType).toBe('return')
      expect(claim.claimStatus).toBe('requested')
      expect(claim.reason).toBe('색상 불일치')
      expect(claim.rawData).toBeDefined()
    })
  })

  describe('uploadInvoice', () => {
    it('returns success for valid invoice upload', async () => {
      const result = await adapter.uploadInvoice('OH-20260402-001', {
        trackingNumber: '1234567890',
        carrierId: 'CJGLS',
      })

      expect(result.success).toBe(true)
    })
  })
})

describe('Registry completeness', () => {
  it('registers ohouse in marketplace registry via configs.ts', async () => {
    // Import configs to trigger auto-registration
    await import('@/lib/marketplace/adapters/configs')
    const { marketplaceRegistry } = await import('@/lib/marketplace/registry')

    expect(marketplaceRegistry.has('ohouse')).toBe(true)
  })

  it('lists all 6 marketplaces in registry', async () => {
    await import('@/lib/marketplace/adapters/configs')
    const { marketplaceRegistry } = await import('@/lib/marketplace/registry')

    const ids = marketplaceRegistry.listIds()
    expect(ids).toContain('coupang')
    expect(ids).toContain('naver')
    expect(ids).toContain('elevenst')
    expect(ids).toContain('gmarket')
    expect(ids).toContain('auction')
    expect(ids).toContain('ohouse')
    expect(ids).toHaveLength(6)
  })
})
