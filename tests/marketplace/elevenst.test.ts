/**
 * Tests for 11st (11번가) marketplace adapter.
 *
 * Tests API key auth, XML parsing, status mapping,
 * and order/claims normalization via MSW-mocked XML API responses.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { elevenstHandlers, MOCK_ELEVENST_ORDERS } from '../helpers/msw-handlers'
import { parseXmlResponse } from '@/lib/marketplace/adapters/elevenst/client'
import {
  mapElevenstStatus,
  mapElevenstClaimStatus,
  mapElevenstClaimType,
  ELEVENST_STATUS_MAP,
  ELEVENST_CLAIM_TYPE_MAP,
  ELEVENST_CLAIM_STATUS_MAP,
} from '@/lib/marketplace/adapters/elevenst/status-map'
import { ElevenstAdapter } from '@/lib/marketplace/adapters/elevenst/adapter'

const server = setupServer(...elevenstHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('parseXmlResponse', () => {
  it('parses simple XML to object with all values as strings', () => {
    const xml = '<root><name>test</name><value>123</value></root>'
    const result = parseXmlResponse<{ root: { name: string; value: string } }>(xml)
    expect(result.root.name).toBe('test')
    expect(result.root.value).toBe('123') // parseTagValue: false keeps all values as strings
  })

  it('preserves XML attributes with @_ prefix', () => {
    const xml = '<item id="42">content</item>'
    const result = parseXmlResponse<{ item: { '@_id': string; '#text': string } }>(xml)
    expect(result.item['@_id']).toBe('42')
  })
})

describe('mapElevenstStatus', () => {
  it('maps 202 to new (결제완료)', () => {
    expect(mapElevenstStatus('202')).toBe('new')
  })

  it('maps 301 to confirmed (상품준비중)', () => {
    expect(mapElevenstStatus('301')).toBe('confirmed')
  })

  it('maps 302 to preparing (배송준비중)', () => {
    expect(mapElevenstStatus('302')).toBe('preparing')
  })

  it('maps 303 to shipped (배송중)', () => {
    expect(mapElevenstStatus('303')).toBe('shipped')
  })

  it('maps 304 to delivered (배송완료)', () => {
    expect(mapElevenstStatus('304')).toBe('delivered')
  })

  it('returns new as fallback for unknown statuses with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapElevenstStatus('999')
    expect(result).toBe('new')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('999'))
    warnSpy.mockRestore()
  })
})

describe('mapElevenstClaimType', () => {
  it('maps CNC to cancel', () => {
    expect(mapElevenstClaimType('CNC')).toBe('cancel')
  })

  it('maps RTN to return', () => {
    expect(mapElevenstClaimType('RTN')).toBe('return')
  })

  it('maps EXC to exchange', () => {
    expect(mapElevenstClaimType('EXC')).toBe('exchange')
  })

  it('returns cancel as fallback for unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mapElevenstClaimType('UNKNOWN')).toBe('cancel')
    warnSpy.mockRestore()
  })
})

describe('mapElevenstClaimStatus', () => {
  it('maps 100 to requested', () => {
    expect(mapElevenstClaimStatus('100')).toBe('requested')
  })

  it('maps 200 to processing', () => {
    expect(mapElevenstClaimStatus('200')).toBe('processing')
  })

  it('maps 300 to completed', () => {
    expect(mapElevenstClaimStatus('300')).toBe('completed')
  })

  it('maps 400 to rejected', () => {
    expect(mapElevenstClaimStatus('400')).toBe('rejected')
  })

  it('returns requested as fallback for unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mapElevenstClaimStatus('999')).toBe('requested')
    warnSpy.mockRestore()
  })
})

describe('ElevenstAdapter', () => {
  const adapter = new ElevenstAdapter({ api_key: 'test-11st-api-key' })

  it('has correct config', () => {
    expect(adapter.config.id).toBe('elevenst')
    expect(adapter.config.name).toBe('11번가')
    expect(adapter.config.authType).toBe('api_key')
    expect(adapter.config.rateLimitPerSecond).toBe(30)
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
    it('normalizes 11st XML orders to NormalizedOrder[]', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const orders = await adapter.getOrders(since)

      expect(orders).toHaveLength(MOCK_ELEVENST_ORDERS.length)

      // Check first order normalization
      const first = orders[0]
      expect(first.marketplaceOrderId).toBe('E2026040200001')
      expect(first.marketplaceId).toBe('elevenst')
      expect(first.marketplaceStatus).toBe('202')
      expect(first.status).toBe('new')
      expect(first.buyerName).toBe('김열한')
      expect(first.buyerPhone).toBe('010-1111-1111')
      expect(first.recipientName).toBe('박수령')
      expect(first.recipientPhone).toBe('010-2222-2222')
      expect(first.shippingAddress.zipCode).toBe('04524')
      expect(first.shippingAddress.address1).toBe('서울특별시 중구 남대문로 120')
      expect(first.shippingAddress.address2).toBe('5층 501호')
      expect(first.items).toHaveLength(1)
      expect(first.items[0].productName).toBe('11번가 테스트 상품 A')
      expect(first.items[0].quantity).toBe(2)
      expect(first.items[0].unitPrice).toBe(15900)
      expect(first.items[0].optionText).toBe('색상: 화이트')
      expect(first.totalAmount).toBe(31800) // 2 * 15900
      expect(first.rawData).toBeDefined()

      // Check second order has different status mapping
      const second = orders[1]
      expect(second.status).toBe('shipped')
      expect(second.marketplaceStatus).toBe('303')
      expect(second.buyerName).toBe('이구매')
    })
  })

  describe('getClaimsOrders', () => {
    it('returns an empty list until the 11st claims endpoint is wired', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const claims = await adapter.getClaimsOrders(since)

      expect(claims).toEqual([])
    })
  })

  describe('uploadInvoice', () => {
    it('returns success for valid invoice upload', async () => {
      const result = await adapter.uploadInvoice('E2026040200001', {
        trackingNumber: '1234567890',
        carrierId: 'CJGLS',
      })

      expect(result.success).toBe(true)
    })
  })
})
