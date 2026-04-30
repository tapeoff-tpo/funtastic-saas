import { describe, it, expect, beforeEach } from 'vitest'
import { MarketplaceRegistry } from '@/lib/marketplace/registry'
import type { MarketplaceAdapter, MarketplaceCredentials } from '@/lib/marketplace/types'
import { MarketplaceAuthError, MarketplaceRateLimitError, MarketplaceApiError } from '@/lib/marketplace/errors'

function createMockAdapter(overrides: Partial<MarketplaceAdapter['config']> = {}): MarketplaceAdapter {
  return {
    config: {
      id: 'test-market',
      name: 'Test Market',
      authType: 'api_key',
      rateLimitPerSecond: 10,
      requiredCredentials: ['api_key'],
      ...overrides,
    },
    async testConnection(_credentials: MarketplaceCredentials) {
      return { success: true }
    },
    async authenticate() {
      return { success: true }
    },
    async getOrders(_since: Date) {
      return []
    },
    async getClaimsOrders(_since: Date) {
      return []
    },
    async uploadInvoice(_orderId: string, _invoice: unknown) {
      return { success: true }
    },
    async getProducts() {
      return []
    },
    async confirmOrder() {
      return { success: true }
    },
    async registerProduct() {
      return { success: true }
    },
    async updateProduct() {
      return { success: true }
    },
  }
}

describe('MarketplaceRegistry', () => {
  let registry: MarketplaceRegistry

  beforeEach(() => {
    registry = new MarketplaceRegistry()
  })

  it('register(adapter) stores adapter and get(id) returns it', () => {
    const adapter = createMockAdapter()
    registry.register(adapter)
    const result = registry.get('test-market')
    expect(result).toBe(adapter)
  })

  it('register(adapter) with duplicate ID throws', () => {
    const adapter = createMockAdapter()
    registry.register(adapter)
    expect(() => registry.register(adapter)).toThrow('Adapter already registered: test-market')
  })

  it('get(unknown) throws with available IDs', () => {
    const adapter = createMockAdapter()
    registry.register(adapter)
    expect(() => registry.get('unknown')).toThrow('Unknown marketplace: unknown')
  })

  it('has(id) returns true for registered, false for unregistered', () => {
    const adapter = createMockAdapter()
    registry.register(adapter)
    expect(registry.has('test-market')).toBe(true)
    expect(registry.has('unknown')).toBe(false)
  })

  it('listIds() returns all registered marketplace IDs', () => {
    const adapter1 = createMockAdapter({ id: 'market-a', name: 'Market A' })
    const adapter2 = createMockAdapter({ id: 'market-b', name: 'Market B' })
    registry.register(adapter1)
    registry.register(adapter2)
    expect(registry.listIds()).toEqual(['market-a', 'market-b'])
  })

  it('listConfigs() returns MarketplaceConfig[] for all registered adapters', () => {
    const adapter1 = createMockAdapter({ id: 'market-a', name: 'Market A' })
    const adapter2 = createMockAdapter({ id: 'market-b', name: 'Market B' })
    registry.register(adapter1)
    registry.register(adapter2)
    const configs = registry.listConfigs()
    expect(configs).toHaveLength(2)
    expect(configs[0].id).toBe('market-a')
    expect(configs[1].id).toBe('market-b')
  })
})

describe('MarketplaceAuthError', () => {
  it('has correct name, marketplaceId, isExpired properties', () => {
    const error = new MarketplaceAuthError('coupang', 'Token expired', true)
    expect(error.name).toBe('MarketplaceAuthError')
    expect(error.marketplaceId).toBe('coupang')
    expect(error.message).toBe('Token expired')
    expect(error.isExpired).toBe(true)
    expect(error).toBeInstanceOf(Error)
  })

  it('defaults isExpired to false', () => {
    const error = new MarketplaceAuthError('naver', 'Auth failed')
    expect(error.isExpired).toBe(false)
  })
})

describe('MarketplaceRateLimitError', () => {
  it('has correct name, marketplaceId, retryAfterMs properties', () => {
    const error = new MarketplaceRateLimitError('coupang', 5000)
    expect(error.name).toBe('MarketplaceRateLimitError')
    expect(error.marketplaceId).toBe('coupang')
    expect(error.retryAfterMs).toBe(5000)
    expect(error.message).toBe('Rate limited on coupang, retry after 5000ms')
    expect(error).toBeInstanceOf(Error)
  })
})

describe('MarketplaceApiError', () => {
  it('has correct name, marketplaceId, statusCode properties', () => {
    const error = new MarketplaceApiError('elevenst', 500, 'Internal Server Error')
    expect(error.name).toBe('MarketplaceApiError')
    expect(error.marketplaceId).toBe('elevenst')
    expect(error.statusCode).toBe(500)
    expect(error.message).toBe('Internal Server Error')
    expect(error).toBeInstanceOf(Error)
  })
})
