import { describe, expect, it } from 'vitest'
import { purchaseArrivalWarehouse, purchaseArrivalWarehouseDisplay } from './purchase-arrival-warehouse'

describe('purchase arrival warehouse display', () => {
  it('preserves a manual choice ahead of imported and restored source names', () => {
    expect(purchaseArrivalWarehouseDisplay({ arrivalWarehouseCode: '대량창고' }, '중국창고', '쿠팡')).toBe('대량창고')
  })
  it('displays original names without turning them into an inventory-routing override', () => {
    const raw = { source: 'ecount_purchasing_snapshot_plan_purchase_completed' }
    expect(purchaseArrivalWarehouseDisplay(raw, ' 쿠팡 ', '중국창고')).toBe('쿠팡')
    expect(purchaseArrivalWarehouse(raw)).toBeUndefined()
    expect(raw).not.toHaveProperty('saasChinaMode')
    expect(raw).not.toHaveProperty('arrivalWarehouseCode')
  })
  it('restores an exact source match only when the stored warehouse is missing', () => {
    expect(purchaseArrivalWarehouseDisplay({}, '', '중국창고')).toBe('중국창고')
    expect(purchaseArrivalWarehouseDisplay({}, null, null)).toBeUndefined()
  })
})
