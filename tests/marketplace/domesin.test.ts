import { describe, expect, it } from 'vitest'
import { DomesinAdapter } from '@/lib/marketplace/adapters/domesin/adapter'

describe('DomesinAdapter', () => {
  it('does not report confirmOrder success when no real Domesin confirmation API is implemented', async () => {
    const adapter = new DomesinAdapter({ api_key: 'api-key', seller_id: 'seller' })

    const result = await adapter.confirmOrder('DS-ORDER-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('지원')
  })
})
