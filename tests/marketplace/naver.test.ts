/**
 * Tests for Naver marketplace adapter.
 *
 * Tests OAuth2 token management, proactive refresh, status mapping,
 * and order/claims normalization via MSW-mocked API responses.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  naverHandlers,
  MOCK_NAVER_TOKEN_RESPONSE,
  MOCK_NAVER_LAST_CHANGED_STATUSES,
  MOCK_NAVER_PRODUCT_ORDERS,
  MOCK_NAVER_CLAIM_PRODUCT_ORDERS,
} from '../helpers/msw-handlers'
import { mapNaverStatus, mapNaverClaimStatus } from '@/lib/marketplace/adapters/naver/status-map'
import { createNaverClient } from '@/lib/marketplace/adapters/naver/client'
import { NaverAdapter } from '@/lib/marketplace/adapters/naver/adapter'

const server = setupServer(...naverHandlers)
const NAVER_TEST_CLIENT_SECRET = '$2a$10$abcdefghijklmnopqrstuu'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('mapNaverStatus', () => {
  it('maps PAYED to new', () => {
    expect(mapNaverStatus('PAYED')).toBe('new')
  })

  it('maps PAYMENT_WAITING to new', () => {
    expect(mapNaverStatus('PAYMENT_WAITING')).toBe('new')
  })

  it('maps DELIVERING to delivering', () => {
    expect(mapNaverStatus('DELIVERING')).toBe('delivering')
  })

  it('maps DELIVERED to delivered', () => {
    expect(mapNaverStatus('DELIVERED')).toBe('delivered')
  })

  it('maps PURCHASE_DECIDED to delivered', () => {
    expect(mapNaverStatus('PURCHASE_DECIDED')).toBe('delivered')
  })

  it('maps CANCELED to cancelled', () => {
    expect(mapNaverStatus('CANCELED')).toBe('cancelled')
  })

  it('returns new as fallback for unknown statuses with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapNaverStatus('UNKNOWN')
    expect(result).toBe('new')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN'))
    warnSpy.mockRestore()
  })
})

describe('mapNaverClaimStatus', () => {
  it('maps CANCEL_REQUEST to requested', () => {
    expect(mapNaverClaimStatus('CANCEL_REQUEST')).toBe('requested')
  })

  it('maps CANCEL_DONE to completed', () => {
    expect(mapNaverClaimStatus('CANCEL_DONE')).toBe('completed')
  })

  it('maps RETURN_DONE to completed', () => {
    expect(mapNaverClaimStatus('RETURN_DONE')).toBe('completed')
  })

  it('returns requested as fallback for unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mapNaverClaimStatus('UNKNOWN')).toBe('requested')
    warnSpy.mockRestore()
  })
})

describe('createNaverClient - token management', () => {
  it('fetches and caches OAuth2 token', async () => {
    const { getToken, getState } = createNaverClient('test-client-id', NAVER_TEST_CLIENT_SECRET)

    const token = await getToken()
    expect(token).toBe(MOCK_NAVER_TOKEN_RESPONSE.access_token)

    const state = getState()
    expect(state.accessToken).toBe(MOCK_NAVER_TOKEN_RESPONSE.access_token)
    expect(state.tokenExpiresAt).toBeGreaterThan(Date.now())
  })

  it('returns cached token on subsequent calls', async () => {
    let callCount = 0
    server.use(
      http.post('https://api.commerce.naver.com/external/v1/oauth2/token', () => {
        callCount++
        return HttpResponse.json(MOCK_NAVER_TOKEN_RESPONSE)
      })
    )

    const { getToken } = createNaverClient('test-id', NAVER_TEST_CLIENT_SECRET)

    await getToken()
    await getToken()
    await getToken()

    // Should only have called the token endpoint once
    expect(callCount).toBe(1)
  })

  it('refreshes proactively when token is near expiry (5 min buffer)', async () => {
    let callCount = 0
    server.use(
      http.post('https://api.commerce.naver.com/external/v1/oauth2/token', () => {
        callCount++
        return HttpResponse.json({
          ...MOCK_NAVER_TOKEN_RESPONSE,
          // Token expires in 4 minutes (less than 5 min buffer)
          expires_in: 240,
        })
      })
    )

    const { getToken } = createNaverClient('test-id', NAVER_TEST_CLIENT_SECRET)

    await getToken() // First call - gets token
    await getToken() // Second call - token within 5 min buffer, should refresh

    expect(callCount).toBe(2)
  })
})

describe('NaverAdapter', () => {
  const adapter = new NaverAdapter({
    client_id: 'test-client-id',
    client_secret: NAVER_TEST_CLIENT_SECRET,
  })

  it('has correct config', () => {
    expect(adapter.config.id).toBe('naver')
    expect(adapter.config.authType).toBe('oauth2')
    expect(adapter.config.requiredCredentials).toContain('client_id')
    expect(adapter.config.requiredCredentials).toContain('client_secret')
  })

  describe('authenticate', () => {
    it('exchanges credentials for access token and returns success', async () => {
      const result = await adapter.authenticate()
      expect(result.success).toBe(true)
      expect(result.expiresAt).toBeInstanceOf(Date)
    })
  })

  describe('testConnection', () => {
    it('verifies credentials by obtaining a token', async () => {
      const result = await adapter.testConnection()
      expect(result.success).toBe(true)
    })
  })

  describe('getOrders', () => {
    it('fetches and normalizes Naver orders using two-step pattern', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const orders = await adapter.getOrders(since, new Date('2026-04-02T23:59:00Z'))

      expect(orders).toHaveLength(MOCK_NAVER_PRODUCT_ORDERS.data.length)

      // Check first order normalization
      const first = orders[0]
      expect(first.marketplaceOrderId).toBe('NO-2026040201001')
      expect(first.marketplaceId).toBe('naver')
      expect(first.marketplaceStatus).toBe('PAYED')
      expect(first.status).toBe('new')
      expect(first.buyerName).toBe('김네이버')
      expect(first.shippingAddress.zipCode).toBe('03088')
      expect(first.shippingAddress.address1).toBe('서울특별시 종로구 율곡로 10')
      expect(first.items).toHaveLength(1)
      expect(first.items[0].marketplaceItemId).toBe('PO-2026040201001')
      expect(first.items[0].productName).toBe('네이버 테스트 상품 1')
      expect(first.items[0].quantity).toBe(3)
      expect(first.items[0].optionText).toBe('색상: 빨강 / 사이즈: L')
      expect(first.totalAmount).toBe(36000)
      expect(first.rawData).toBeDefined()

      // Check second order
      const second = orders[1]
      expect(second.status).toBe('delivering')
      expect(second.marketplaceStatus).toBe('DELIVERING')
    })

    it('reads all change statuses and follows continuation for historical collection', async () => {
      let statusCalls = 0
      let queriedIds: string[] = []
      server.use(
        http.get('https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/last-changed-statuses', ({ request }) => {
          const url = new URL(request.url)
          expect(url.searchParams.has('lastChangedType')).toBe(false)
          statusCalls += 1
          if (statusCalls === 1) {
            return HttpResponse.json({
              data: {
                lastChangeStatuses: [MOCK_NAVER_LAST_CHANGED_STATUSES.data.lastChangeStatuses[0]],
                more: { moreFrom: '2026-04-02T11:00:00.000+09:00', moreSequence: 'PO-2026040201001' },
              },
            })
          }
          expect(url.searchParams.get('moreSequence')).toBe('PO-2026040201001')
          return HttpResponse.json({
            data: { lastChangeStatuses: [MOCK_NAVER_LAST_CHANGED_STATUSES.data.lastChangeStatuses[1]] },
          })
        }),
        http.post('https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/query', async ({ request }) => {
          const body = await request.json() as { productOrderIds: string[] }
          queriedIds = body.productOrderIds
          return HttpResponse.json(MOCK_NAVER_PRODUCT_ORDERS)
        })
      )

      const orders = await adapter.getOrders(
        new Date('2026-04-02T00:00:00Z'),
        new Date('2026-04-02T23:59:00Z'),
      )

      expect(orders).toHaveLength(2)
      expect(statusCalls).toBe(2)
      expect(queriedIds).toEqual(['PO-2026040201001', 'PO-2026040201002'])
    })
  })

  describe('getClaimsOrders', () => {
    it('fetches and normalizes Naver claims', async () => {
      const since = new Date('2026-04-02T00:00:00Z')
      const claims = await adapter.getClaimsOrders(since)

      expect(claims).toHaveLength(MOCK_NAVER_CLAIM_PRODUCT_ORDERS.data.length)

      const claim = claims[0]
      expect(claim.marketplaceClaimId).toBe('PO-2026040201003')
      expect(claim.marketplaceId).toBe('naver')
      expect(claim.marketplaceOrderId).toBe('NO-2026040201003')
      expect(claim.claimType).toBe('cancel')
      expect(claim.claimStatus).toBe('completed')
      expect(claim.reason).toBe('단순변심')
      expect(claim.rawData).toBeDefined()
    })
  })

  describe('confirmOrder', () => {
    it('confirms only product orders that are still paid', async () => {
      let confirmedIds: string[] = []
      server.use(
        http.post('https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/confirm', async ({ request }) => {
          const body = await request.json() as { productOrderIds: string[] }
          confirmedIds = body.productOrderIds
          return HttpResponse.json({ data: { successProductOrderIds: confirmedIds, failProductOrderIds: [] } })
        })
      )

      const result = await adapter.confirmOrder('NO-2026040201001', {
        productOrders: MOCK_NAVER_PRODUCT_ORDERS.data.map((entry) => entry.productOrder),
      })

      expect(result.success).toBe(true)
      expect(confirmedIds).toEqual(['PO-2026040201001'])
    })
  })
})
