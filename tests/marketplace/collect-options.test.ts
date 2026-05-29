import { describe, expect, it } from 'vitest'
import { resolveMarketplaceDisplayName } from '@/lib/marketplace/collect-options'

describe('resolveMarketplaceDisplayName', () => {
  it('normalizes marketplace names that include account suffixes', () => {
    expect(resolveMarketplaceDisplayName('domeggook', '도매꾹 (admin@funtastic.kr)')).toBe(
      '도매꾹',
    )
  })

  it('keeps known marketplace display labels consistent', () => {
    expect(resolveMarketplaceDisplayName('domeggook', '도매꾹')).toBe('도매꾹')
    expect(resolveMarketplaceDisplayName('domeggook', 'domeggook')).toBe('도매꾹')
  })
})
