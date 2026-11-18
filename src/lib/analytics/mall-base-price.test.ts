import { expect, it } from 'vitest'
import { getMallBasePrice, getRegistrationMargin } from './price-registration-values'

it('uses product management prices for the matching channel before imported mall prices', () => {
  const raw = { __productB2BPrice: '12000', __productB2CPrice: '15000', '★ 판매가': '10000', 'belload89 판매가': '13000' }
  expect(getMallBasePrice(raw, 'domeme', '★ 판매가')).toBe(12000)
  expect(getMallBasePrice(raw, 'coupang', 'belload89 판매가')).toBe(15000)
})

it('falls back to the imported mall price when no product-management price exists', () => {
  expect(getMallBasePrice({ '★ 판매가': '10000', 'B2B 판매가': '12000' }, 'domeme', '★ 판매가')).toBe(10000)
})

it('keeps a manual mall override above the product default, including a zero price', () => {
  expect(getRegistrationMargin({ '공통 판매가': 15000, '__registrationEdit:price:coupang': '0' }, 'coupang', 10).price).toBe(0)
})


it('uses a parent price as a fallback while preserving explicit option prices', () => {
  expect(getMallBasePrice({ __parentB2BPrice: '12000', 'B2B 판매가': '14000' }, 'domeme', '★ 판매가')).toBe(14000)
  expect(getMallBasePrice({ __parentB2BPrice: '12000' }, 'domeme', '★ 판매가')).toBe(12000)
})
