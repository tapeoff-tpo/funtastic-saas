import { describe, expect, it } from 'vitest'
import { nextAvailableBoxNumbers, planAutomaticBoxSplit, planInspectionPacking, planInventoryPacking, type InspectionPackingPiece } from './china-outbound-auto-packing'
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
  it('retains existing box numbers and adds only the extra boxes when replanning', () => {
    expect(planAutomaticBoxSplit(10, { boxCount: 2 }, ['1'], ['1'])).toEqual([
      { boxNo: '1', quantity: 5 }, { boxNo: '2', quantity: 5 },
    ])
    expect(planAutomaticBoxSplit(10, { boxCount: 3 }, ['1', '002', 'CUSTOM', '4'], ['CUSTOM', '002'])).toEqual([
      { boxNo: 'CUSTOM', quantity: 4 }, { boxNo: '002', quantity: 3 }, { boxNo: '3', quantity: 3 },
    ])
    expect(planAutomaticBoxSplit(10, { boxCount: 1 }, ['1', '2'], ['2', '1'])).toEqual([{ boxNo: '2', quantity: 10 }])
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

describe('packing from inventory spreadsheet measurements', () => {
  it('creates the recorded number of boxes with exact evenly distributed stock and per-box measurements', () => {
    const pieces = planInventoryPacking({ onHandQuantity: 100, quantity: 100, totalBoxCount: 3, lengthCm: '50', widthCm: '40', heightCm: '30', grossWeightKg: '6.5', manualCbm: '0.06', measurementBasis: 'per_box' })
    expect(pieces.map((piece) => piece.quantity)).toEqual([34, 33, 33])
    expect(pieces.every((piece) => piece.lengthCm === 50 && piece.widthCm === 40 && piece.heightCm === 30 && piece.grossWeightKg === 6.5 && piece.manualCbm === 0.06)).toBe(true)
  })

  it('takes only enough source boxes for a partial reservation and keeps the exact remainder', () => {
    const inventory = { onHandQuantity: 100, totalBoxCount: 3, grossWeightKg: 15 }
    expect(planInventoryPacking({ ...inventory, quantity: 50 }).map((piece) => [piece.quantity, piece.grossWeightKg])).toEqual([[34, 5], [16, 2.424]])
    expect(planInventoryPacking({ ...inventory, quantity: 1 }).map((piece) => piece.quantity)).toEqual([1])
    const result = planInventoryPacking({ onHandQuantity: 5, totalBoxCount: 20, quantity: 5 })
    expect(result.map((piece) => piece.quantity)).toEqual([1, 1, 1, 1, 1])
  })

  it('allows a count alone without inventing missing measurements or requiring weight', () => {
    const result = planInventoryPacking({ onHandQuantity: 10, quantity: 10, totalBoxCount: 2 })
    expect(result).toEqual([5, 5].map((quantity) => ({ quantity, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null, manualCbm: null })))
    expect(planInventoryPacking({ onHandQuantity: 10, quantity: 10 })).toEqual([])
  })

  it('uses one box for measurements without a count and estimates only missing dimensions from CBM', () => {
    expect(planInventoryPacking({ onHandQuantity: 10, quantity: 10, manualCbm: 0.125 })).toEqual([{ quantity: 10, lengthCm: 50, widthCm: 50, heightCm: 50, manualCbm: 0.125, grossWeightKg: null }])
    expect(planInventoryPacking({ onHandQuantity: 10, quantity: 10, lengthCm: 20, manualCbm: 0.08 })[0]).toMatchObject({ lengthCm: 20, widthCm: 63.25, heightCm: 63.25, manualCbm: 0.08 })
    expect(planInventoryPacking({ onHandQuantity: 10, quantity: 4, grossWeightKg: 2 })[0]).toMatchObject({ grossWeightKg: 0.8, lengthCm: null, widthCm: null, heightCm: null, manualCbm: null })
  })

  it('splits whole-inventory weight and CBM totals by default without multiplying totals', () => {
    const pieces = planInventoryPacking({ onHandQuantity: 20, quantity: 20, totalBoxCount: 2, grossWeightKg: 12, manualCbm: 0.25 })
    expect(pieces.map((piece) => [piece.grossWeightKg, piece.manualCbm, piece.lengthCm])).toEqual([[6, 0.125, 50], [6, 0.125, 50]])
    const fourBoxes = planInventoryPacking({ onHandQuantity: 100, quantity: 100, totalBoxCount: 4, grossWeightKg: 29, manualCbm: 0.25 })
    expect(fourBoxes.map((piece) => [piece.quantity, piece.grossWeightKg, piece.manualCbm, piece.lengthCm, piece.widthCm, piece.heightCm])).toEqual(Array(4).fill([25, 7.25, 0.0625, 39.69, 39.69, 39.69]))
  })

  it('keeps total weight and CBM exact at saved precision when division has a remainder', () => {
    const pieces = planInventoryPacking({ onHandQuantity: 30, quantity: 30, totalBoxCount: 3, grossWeightKg: 1, manualCbm: 0.1 })
    expect(pieces.map((piece) => [piece.grossWeightKg, piece.manualCbm])).toEqual([[0.333, 0.033333], [0.333, 0.033333], [0.334, 0.033334]])
    expect(pieces.reduce((sum, piece) => sum + Math.round(piece.grossWeightKg! * 1_000), 0)).toBe(1_000)
    expect(pieces.reduce((sum, piece) => sum + Math.round(piece.manualCbm! * 1_000_000), 0)).toBe(100_000)
  })

  it('continues source box positions when adding a later reservation with precision remainders', () => {
    const inventory = { onHandQuantity: 100, totalBoxCount: 3, grossWeightKg: 29, manualCbm: 0.25 }
    const first = planInventoryPacking({ ...inventory, quantity: 34 })
    const added = planInventoryPacking({ ...inventory, quantity: 66, consumedQuantity: 34 })
    expect(first.map((piece) => [piece.quantity, piece.grossWeightKg, piece.manualCbm])).toEqual([[34, 9.666, 0.083333]])
    expect(added.map((piece) => [piece.quantity, piece.grossWeightKg, piece.manualCbm])).toEqual([[33, 9.666, 0.083333], [33, 9.668, 0.083334]])
    expect([...first, ...added]).toEqual(planInventoryPacking({ ...inventory, quantity: 100 }))
  })

  it('uses the unconsumed part of a source box and bounds large consumed offsets with modulo', () => {
    const inventory = { onHandQuantity: 100, totalBoxCount: 3, grossWeightKg: 29, manualCbm: 0.25 }
    expect(planInventoryPacking({ ...inventory, quantity: 90, consumedQuantity: 10 }).map((piece) => piece.quantity)).toEqual([24, 33, 33])
    expect(planInventoryPacking({ ...inventory, quantity: 66, consumedQuantity: 1_000_000_034 })).toEqual(planInventoryPacking({ ...inventory, quantity: 66, consumedQuantity: 34 }))
    for (const consumedQuantity of [-1, 1.5, Number.NaN]) expect(() => planInventoryPacking({ ...inventory, quantity: 1, consumedQuantity })).toThrow('예약수량')
  })

  it('conserves a carton total across partial reservations using rounded cumulative boundaries', () => {
    const inventory = { onHandQuantity: 100, totalBoxCount: 4, grossWeightKg: 29, manualCbm: 0.25 }
    const first = planInventoryPacking({ ...inventory, quantity: 20 })
    const added = planInventoryPacking({ ...inventory, quantity: 5, consumedQuantity: 20 })
    expect(first[0]).toMatchObject({ quantity: 20, grossWeightKg: 5.8, manualCbm: 0.05 })
    expect(added[0]).toMatchObject({ quantity: 5, grossWeightKg: 1.45, manualCbm: 0.0125 })
    expect(Math.round(first[0].grossWeightKg! * 1_000) + Math.round(added[0].grossWeightKg! * 1_000)).toBe(7_250)
    expect(Math.round(first[0].manualCbm! * 1_000_000) + Math.round(added[0].manualCbm! * 1_000_000)).toBe(62_500)
    const tinySlices = Array.from({ length: 34 }, (_, consumedQuantity) => planInventoryPacking({ onHandQuantity: 100, totalBoxCount: 3, grossWeightKg: 29, manualCbm: 0.25, quantity: 1, consumedQuantity })[0])
    expect(tinySlices.reduce((sum, piece) => sum + Math.round(piece.grossWeightKg! * 1_000), 0)).toBe(9_666)
    expect(tinySlices.reduce((sum, piece) => sum + Math.round(piece.manualCbm! * 1_000_000), 0)).toBe(83_333)
    expect(planInventoryPacking({ ...inventory, quantity: 5, consumedQuantity: 20, measurementBasis: 'per_box' })[0]).toMatchObject({ grossWeightKg: 29, manualCbm: 0.25 })
  })

  it('uses the reference as carton capacity when more stock has subsequently arrived', () => {
    expect(planInventoryPacking({ onHandQuantity: 100, totalBoxCount: 10, quantity: 200 }).map((piece) => piece.quantity)).toEqual(Array(20).fill(10))
    expect(planInventoryPacking({ onHandQuantity: 4, totalBoxCount: 2, quantity: 5 }).map((piece) => piece.quantity)).toEqual([2, 2, 1])
  })

  it('does not create invalid outbound measurements from inventory zeros or broader numeric ranges', () => {
    expect(planInventoryPacking({ onHandQuantity: 10, quantity: 10, totalBoxCount: 1, lengthCm: 999_999_999, widthCm: 0, heightCm: 0.000001, grossWeightKg: 0.000001, manualCbm: 0 })).toEqual([{ quantity: 10, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null, manualCbm: null }])
  })

  it('falls back to manual splitting for invalid or oversized source plans', () => {
    for (const totalBoxCount of [0, -1, 1.5, 5_001, Number.NaN]) expect(planInventoryPacking({ onHandQuantity: 10_000, quantity: 10, totalBoxCount })).toEqual([])
    expect(planInventoryPacking({ onHandQuantity: 0, quantity: 5, totalBoxCount: 2 })).toEqual([])
    expect(planInventoryPacking({ onHandQuantity: 1, quantity: 5_001, totalBoxCount: 1 })).toEqual([])
    expect(() => planInventoryPacking({ onHandQuantity: 10, quantity: 0, totalBoxCount: 2 })).toThrow('출고수량')
  })
})
