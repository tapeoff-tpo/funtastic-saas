import { describe, expect, it } from 'vitest'
import { normalizeTrackingNumber } from '@/lib/shipping/tracking-number'

describe('normalizeTrackingNumber', () => {
  it('normalizes formatted and lowercase tracking numbers for scan lookup', () => {
    expect(normalizeTrackingNumber(' ab-12 34 ')).toBe('AB1234')
  })

  it('handles empty values', () => {
    expect(normalizeTrackingNumber(null)).toBe('')
  })
})
