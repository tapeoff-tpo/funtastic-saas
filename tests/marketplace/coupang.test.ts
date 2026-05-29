/**
 * Tests for Coupang marketplace adapter.
 *
 * Tests HMAC-SHA256 signing, datetime formatting, status mapping,
 * and order/claims normalization via MSW-mocked API responses.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { coupangHandlers, MOCK_COUPANG_ORDER_SHEETS, MOCK_COUPANG_RETURN_REQUESTS } from '../helpers/msw-handlers'
import { generateCoupangAuth, formatCoupangDatetime } from '@/lib/marketplace/adapters/coupang/client'
import { mapCoupangStatus, mapCoupangClaimStatus, COUPANG_STATUS_MAP } from '@/lib/marketplace/adapters/coupang/status-map'
import { CoupangAdapter } from '@/lib/marketplace/adapters/coupang/adapter'

const server = setupServer(...coupangHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('formatCoupangDatetime', () => {
  it('uses 2-digit year format yyMMddTHHmmssZ', () => {
    const date = new Date('2026-04-02T10:30:45Z')
    const result = formatCoupangDatetime(date)
    // 26 (2-digit year), 04, 02, T, 10, 30, 45, Z
    expect(result).toBe('260402T103045Z')
  })

  it('pads single-digit months and days', () => {
    const date = new Date('2026-01-05T03:07:09Z')
    const result = formatCoupangDatetime(date)
    expect(result).toBe('260105T030709Z')
  })
})

describe('generateCoupangAuth', () => {
  it('returns string starting with CEA algorithm=HmacSHA256', () => {
    const result = generateCoupangAuth('GET', '/test/path', 'query=1', 'testAccessKey', 'testSecretKey')
    expect(result).toMatch(/^CEA algorithm=HmacSHA256/)
  })

  it('includes access-key in the header', () => {
    const result = generateCoupangAuth('GET', '/path', '', 'myAccessKey', 'mySecretKey')
    expect(result).toContain('access-key=myAccessKey')
  })

  it('includes signed-date in the header', () => {
    const result = generateCoupangAuth('GET', '/path', '', 'key', 'secret')
    expect(result).toMatch(/signed-date=\d{6}T\d{6}Z/)
  })

  it('includes signature in the header', () => {
    const result = generateCoupangAuth('GET', '/path', '', 'key', 'secret')
    expect(result).toMatch(/signature=[a-f0-9]{64}/)
  })
})

describe('mapCoupangStatus', () => {
  it('maps ACCEPT to new', () => {
    expect(mapCoupangStatus('ACCEPT')).toBe('new')
  })

  it('maps INSTRUCT to preparing', () => {
    expect(mapCoupangStatus('INSTRUCT')).toBe('preparing')
  })

  it('maps DEPARTURE to shipped', () => {
    expect(mapCoupangStatus('DEPARTURE')).toBe('shipped')
  })

  it('maps DELIVERING to delivering', () => {
    expect(mapCoupangStatus('DELIVERING')).toBe('delivering')
  })

  it('maps FINAL_DELIVERY to delivered', () => {
    expect(mapCoupangStatus('FINAL_DELIVERY')).toBe('delivered')
  })

  it('returns new as fallback for unknown statuses with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapCoupangStatus('UNKNOWN_VALUE')
    expect(result).toBe('new')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN_VALUE'))
    warnSpy.mockRestore()
  })
})

describe('mapCoupangClaimStatus', () => {
  it('maps RECEIPT to requested', () => {
    expect(mapCoupangClaimStatus('RECEIPT')).toBe('requested')
  })

  it('maps RETURNS_COMPLETED to completed', () => {
    expect(mapCoupangClaimStatus('RETURNS_COMPLETED')).toBe('completed')
  })

  it('returns requested as fallback for unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mapCoupangClaimStatus('UNKNOWN')).toBe('requested')
    warnSpy.mockRestore()
  })
})

describe('CoupangAdapter', () => {
  const adapter = new CoupangAdapter({
    access_key: 'test-access-key',
    secret_key: 'test-secret-key',
    vendor_id: 'A00012345',
  })

  it('has correct config', () => {
    expect(adapter.config.id).toBe('coupang')
    expect(adapter.config.authType).toBe('hmac')
    expect(adapter.config.requiredCredentials).toContain('access_key')
    expect(adapter.config.requiredCredentials).toContain('secret_key')
    expect(adapter.config.requiredCredentials).toContain('vendor_id')
  })

  it('rejects account aliases entered as Vendor ID', () => {
    expect(() => new CoupangAdapter({
      access_key: 'test-access-key',
      secret_key: 'test-secret-key',
      vendor_id: 'tapeoff',
    })).toThrow('Vendor ID')
  })

  it('authenticate() returns success (HMAC has no separate auth flow)', async () => {
    const result = await adapter.authenticate()
    expect(result.success).toBe(true)
  })

  describe('getOrders', () => {
    it('normalizes Coupang orders to NormalizedOrder[]', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const orders = await adapter.getOrders(since)

      expect(orders).toHaveLength(1)

      // Check first order normalization
      const first = orders[0]
      expect(first.marketplaceOrderId).toBe('1001')
      expect(first.marketplaceId).toBe('coupang')
      expect(first.marketplaceStatus).toBe('ACCEPT')
      expect(first.status).toBe('new')
      expect(first.buyerName).toBe('김구매')
      expect(first.recipientName).toBe('이수령')
      expect(first.recipientPhone2).toBe('010-1234-5678')
      expect(first.shippingAddress.zipCode).toBe('06134')
      expect(first.shippingAddress.address1).toBe('서울특별시 강남구 테헤란로 123')
      expect(first.items).toHaveLength(1)
      expect(first.items[0].productName).toBe('테스트 상품 A')
      expect(first.items[0].quantity).toBe(2)
      expect(first.totalAmount).toBe(29800)
      expect(first.rawData).toBeDefined()

      expect(orders.map((order) => order.marketplaceStatus)).toEqual(['ACCEPT'])
    })
  })

  describe('getClaimsOrders', () => {
    it('normalizes return requests to NormalizedClaim[]', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const claims = await adapter.getClaimsOrders(since)

      expect(claims).toHaveLength(MOCK_COUPANG_RETURN_REQUESTS.length)

      const claim = claims[0]
      expect(claim.marketplaceClaimId).toBe('9001')
      expect(claim.marketplaceId).toBe('coupang')
      expect(claim.marketplaceOrderId).toBe('1001')
      expect(claim.claimType).toBe('return')
      expect(claim.claimStatus).toBe('requested')
      expect(claim.reason).toBe('상품 불량')
      expect(claim.rawData).toBeDefined()
    })
  })

  describe('confirmOrder', () => {
    it('uses the v4 PATCH acknowledgement endpoint', async () => {
      const result = await adapter.confirmOrder('1001', {
        shipmentBoxId: 123456789,
      })

      expect(result).toEqual({ success: true })
    })
  })
})
