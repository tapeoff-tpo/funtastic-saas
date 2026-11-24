import { describe, expect, it } from 'vitest'
import { ALIBABA_ORDER_OR_CART_URL_PATTERN, canonicalize1688OfferUrl, is1688OrderOrCartUrl } from './purchase-url-values'

describe('1688 product and order URL separation', () => {
  it.each([
    'https://trade.1688.com/order/new_step_order_detail.htm?orderId=1234567890123',
    'http://buy.1688.com/order/',
    '//cart.1688.com/',
    ' https://work.1688.com/?buyer=true ',
    'HTTPS://TRADE.1688.COM/order',
  ])('recognizes an order/cart address for replacement: %s', value => {
    expect(is1688OrderOrCartUrl(value)).toBe(true)
    expect(new RegExp(ALIBABA_ORDER_OR_CART_URL_PATTERN, 'i').test(value.trim())).toBe(true)
    expect(canonicalize1688OfferUrl(value)).toBeNull()
  })

  it.each([
    'https://detail.1688.com/offer/123456789012.html',
    'https://supplier.example.com/item/123',
    'https://shop123.1688.com/',
    'https://trade.1688.com.evil.test/order',
    'https://trade.1688.com@evil.test/order',
    'https://evil.test/#https://trade.1688.com/order',
    'https://trade.1688.com:8443/order',
    'https://trade.1688.com:443/order',
    'https://trade.1688.com\\@evil.test/order',
    'https://trade.1688.com/\norder',
    'javascript://trade.1688.com/order',
    '', null, undefined,
  ])('preserves product and unrelated addresses: %s', value => {
    expect(is1688OrderOrCartUrl(value)).toBe(false)
  })

  it('only accepts an actual offer URL as the replacement', () => {
    expect(canonicalize1688OfferUrl('https://detail.1688.com/offer/123456789012.html?spm=order'))
      .toBe('https://detail.1688.com/offer/123456789012.html')
    expect(canonicalize1688OfferUrl('https://trade.1688.com/order?offerId=123456789012')).toBeNull()
  })
})
