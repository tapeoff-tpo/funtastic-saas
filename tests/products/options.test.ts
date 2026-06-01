import { describe, expect, it } from 'vitest'
import { summarizeProductVariantOptions } from '@/lib/products/options'

describe('summarizeProductVariantOptions', () => {
  it('shows active variant option names even when inventory option names are empty', () => {
    const summary = summarizeProductVariantOptions([
      { optionName: '실버', optionValues: null, isActive: true },
      { optionName: '블랙', optionValues: null, isActive: true },
    ])

    expect(summary).toBe('실버, 블랙')
  })

  it('uses option values when the variant stores key/value options', () => {
    const summary = summarizeProductVariantOptions([
      { optionName: '색상', optionValues: { 색상: '실버' }, isActive: true },
      { optionName: '색상', optionValues: { 색상: '블랙' }, isActive: true },
    ])

    expect(summary).toBe('색상: 실버, 색상: 블랙')
  })

  it('ignores inactive and blank variants', () => {
    const summary = summarizeProductVariantOptions([
      { optionName: '실버', optionValues: null, isActive: false },
      { optionName: ' ', optionValues: {}, isActive: true },
    ])

    expect(summary).toBeNull()
  })
})
