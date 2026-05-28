import { describe, expect, it } from 'vitest'
import { normalizeMarketplaceCollectionStatus } from '@/lib/marketplace/collection-status'

describe('normalizeMarketplaceCollectionStatus', () => {
  it('keeps paid Domeggook orders as new before shipping prep acknowledgement', () => {
    expect(normalizeMarketplaceCollectionStatus('결제완료')).toBe('new')
  })

  it('does not confuse shipping completion with payment completion', () => {
    expect(normalizeMarketplaceCollectionStatus('배송완료')).toBe('delivered')
  })
})
