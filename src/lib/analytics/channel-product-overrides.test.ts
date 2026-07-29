import { describe, expect, it } from 'vitest'
import { calculateChannelBundle, parseChannelBundleOverrideRow } from './channel-product-overrides'

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

describe('parseChannelBundleOverrideRow', () => {
  it('엑셀 행의 단일 원본 SKU와 구성수량을 묶음 구성으로 변환한다', () => {
    const result = parseChannelBundleOverrideRow({
      채널: '오늘의집',
      채널상품ID: '4170322',
      묶음SKU: '111723-0001-3SET',
      상품명: '파일 정리함 3개 세트',
      원본SKU: '111723-0001',
      구성수량: '3',
      판매가: '16,900원',
      수수료율: '20%',
      마지막확인일: '2026.07.29',
    })
    expect(result.channelKey).toBe('ohouse')
    expect(result.components).toEqual([{ sku: '111723-0001', quantity: 3 }])
    expect(result.salePrice).toBe(16900)
    expect(result.commissionRate).toBe(20)
    expect(result.lastCheckedAt).toBe('2026-07-29')
  })

  it('원본 SKU에 수량을 함께 쓰면 여러 구성품을 읽는다', () => {
    const result = parseChannelBundleOverrideRow({
      채널: 'ohouse',
      채널상품ID: '4170368',
      묶음SKU: 'hook-set',
      상품명: '후크 세트',
      원본SKU: '111654-0001*2, 111654-0002*1',
      판매가: 14900,
      수수료율: 18,
    })
    expect(result.components).toEqual([
      { sku: '111654-0001', quantity: 2 },
      { sku: '111654-0002', quantity: 1 },
    ])
  })
})
