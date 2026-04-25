import { describe, it, expect } from 'vitest'
import { normalizeCoupangShippingType } from '@/lib/marketplace/adapters/coupang/adapter'

describe('normalizeCoupangShippingType', () => {
  it.each([
    ['선불', 'prepaid'],
    ['선결제', 'prepaid'],
    ['착불', 'cod'],
    ['무료', 'free'],
    ['무료배송', 'free'],
    ['', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    ['알수없음', 'unknown'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCoupangShippingType(input as string | null | undefined)).toBe(expected)
  })
})

describe('Coupang normalizeOrder shippingFee/Type', () => {
  it.todo('integration — 실제 normalizeOrder 호출 시 shippingPrice.units가 shippingFee에 매핑')
})
