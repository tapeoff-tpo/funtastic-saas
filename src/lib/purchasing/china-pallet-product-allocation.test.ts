import { expect, it } from 'vitest'
import { allocatePalletMeasure, allocatePalletProducts } from './china-pallet-product-allocation'
it('distributes additional pallet volume and weight by loaded product volume', () => {
  const result = allocatePalletProducts([{ productCode: 'A', loadedCbm: 0.6, boxWeightKg: 20 }, { productCode: 'B', loadedCbm: 0.4, boxWeightKg: 10 }], 1.3, 5)!
  expect(result.map((row) => row.finalCbm)).toEqual([0.78, 0.52])
  expect(result.map((row) => row.tareWeightKg)).toEqual([3, 2])
  expect(result.map((row) => row.grossWeightKg)).toEqual([23, 12])
})
it('keeps rounded shares equal to the final physical measurements', () => {
  expect(allocatePalletMeasure(0.3, [1, 1, 1, 1, 1, 1, 1], 4)!.reduce((sum, value) => sum + Math.round(value * 10000), 0)).toBe(3000)
  expect(allocatePalletMeasure(5, [1, 1, 1], 3)).toEqual([1.667, 1.667, 1.666])
})
it('never invents a volume ratio for missing or invalid measurements', () => {
  expect(allocatePalletMeasure(0.3, [Number.NaN, 1], 4)).toBeNull()
  expect(allocatePalletMeasure(0.3, [0, 0], 4)).toBeNull()
})
