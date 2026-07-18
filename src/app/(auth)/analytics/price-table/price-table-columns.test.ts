import { describe, expect, it } from 'vitest'
import { findMarketplaceProductIds, type PriceTableDisplayColumn } from './price-table-columns'

function column(overrides: Partial<PriceTableDisplayColumn> = {}): PriceTableDisplayColumn {
  return {
    id: 'coupang',
    label: '쿠팡',
    valueKey: 'belload89 판매가',
    details: [{ key: '★ 배송비 12', label: '배송', format: 'money' }],
    ...overrides,
  }
}

describe('findMarketplaceProductIds', () => {
  it('가격 계정명과 같은 상품번호 열을 연결한다', () => {
    expect(findMarketplaceProductIds({
      상품코드: 'SKU-1',
      'belload89 판매가': '12900',
      'belload89 상품번호': '8423719201',
      'tapeoff 상품번호': '999',
    }, column())).toEqual([
      { key: 'belload89 상품번호', value: '8423719201' },
    ])
  })

  it('플랫폼명으로 등록상품번호를 연결한다', () => {
    expect(findMarketplaceProductIds({
      '쿠팡 등록 상품번호': '123456',
    }, column())).toEqual([
      { key: '쿠팡 등록 상품번호', value: '123456' },
    ])
  })

  it('내부 상품코드는 쇼핑몰 상품번호로 사용하지 않는다', () => {
    expect(findMarketplaceProductIds({
      상품코드: 'SKU-1',
      사방넷상품코드: 'SBN-1',
    }, column())).toEqual([])
  })

  it('이름 없는 중복 상품번호 열은 가까운 가격 열과 연결한다', () => {
    expect(findMarketplaceProductIds({
      'belload89 판매가': '12900',
      '★ 배송비 12': '3000',
      '상품번호 12': '8423719201',
    }, column())).toEqual([
      { key: '상품번호 12', value: '8423719201' },
    ])
  })

  it('멀리 떨어진 다른 쇼핑몰 상품번호는 연결하지 않는다', () => {
    expect(findMarketplaceProductIds({
      '상품번호 2': 'OTHER-1',
      컬럼1: 'a',
      컬럼2: 'b',
      컬럼3: 'c',
      컬럼4: 'd',
      컬럼5: 'e',
      'belload89 판매가': '12900',
    }, column())).toEqual([])
  })

  it('명시한 원본 열을 가장 먼저 사용한다', () => {
    expect(findMarketplaceProductIds({
      '쿠팡 상품관리번호': 'CP-10',
      'belload89 상품번호': '8423719201',
    }, column({ productIdKeys: ['쿠팡 상품관리번호'] }))).toEqual([
      { key: '쿠팡 상품관리번호', value: 'CP-10' },
    ])
  })
})
