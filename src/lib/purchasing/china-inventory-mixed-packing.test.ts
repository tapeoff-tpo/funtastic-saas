import { describe, expect, it } from 'vitest'
import type { ChinaInventoryPackingGroup } from './china-inventory-packing-group'
import { planMixedInventoryPacking } from './china-inventory-mixed-packing'

const keldi: ChinaInventoryPackingGroup = {
  version: 1, key: 'keldi', totalBoxCount: 1, referenceQuantity: 150, memberStartQuantity: 0,
  grossWeightKg: 8, manualCbm: 0.003308, lengthCm: null, widthCm: null, heightCm: null,
}
const units = (values: Array<number | null>, precision: number) => values.reduce<number>((total, value) => total + Math.round((value ?? 0) * precision), 0)

describe('shared inventory cartons across options', () => {
  it('places silver50 and black100 in the same physical carton with exact proportional shares', () => {
    const silver = planMixedInventoryPacking({ group: keldi, memberReferenceQuantity: 50, quantity: 50 })
    const black = planMixedInventoryPacking({ group: { ...keldi, memberStartQuantity: 50 }, memberReferenceQuantity: 100, quantity: 100 })
    expect(silver).toEqual([{ sourceBoxIndex: 0, quantity: 50, grossWeightKg: 2.667, manualCbm: 0.001103, lengthCm: 14.9, widthCm: 14.9, heightCm: 14.9 }])
    expect(black).toEqual([{ sourceBoxIndex: 0, quantity: 100, grossWeightKg: 5.333, manualCbm: 0.002205, lengthCm: 14.9, widthCm: 14.9, heightCm: 14.9 }])
    expect(units([...silver, ...black].map((piece) => piece.grossWeightKg), 1_000)).toBe(8_000)
    expect(units([...silver, ...black].map((piece) => piece.manualCbm), 1_000_000)).toBe(3_308)
  })

  it('creates seven shared cartons for three Batte options and preserves option and group totals', () => {
    const group = { ...keldi, key: 'batte', totalBoxCount: 7, referenceQuantity: 110, grossWeightKg: 124, manualCbm: 0.25 }
    const members = [{ start: 0, quantity: 20 }, { start: 20, quantity: 30 }, { start: 50, quantity: 60 }]
    const plans = members.map((member) => planMixedInventoryPacking({ group: { ...group, memberStartQuantity: member.start }, memberReferenceQuantity: member.quantity, quantity: member.quantity }))
    expect(plans.map((pieces) => pieces.map((piece) => [piece.sourceBoxIndex, piece.quantity]))).toEqual([
      [[0, 16], [1, 4]], [[1, 12], [2, 16], [3, 2]], [[3, 14], [4, 16], [5, 15], [6, 15]],
    ])
    const pieces = plans.flat()
    const cartonQuantities = Array.from({ length: 7 }, (_, index) => pieces.filter((piece) => piece.sourceBoxIndex === index).reduce((sum, piece) => sum + piece.quantity, 0))
    expect(cartonQuantities).toEqual([16, 16, 16, 16, 16, 15, 15])
    expect(units(pieces.map((piece) => piece.grossWeightKg), 1_000)).toBe(124_000)
    expect(units(pieces.map((piece) => piece.manualCbm), 1_000_000)).toBe(250_000)
    for (const [index, member] of members.entries()) {
      expect(units(plans[index].map((piece) => piece.grossWeightKg), 1_000)).toBe(Math.round(124_000 * (member.start + member.quantity) / 110) - Math.round(124_000 * member.start / 110))
      expect(units(plans[index].map((piece) => piece.manualCbm), 1_000_000)).toBe(Math.round(250_000 * (member.start + member.quantity) / 110) - Math.round(250_000 * member.start / 110))
    }
    expect(plans[0][1].lengthCm).toBe(plans[1][0].lengthCm)
    expect(plans[1][2].heightCm).toBe(plans[2][0].heightCm)
  })

  it('continues a member range across partial registrations without rounding its per-unit weight first', () => {
    const first = planMixedInventoryPacking({ group: keldi, memberReferenceQuantity: 50, quantity: 20 })
    const rest = planMixedInventoryPacking({ group: keldi, memberReferenceQuantity: 50, quantity: 30, consumedQuantity: 20 })
    expect(first[0]).toMatchObject({ sourceBoxIndex: 0, quantity: 20, grossWeightKg: 1.067, manualCbm: 0.000441 })
    expect(rest[0]).toMatchObject({ sourceBoxIndex: 0, quantity: 30, grossWeightKg: 1.6, manualCbm: 0.000662 })
    expect(units([...first, ...rest].map((piece) => piece.grossWeightKg), 1_000)).toBe(2_667)
    expect(units([...first, ...rest].map((piece) => piece.manualCbm), 1_000_000)).toBe(1_103)
  })

  it('uses a new carton cycle when new stock exceeds the original option reference', () => {
    const pieces = planMixedInventoryPacking({ group: keldi, memberReferenceQuantity: 50, quantity: 70, consumedQuantity: 40 })
    expect(pieces.map((piece) => [piece.sourceBoxIndex, piece.quantity])).toEqual([[0, 10], [1, 50], [2, 10]])
    expect(planMixedInventoryPacking({ group: keldi, memberReferenceQuantity: 50, quantity: 50, consumedQuantity: 1_000_000_000 })[0].sourceBoxIndex).toBe(20_000_000)
  })

  it('keeps physical measurements identical for mixed options and fills only absent dimensions', () => {
    const group = { ...keldi, lengthCm: 20, widthCm: 10, heightCm: null }
    const first = planMixedInventoryPacking({ group, memberReferenceQuantity: 50, quantity: 50 })[0]
    const next = planMixedInventoryPacking({ group: { ...group, memberStartQuantity: 50 }, memberReferenceQuantity: 100, quantity: 100 })[0]
    expect(first).toMatchObject({ lengthCm: 20, widthCm: 10, heightCm: 16.54 })
    expect(next).toMatchObject({ lengthCm: 20, widthCm: 10, heightCm: 16.54 })
    expect(first.manualCbm).not.toBe(next.manualCbm)
  })

  it('accepts a carton count with measurements still blank', () => {
    expect(planMixedInventoryPacking({ group: { ...keldi, grossWeightKg: null, manualCbm: null }, memberReferenceQuantity: 50, quantity: 50 })).toEqual([
      { sourceBoxIndex: 0, quantity: 50, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null, manualCbm: null },
    ])
  })

  it.each([
    { quantity: 0 }, { quantity: 1.5 }, { quantity: Number.NaN }, { quantity: 1, consumedQuantity: -1 },
    { quantity: 1, memberReferenceQuantity: 0 }, { quantity: 1, memberReferenceQuantity: 151 },
    { quantity: 1, group: { ...keldi, memberStartQuantity: 149 } },
    { quantity: 1, group: { ...keldi, totalBoxCount: 151 } },
    { quantity: 1, group: { ...keldi, totalBoxCount: 5_001, referenceQuantity: 10_000 } },
    { quantity: 1, group: { ...keldi, grossWeightKg: -1 } },
  ])('does not invent a plan for invalid source metadata or member ranges (%j)', (change) => {
    expect(planMixedInventoryPacking({ group: keldi, memberReferenceQuantity: 50, quantity: 50, ...change })).toEqual([])
  })

  it('bounds generated pieces when the member repeats through thousands of new cartons', () => {
    expect(planMixedInventoryPacking({ group: keldi, memberReferenceQuantity: 50, quantity: 50 * 5_000 })).toHaveLength(5_000)
    expect(planMixedInventoryPacking({ group: keldi, memberReferenceQuantity: 50, quantity: 50 * 5_001 })).toEqual([])
  })
})
