import { describe, expect, it } from 'vitest'
import { canonicalPurchaseRequestExcelHeader } from './purchase-request-excel'

describe('canonicalPurchaseRequestExcelHeader', () => {
  it.each([
    ['품목코드', '품목코드'],
    ['상품코드', '품목코드'],
    ['상품 코드', '품목코드'],
    ['SKU', '품목코드'],
    ['품명', '상품명'],
    ['품목명', '상품명'],
    ['제품명', '상품명'],
    ['옵션', '옵션명'],
    ['규격', '옵션명'],
    ['수량', '요청수량'],
    ['발주수량', '요청수량'],
    ['구매 수량', '요청수량'],
    ['주문수량', '요청수량'],
  ])('%s 열을 %s 열로 인식한다', (input, expected) => {
    expect(canonicalPurchaseRequestExcelHeader(input)).toBe(expected)
  })

  it('알 수 없는 열은 무시한다', () => {
    expect(canonicalPurchaseRequestExcelHeader('판매가')).toBeNull()
  })
})
