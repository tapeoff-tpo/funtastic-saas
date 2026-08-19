import { describe, expect, it } from 'vitest'
import { resolveOutboundSalesAmount } from './outbound-reflection'

describe('resolveOutboundSalesAmount', () => {
  it('uses 판매가x수량 when the regular marketplace payment amount is zero', () => {
    expect(resolveOutboundSalesAmount({
      parsedAmount: 0,
      raw: { '판매가x수량': '13,500' },
      marketplaceName: '온채널',
      marketplaceId: 'onchannel',
    })).toBe(13_500)
  })

  it('keeps the payment amount when it is already present', () => {
    expect(resolveOutboundSalesAmount({
      parsedAmount: 12_000,
      raw: { '판매가x수량': '13,500' },
      marketplaceName: '온채널',
      marketplaceId: 'onchannel',
    })).toBe(12_000)
  })

  it.each([
    ['쿠팡 로켓배송(신)', 'coupang-rocket'],
    ['M테이포프(대량)', 'manual-bulk'],
  ])('does not recover separately entered marketplace %s', (marketplaceName, marketplaceId) => {
    expect(resolveOutboundSalesAmount({
      parsedAmount: 0,
      raw: { '판매가x수량': '13,500' },
      marketplaceName,
      marketplaceId,
    })).toBe(0)
  })
})
