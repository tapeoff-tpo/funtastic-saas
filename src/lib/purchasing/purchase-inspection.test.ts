import { describe, expect, it } from 'vitest'
import { createPurchaseInspection, inspectionSummary, purchaseInspectionInputSchema, validateInspectionCompletion, type PurchaseInspection } from './purchase-inspection'
import { getNextPurchaseStatus } from './purchase-request-status'

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
export function inspectedFixture(): PurchaseInspection {
  return { version: 1, revision: 1, expectedQuantity: 100, checkedAt: null, checkedBy: null, resolutionNote: '', parcels: [
    { id: id(1), trackingNumber: 'SF001', boxes: [{ id: id(2), quantity: 60, lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 10 }] },
    { id: id(3), trackingNumber: 'YT002', boxes: [{ id: id(4), quantity: 30, lengthCm: 40, widthCm: 30, heightCm: 20, weightKg: 5 }] },
  ] }
}
describe('purchase inspection rules', () => {
  it('puts inspection between purchased goods and China arrival', () => {
    expect(getNextPurchaseStatus('purchase_completed')).toBe('inspecting')
    expect(getNextPurchaseStatus('inspecting')).toBe('china_arrived')
  })
  it('aggregates every tracking number and box without changing the purchase quantity', () => {
    const inspection = inspectedFixture()
    expect(inspectionSummary(inspection)).toMatchObject({ receivedQuantity: 90, difference: -10, hasError: true, quantityPending: false, boxCount: 2 })
    expect(inspection.expectedQuantity).toBe(100)
  })
  it('does not call unfinished counting a shortage', () => {
    const inspection = inspectedFixture(); inspection.parcels[1].boxes[0].quantity = null
    expect(inspectionSummary(inspection)).toMatchObject({ quantityPending: true, hasError: false })
    expect(() => validateInspectionCompletion(inspection)).toThrow('입고수량')
  })
  it('requires both acknowledgement and an explanation for shortages and excesses', () => {
    const inspection = inspectedFixture()
    expect(() => validateInspectionCompletion(inspection, true)).toThrow('입고오류')
    inspection.resolutionNote = '공급처와 10개 부족 확인, 실제 수량으로 입고'
    expect(() => validateInspectionCompletion(inspection, false)).toThrow('입고오류')
    expect(validateInspectionCompletion(inspection, true).receivedQuantity).toBe(90)
    inspection.parcels[1].boxes[0].quantity = 50
    expect(validateInspectionCompletion(inspection, true).difference).toBe(10)
  })
  it('requires measurements and weight for every box, but no discrepancy note for equal counts', () => {
    const inspection = inspectedFixture(); inspection.parcels[1].boxes[0].quantity = 40
    expect(validateInspectionCompletion(inspection).receivedQuantity).toBe(100)
    inspection.parcels[1].boxes[0].weightKg = null
    expect(() => validateInspectionCompletion(inspection)).toThrow('크기와 무게')
  })
  it('rejects duplicate tracking numbers, duplicate IDs, fractional counts and forged verification fields', () => {
    const inspection = inspectedFixture()
    const body = { revision: 1, parcels: inspection.parcels }
    expect(purchaseInspectionInputSchema.safeParse(body).success).toBe(true)
    expect(purchaseInspectionInputSchema.safeParse({ ...body, checkedBy: 'forged' }).success).toBe(false)
    inspection.parcels[1].trackingNumber = 'sf001'
    expect(purchaseInspectionInputSchema.safeParse(body).success).toBe(false)
    inspection.parcels[1].trackingNumber = 'YT002'; inspection.parcels[1].boxes[0].quantity = 1.5
    expect(purchaseInspectionInputSchema.safeParse(body).success).toBe(false)
    inspection.parcels[1].boxes[0].quantity = 30; inspection.parcels[1].boxes[0].id = id(2)
    expect(purchaseInspectionInputSchema.safeParse(body).success).toBe(false)
  })
  it('initializes old tracking values without inventing counts or measurements', () => {
    const inspection = createPurchaseInspection(120, 'SF001；YT002\nSF001')
    expect(inspection.parcels.map((parcel) => parcel.trackingNumber)).toEqual(['SF001', 'YT002'])
    expect(inspection.parcels[0].boxes[0]).toMatchObject({ quantity: null, weightKg: null })
    expect(inspectionSummary(inspection).quantityPending).toBe(true)
  })
})
