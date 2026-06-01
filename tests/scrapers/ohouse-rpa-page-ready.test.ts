import { describe, expect, it } from 'vitest'
import { isOhouseOrderPageTextReady } from '@/scrapers/ohouse/scraper'

describe('isOhouseOrderPageTextReady', () => {
  it('accepts the Ohouse order screen even when there are no unconfirmed orders', () => {
    expect(isOhouseOrderPageTextReady('미확인주문 0건 배송준비중 3건')).toBe(true)
  })

  it('accepts an order table header as a ready order screen', () => {
    expect(isOhouseOrderPageTextReady('주문번호 상품명 주문상태 검색결과 엑셀 다운로드')).toBe(true)
  })

  it('rejects a blank shell', () => {
    expect(isOhouseOrderPageTextReady('')).toBe(false)
  })
})
