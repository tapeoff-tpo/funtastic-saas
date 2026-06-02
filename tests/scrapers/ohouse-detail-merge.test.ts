import { describe, expect, it } from 'vitest'
import type { NormalizedOrder } from '@/lib/marketplace/types'
import { isOhouseMaskedText, mergeOhouseOrderDetail } from '@/scrapers/ohouse/scraper'

function baseOrder(): NormalizedOrder {
  return {
    marketplaceId: 'ohouse',
    marketplaceOrderId: 'tapeoff:330681319',
    marketplaceStatus: '신규주문',
    status: 'new',
    buyerName: '송*희',
    buyerPhone: '',
    recipientName: '송*희',
    recipientPhone: '',
    shippingAddress: {
      zipCode: '',
      address1: '전라남도 무안군 일로읍 오룡번영1로 ******',
    },
    orderedAt: new Date('2026-06-02T00:20:43Z'),
    totalAmount: 10900,
    deliveryMessage: null,
    rawData: { accountKey: 'tapeoff' },
    items: [
      {
        marketplaceItemId: 'tapeoff:509720960',
        productName: '홈카페 디저트 사각 트레이 예쁜 파스텔 쟁반 3종set',
        optionText: '비비드 Set',
        quantity: 1,
        unitPrice: 10900,
      },
    ],
  }
}

describe('mergeOhouseOrderDetail', () => {
  it('replaces masked recipient fields with revealed detail values', () => {
    const merged = mergeOhouseOrderDetail(baseOrder(), {
      buyerName: '송희',
      buyerPhone: '010-1234-7436',
      recipientName: '송희',
      recipientPhone: '010-1234-7436',
      address1: '[58582] 전라남도 무안군 일로읍 오룡번영1로 123',
      items: [],
    })

    expect(merged.buyerName).toBe('송희')
    expect(merged.buyerPhone).toBe('010-1234-7436')
    expect(merged.recipientName).toBe('송희')
    expect(merged.recipientPhone).toBe('010-1234-7436')
    expect(merged.shippingAddress.zipCode).toBe('58582')
    expect(merged.shippingAddress.address1).toBe('전라남도 무안군 일로읍 오룡번영1로 123')
  })

  it('uses all detail option rows instead of the single representative list row', () => {
    const merged = mergeOhouseOrderDetail(baseOrder(), {
      items: [
        {
          orderProductNo: '509720960',
          orderOptionNo: '655348315',
          productName: '홈카페 디저트 사각 트레이 예쁜 파스텔 쟁반 3종set',
          optionText: '파스텔 Set',
          quantity: 1,
          unitPrice: 10900,
        },
        {
          orderProductNo: '509720960',
          orderOptionNo: '655348316',
          productName: '홈카페 디저트 사각 트레이 예쁜 파스텔 쟁반 3종set',
          optionText: '비비드 Set',
          quantity: 1,
          unitPrice: 10900,
        },
      ],
    })

    expect(merged.items).toHaveLength(2)
    expect(merged.items.map((item) => item.marketplaceItemId)).toEqual([
      'tapeoff:655348315',
      'tapeoff:655348316',
    ])
    expect(merged.items.map((item) => item.optionText)).toEqual(['파스텔 Set', '비비드 Set'])
  })
})

describe('isOhouseMaskedText', () => {
  it('detects privacy-masked values', () => {
    expect(isOhouseMaskedText('송*희')).toBe(true)
    expect(isOhouseMaskedText('010-****-7436')).toBe(true)
    expect(isOhouseMaskedText('-')).toBe(true)
    expect(isOhouseMaskedText('송희')).toBe(false)
  })
})
