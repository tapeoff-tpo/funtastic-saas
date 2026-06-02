import { describe, expect, it } from 'vitest'
import { formatShippingAddress, normalizeShippingAddress } from '@/lib/orders/shipping-address'

describe('shipping address normalization', () => {
  it('extracts a labeled postal code from address1', () => {
    const normalized = normalizeShippingAddress({
      zipCode: '',
      address1: '우편번호 : 34127 주소 : 대전광역시 유성구 죽동로297번길 83 (죽동) 702호',
    })

    expect(normalized).toEqual({
      zipCode: '34127',
      address1: '대전광역시 유성구 죽동로297번길 83 (죽동) 702호',
      address2: '',
    })
    expect(formatShippingAddress(normalized)).toBe('[34127] 대전광역시 유성구 죽동로297번길 83 (죽동) 702호')
  })

  it('keeps normal structured addresses unchanged', () => {
    expect(normalizeShippingAddress({
      zipCode: '06234',
      address1: '서울시 강남구 역삼동',
      address2: '101호',
    })).toEqual({
      zipCode: '06234',
      address1: '서울시 강남구 역삼동',
      address2: '101호',
    })
  })
})
