import { describe, expect, it } from 'vitest'
import { buildMappingIndex, lookupMappingRef } from '@/lib/orders/mapping-match'

describe('lookupMappingRef', () => {
  it('matches an option mapping only in the same marketplace', () => {
    const index = buildMappingIndex([
      {
        marketplaceId: 'market-a',
        marketplaceProductId: 'product-1',
        marketplaceOptionId: 'red',
        ref: 'mapping-a',
      },
    ])

    expect(lookupMappingRef(index, 'market-a', 'product-1', 'red')).toBe('mapping-a')
    expect(lookupMappingRef(index, 'market-b', 'product-1', 'red')).toBeNull()
  })

  it('matches a product mapping only in the same marketplace', () => {
    const index = buildMappingIndex([
      {
        marketplaceId: 'market-a',
        marketplaceProductId: 'P001',
        marketplaceOptionId: '',
        ref: 'mapping-a',
      },
    ])

    expect(lookupMappingRef(index, 'market-a', 'P001-red')).toBe('mapping-a')
    expect(lookupMappingRef(index, 'market-b', 'P001-red')).toBeNull()
  })
})
