import { describe, expect, it } from 'vitest'
import {
  isPurchasingStockWarehouse,
  purchasingStockTotal,
} from './warehouse-stock'

describe('purchasing stock warehouses', () => {
  it('uses only 1창고, 쿠팡창고, 2창고 for purchasing stock', () => {
    expect(isPurchasingStockWarehouse('1창고')).toBe(true)
    expect(isPurchasingStockWarehouse('쿠팡창고')).toBe(true)
    expect(isPurchasingStockWarehouse('쿠팡')).toBe(true)
    expect(isPurchasingStockWarehouse('2창고')).toBe(true)
    expect(isPurchasingStockWarehouse('중국창고')).toBe(false)
    expect(isPurchasingStockWarehouse('기타창고')).toBe(false)
  })

  it('adds the three purchasing stock warehouses into one total', () => {
    expect(purchasingStockTotal({
      oneWarehouse: 12,
      coupangWarehouse: 5,
      twoWarehouse: 8,
    })).toBe(25)
  })
})
