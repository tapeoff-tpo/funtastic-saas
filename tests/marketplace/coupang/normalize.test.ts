import { describe, it, expect } from 'vitest'

describe('Coupang normalizeOrder shipping fields', () => {
  it.todo('sheet.shippingPrice.units → NormalizedOrder.shippingFee')
  it.todo('sheet.shipmentType + deliveryChargeTypeName → shippingType (enum prepaid/cod/free/unknown)')
  it('placeholder — 모듈이 export하는 정규화 결과에 shippingFee/Type 키가 있어야 함', () => {
    // RED placeholder — Plan 02에서 normalize 확장 후 GREEN
    expect(true).toBe(true)
  })
})
