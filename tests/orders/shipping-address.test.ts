import { describe, expect, it } from 'vitest'
import { formatShippingAddress, normalizeShippingAddress } from '@/lib/orders/shipping-address'

describe('shipping address normalization', () => {
  it('extracts a labeled postal code from address1', () => {
    const normalized = normalizeShippingAddress({
      zipCode: '',
      address1: '\uc6b0\ud3b8\ubc88\ud638 : 34127 \uc8fc\uc18c : \ub300\uc804\uad11\uc5ed\uc2dc \uc720\uc131\uad6c \uc8fd\ub3d9\ub85c297\ubc88\uae38 83 (\uc8fd\ub3d9) 702\ud638',
    })

    expect(normalized).toEqual({
      zipCode: '34127',
      address1: '\ub300\uc804\uad11\uc5ed\uc2dc \uc720\uc131\uad6c \uc8fd\ub3d9\ub85c297\ubc88\uae38 83 (\uc8fd\ub3d9) 702\ud638',
      address2: '',
    })
    expect(formatShippingAddress(normalized)).toBe('[34127] \ub300\uc804\uad11\uc5ed\uc2dc \uc720\uc131\uad6c \uc8fd\ub3d9\ub85c297\ubc88\uae38 83 (\uc8fd\ub3d9) 702\ud638')
  })

  it('keeps normal structured addresses unchanged', () => {
    expect(normalizeShippingAddress({
      zipCode: '06234',
      address1: '\uc11c\uc6b8\ud2b9\ubcc4\uc2dc \uac15\ub0a8\uad6c \ud14c\ud5e4\ub780\ub85c 123',
      address2: '101\ud638',
    })).toEqual({
      zipCode: '06234',
      address1: '\uc11c\uc6b8\ud2b9\ubcc4\uc2dc \uac15\ub0a8\uad6c \ud14c\ud5e4\ub780\ub85c 123',
      address2: '101\ud638',
    })
  })

  it('keeps the road address when road and jibun addresses are concatenated', () => {
    const normalized = normalizeShippingAddress({
      zipCode: '07334',
      address1: '\uc11c\uc6b8\ud2b9\ubcc4\uc2dc \uc601\ub4f1\ud3ec\uad6c \uc5ec\uc758\ub300\ubc29\ub85c 359 (KBS\ubcc4\uad00) \uc7a5\uc2dd\uc81c\uc791\ubd80 \uc11c\uc6b8\ud2b9\ubcc4\uc2dc \uc601\ub4f1\ud3ec\uad6c \uc5ec\uc758\ub3c4\ub3d9 46 KBS\ubcc4\uad00 \uc7a5\uc2dd\uc81c\uc791\ubd80',
    })

    expect(normalized).toEqual({
      zipCode: '07334',
      address1: '\uc11c\uc6b8\ud2b9\ubcc4\uc2dc \uc601\ub4f1\ud3ec\uad6c \uc5ec\uc758\ub300\ubc29\ub85c 359 (KBS\ubcc4\uad00) \uc7a5\uc2dd\uc81c\uc791\ubd80',
      address2: '',
    })
  })
})
