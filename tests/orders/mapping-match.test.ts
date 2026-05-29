import { describe, expect, it } from 'vitest'
import {
  buildMappingIndex,
  getRawMappingCandidateIds,
  isBlockedMappingSource,
  isBlockedMappingSourcePair,
  lookupMappingRef,
} from '@/lib/orders/mapping-match'

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

describe('mapping source guards', () => {
  it('blocks marketplace order-line ids that must not become product mapping keys', () => {
    expect(isBlockedMappingSource('naver', '2026052987585031')).toBe(true)
    expect(isBlockedMappingSource('ownerclan', '20260529123456A-W15FEF3')).toBe(true)
    expect(isBlockedMappingSource('ssgmall', '20260529306414')).toBe(true)
    expect(isBlockedMappingSourcePair('cjonestyle', '001', '001-001')).toBe(true)
  })

  it('extracts stable product ids from nested marketplace payloads', () => {
    expect(getRawMappingCandidateIds({
      productOrders: [{ productId: 5204136979, optionManageCode: '5204136979_2' }],
      originalData: [{ productOrder: { originalProductId: '5184242974' } }],
    })).toEqual(['5204136979_2', '5204136979', '5184242974'])
  })
})
