import { describe, expect, it } from 'vitest'
import { calculateChannelBundle } from './channel-product-overrides'

const base = {
  id: 'test',
  channelKey: 'ohouse',
  channelName: '오늘의집',
  channelProductId: '4170322',
  sourceKey: '111723-0001-3SET',
  productName: '파일 서류 정리함 좁은형 3개 세트',
  optionName: null,
  components: [{ sku: '111723-0001', quantity: 3 }],
  salePrice: 16900,
  regularPrice: 29700,
  shippingFee: 0,
  commissionRate: 20,
  registeredStock: 30,
  saleStatus: '검수 후 판매대기',
  lastCheckedAt: '2026-07-27',
  notes: '무료배송',
}

describe('calculateChannelBundle', () => {
  it('실재고를 구성수량으로 나눈 내림값으로 판매 가능 세트를 계산한다', () => {
    const result = calculateChannelBundle(base, new Map([['111723-0001', 92]]), new Map([['111723-0001', 2704]]), new Map([['111723-0001', 11000]]), new Map([['111723-0001', 3000]]))
    expect(result.availableBundleStock).toBe(30)
    expect(result.hasExcessRegisteredStock).toBe(false)
    expect(result.componentCost).toBe(8112)
    expect(result.netPayout).toBe(13520)
    expect(result.estimatedProfit).toBe(2408)
  })

  it('등록 재고 초과와 실배송비 미확인을 경고한다', () => {
    const result = calculateChannelBundle({ ...base, registeredStock: 31 }, new Map([['111723-0001', 92]]), new Map([['111723-0001', 2704]]), new Map(), new Map())
    expect(result.hasExcessRegisteredStock).toBe(true)
    expect(result.warnings).toContain('실배송비 미확인')
    expect(result.warnings.some((warning) => warning.includes('초과'))).toBe(true)
  })
})
