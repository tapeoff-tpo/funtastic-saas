import { describe, expect, it } from 'vitest'
import { nextAvailableBoxNumbers, planAutomaticBoxSplit, planInspectionPacking, type InspectionPackingPiece } from './china-outbound-auto-packing'
import type { PurchaseInspection } from './purchase-inspection'

const inspection: PurchaseInspection = {
  version: 1, revision: 1, expectedQuantity: 30, checkedAt: '2026-11-02T01:00:00Z', checkedBy: 'staff', resolutionNote: '',
  parcels: ['SF001', 'YT002', 'ZT003'].map((trackingNumber, index) => ({ id: `parcel-${index}`, trackingNumber,
    boxes: [{ id: `box-${index}`, quantity: 10, lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 3 }],
  })),
}
function plan(quantity: number, previous: Array<{ reservedQuantity: number; releasedQuantity: number; inspectionBoxes?: InspectionPackingPiece[] }> = []) {
  return planInspectionPacking({ inspection, receivedQuantity: 30, quantity, previous })
}
describe('outbound automatic box splitting', () => {
  it('creates ten boxes for 100 units at ten per box', () => {
    const result = planAutomaticBoxSplit(100, { quantityPerBox: 10 }, [])
    expect(result).toHaveLength(10)
    expect(result.map((box) => box.quantity)).toEqual(Array(10).fill(10))
    expect(result.map((box) => box.boxNo)).toEqual(Array.from({ length: 10 }, (_, index) => String(index + 1)))
  })
  it('keeps an exact remainder and can split evenly by total box count', () => {
    expect(planAutomaticBoxSplit(105, { quantityPerBox: 10 }, []).map((box) => box.quantity)).toEqual([...Array(10).fill(10), 5])
    expect(planAutomaticBoxSplit(10, { boxCount: 6 }, []).map((box) => box.quantity)).toEqual([2, 2, 2, 2, 1, 1])
  })
  it('skips both persisted numbers and unsaved drafts, including zero-padded numbers', () => {
    expect(nextAvailableBoxNumbers(3, ['1', '002', 'A-3', '4'])).toEqual(['3', '5', '6'])
  })
  it('rejects empty boxes, invalid values, inconsistent totals and enormous plans', () => {
    for (const input of [{ boxCount: 11 }, { quantityPerBox: 0 }, { boxCount: 1.5 }, { quantityPerBox: 3, boxCount: 2 }]) expect(() => planAutomaticBoxSplit(10, input, [])).toThrow()
    expect(() => planAutomaticBoxSplit(100_000, { quantityPerBox: 1 }, [])).toThrow('5,000')
  })
})
describe('packing from verified purchase lots', () => {
  it('copies each tracking number and full-box measurements', () => {
    const result = plan(30)
    expect(result.map((box) => box.trackingNumber)).toEqual(['SF001', 'YT002', 'ZT003'])
    expect(result[0]).toMatchObject({ receiptBoxId: 'box-0', receivedQuantity: 10, quantity: 10, weightKg: 3, lengthCm: 50 })
  })
  it('uses only requested units and leaves a partial box weight unconfirmed', () => {
    expect(plan(15).map((box) => [box.quantity, box.weightKg])).toEqual([[10, 3], [5, null]])
  })
  it('handles cancellation holes without reusing a reserved or dispatched box', () => {
    const all = plan(30)
    const result = plan(15, [
      { reservedQuantity: 20, releasedQuantity: 20, inspectionBoxes: all.slice(0, 2) },
      { reservedQuantity: 10, releasedQuantity: 0, inspectionBoxes: [all[2]] },
    ])
    expect(result.map((box) => [box.receiptBoxId, box.quantity])).toEqual([['box-0', 10], ['box-1', 5]])
  })
  it('does not guess an old shipment source or manufacture units from mismatched receipts', () => {
    expect(plan(10, [{ reservedQuantity: 5, releasedQuantity: 0 }])).toEqual([])
    expect(planInspectionPacking({ inspection, receivedQuantity: 40, quantity: 10, previous: [] })).toEqual([])
    expect(planInspectionPacking({ inspection: { ...inspection, checkedAt: null }, receivedQuantity: 30, quantity: 10, previous: [] })).toEqual([])
    expect(plan(5, [{ reservedQuantity: 30, releasedQuantity: 0, inspectionBoxes: plan(30) }])).toEqual([])
  })
})
