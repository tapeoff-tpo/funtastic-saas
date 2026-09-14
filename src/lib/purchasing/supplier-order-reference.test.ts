import { describe, expect, it } from 'vitest'
import {
  isUniqueSupplierOrderIdentifier,
  normalizeEcountSupplierOrderReference,
  normalizeSupplierOrderReference,
} from './supplier-order-reference'

describe('supplier order references', () => {
  it.each(['웨이신', '알리페이', 'wechat', 'ssj', '신성진'])(
    'keeps the non-numeric purchase reference %s',
    (value) => {
      expect(normalizeSupplierOrderReference(`  ${value}  `)).toBe(value)
      expect(normalizeEcountSupplierOrderReference(`  ${value}  `)).toBe(value)
      expect(isUniqueSupplierOrderIdentifier(value)).toBe(false)
    },
  )

  it('keeps only standalone long numeric values as unique cross-report identifiers', () => {
    expect(isUniqueSupplierOrderIdentifier('3316362603001063953')).toBe(true)
    expect(isUniqueSupplierOrderIdentifier('3316362603001063953,3316362603001063954')).toBe(false)
    expect(normalizeSupplierOrderReference('0')).toBeNull()
    expect(normalizeSupplierOrderReference('   ')).toBeNull()
  })

  it('accepts compound order references but rejects non-purchase notes', () => {
    expect(normalizeEcountSupplierOrderReference(
      '3311154303125018761 / 3311620645417009579 (5000개)',
    )).toBe('3311154303125018761 / 3311620645417009579 (5000개)')
    expect(normalizeEcountSupplierOrderReference('Wechat : Kh18819058252')).toBe('Wechat : Kh18819058252')
    expect(normalizeEcountSupplierOrderReference('ssj물류 구매')).toBe('ssj물류 구매')
    expect(normalizeEcountSupplierOrderReference('단종')).toBeNull()
    expect(normalizeEcountSupplierOrderReference('핀둬둬 체크 필요')).toBeNull()
    expect(normalizeEcountSupplierOrderReference('상품 업데이트, 확인 후 주문')).toBeNull()
  })
})
