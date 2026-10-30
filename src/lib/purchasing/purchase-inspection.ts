import { z } from 'zod'

const measurement = z.number().finite().positive().max(1_000_000).nullable()
export const inspectionBoxSchema = z.object({
  id: z.string().uuid(), quantity: z.number().int().min(0).max(1_000_000).nullable(),
  lengthCm: measurement, widthCm: measurement, heightCm: measurement, weightKg: measurement,
}).strict()
export const inspectionParcelsSchema = z.array(z.object({
  id: z.string().uuid(), trackingNumber: z.string().trim().min(1).max(100),
  boxes: z.array(inspectionBoxSchema).min(1).max(500),
}).strict()).min(1).max(100).superRefine((parcels, context) => {
  const tracking = new Set<string>(), ids = new Set<string>()
  let count = 0
  for (const parcel of parcels) {
    const key = parcel.trackingNumber.toUpperCase()
    if (tracking.has(key)) context.addIssue({ code: 'custom', message: '중복 송장번호를 확인해주세요.' })
    tracking.add(key)
    for (const entry of [parcel, ...parcel.boxes]) {
      if (ids.has(entry.id)) context.addIssue({ code: 'custom', message: '중복 박스 정보를 확인해주세요.' })
      ids.add(entry.id)
    }
    count += parcel.boxes.length
  }
  if (count > 500) context.addIssue({ code: 'custom', message: '박스는 최대 500개까지 입력할 수 있습니다.' })
})
export const purchaseInspectionInputSchema = z.object({
  revision: z.number().int().min(0), parcels: inspectionParcelsSchema,
  complete: z.boolean().default(false), acknowledgeMismatch: z.boolean().default(false),
  resolutionNote: z.string().trim().max(2_000).default(''),
}).strict()
export type InspectionParcel = z.infer<typeof inspectionParcelsSchema>[number]
export type PurchaseInspection = {
  version: 1; revision: number; expectedQuantity: number; parcels: InspectionParcel[]
  checkedAt: string | null; checkedBy: string | null; resolutionNote: string
}

export function inspectionSummary(inspection: Pick<PurchaseInspection, 'expectedQuantity' | 'parcels'>) {
  const boxes = inspection.parcels.flatMap((parcel) => parcel.boxes)
  const quantityPending = boxes.some((box) => box.quantity === null)
  const receivedQuantity = boxes.reduce((sum, box) => sum + (box.quantity ?? 0), 0)
  return {
    receivedQuantity, boxCount: boxes.length, quantityPending,
    difference: receivedQuantity - inspection.expectedQuantity,
    hasError: !quantityPending && receivedQuantity !== inspection.expectedQuantity,
    measurementsPending: boxes.some((box) => [box.lengthCm, box.widthCm, box.heightCm, box.weightKg].some((value) => value === null)),
  }
}

export function validateInspectionCompletion(inspection: PurchaseInspection, acknowledgeMismatch = Boolean(inspection.checkedAt)) {
  const summary = inspectionSummary(inspection)
  if (!inspection.parcels.length || inspection.parcels.some((parcel) => !parcel.trackingNumber.trim())) throw new Error('송장번호를 입력해주세요.')
  if (summary.quantityPending) throw new Error('모든 박스의 입고수량을 입력해주세요.')
  if (summary.measurementsPending) throw new Error('모든 박스의 크기와 무게를 입력해주세요.')
  if (summary.hasError && (!acknowledgeMismatch || !inspection.resolutionNote.trim())) throw new Error('입고오류를 확인하고 부족·초과 처리 사유를 입력해주세요.')
  if (!Number.isSafeInteger(summary.receivedQuantity) || summary.receivedQuantity > 1_000_000) throw new Error('총 입고수량을 확인해주세요.')
  return summary
}

export function splitTrackingNumbers(value: string | null | undefined) {
  return [...new Set((value ?? '').split(/[,;\n，；|]+/).map((part) => part.trim()).filter(Boolean))]
}

export function blankInspectionBox(id: string): InspectionParcel['boxes'][number] {
  return { id, quantity: null, lengthCm: null, widthCm: null, heightCm: null, weightKg: null }
}

export function createPurchaseInspection(expectedQuantity: number, trackingNumber: string | null): PurchaseInspection {
  return { version: 1, revision: 0, expectedQuantity, checkedAt: null, checkedBy: null, resolutionNote: '',
    parcels: splitTrackingNumbers(trackingNumber).map((number) => ({ id: crypto.randomUUID(), trackingNumber: number, boxes: [blankInspectionBox(crypto.randomUUID())] })),
  }
}
