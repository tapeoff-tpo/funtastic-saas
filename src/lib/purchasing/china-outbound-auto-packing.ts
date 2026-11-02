import type { PurchaseInspection } from './purchase-inspection'

export type InspectionPackingPiece = {
  receiptBoxId: string; trackingNumber: string; receivedQuantity: number; quantity: number
  lengthCm: number; widthCm: number; heightCm: number; weightKg: number | null
  outboundBoxId?: string
}

/** Reserve numbers across the whole shipment, including unsaved product drafts. */
export function nextAvailableBoxNumbers(count: number, occupied: Iterable<string>): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 5_000) throw new Error('박스 수는 1~5,000개로 입력해주세요.')
  const used = new Set([...occupied].map((value) => value.trim()).flatMap((value) => /^\d+$/.test(value) ? [value, String(Number(value))] : [value]))
  const result: string[] = []
  let candidate = 1
  while (result.length < count) {
    const number = String(candidate++)
    if (!used.has(number)) { result.push(number); used.add(number) }
  }
  return result
}

export function planAutomaticBoxSplit(quantity: number, input: { quantityPerBox?: number; boxCount?: number }, occupied: Iterable<string>) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('실제 출고수량을 확인해주세요.')
  let quantities: number[]
  if (input.quantityPerBox !== undefined) {
    if (!Number.isSafeInteger(input.quantityPerBox) || input.quantityPerBox < 1) throw new Error('박스당 수량은 1 이상의 정수로 입력해주세요.')
    const count = Math.ceil(quantity / input.quantityPerBox)
    if (count > 5_000) throw new Error('한 번에 분할할 수 있는 박스는 최대 5,000개입니다.')
    if (input.boxCount !== undefined && input.boxCount !== count) throw new Error(`총 박스 수는 ${count}개여야 합니다.`)
    quantities = Array.from({ length: count }, (_, index) => Math.min(input.quantityPerBox!, quantity - index * input.quantityPerBox!))
  } else {
    const count = input.boxCount
    if (!count || !Number.isSafeInteger(count) || count < 1 || count > quantity || count > 5_000) throw new Error('총 박스 수는 출고수량 이내의 정수로 입력해주세요. (최대 5,000개)')
    const base = Math.floor(quantity / count), remainder = quantity % count
    quantities = Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0))
  }
  const numbers = nextAvailableBoxNumbers(quantities.length, occupied)
  return quantities.map((quantity, index) => ({ boxNo: numbers[index], quantity }))
}

/** Use exact lot reservations. Never infer which physical box an old untracked
 * shipment used, or attach an unrelated purchase merely because its SKU matches. */
export function planInspectionPacking(input: {
  inspection: PurchaseInspection | null | undefined
  receivedQuantity: number
  quantity: number
  previous: Array<{ reservedQuantity: number; releasedQuantity: number; inspectionBoxes?: InspectionPackingPiece[] | null }>
}): InspectionPackingPiece[] {
  const inspection = input.inspection
  if (!inspection?.checkedAt || !Number.isSafeInteger(input.quantity) || input.quantity <= 0) return []
  const sources = inspection.parcels.flatMap((parcel) => parcel.boxes.map((box) => ({ ...box, trackingNumber: parcel.trackingNumber })))
  if (sources.some((box) => box.quantity === null || [box.lengthCm, box.widthCm, box.heightCm, box.weightKg].some((value) => value === null || !Number.isFinite(value) || value <= 0))) return []
  if (sources.reduce((sum, box) => sum + box.quantity!, 0) !== input.receivedQuantity) return []
  const used = new Map<string, number>()
  for (const previous of input.previous) {
    let live = previous.reservedQuantity - previous.releasedQuantity
    if (live <= 0) continue
    for (const piece of previous.inspectionBoxes ?? []) {
      if (live <= 0) break
      if (!sources.some((box) => box.id === piece.receiptBoxId) || !Number.isSafeInteger(piece.quantity) || piece.quantity <= 0) return []
      const count = Math.min(piece.quantity, live)
      used.set(piece.receiptBoxId, (used.get(piece.receiptBoxId) ?? 0) + count)
      live -= count
    }
    if (live > 0) return []
  }
  const result: InspectionPackingPiece[] = []
  let remaining = input.quantity
  for (const box of sources) {
    const consumed = used.get(box.id) ?? 0
    if (consumed > box.quantity!) return []
    const quantity = Math.min(remaining, box.quantity! - consumed)
    if (quantity <= 0) continue
    result.push({ receiptBoxId: box.id, trackingNumber: box.trackingNumber, receivedQuantity: box.quantity!, quantity,
      lengthCm: box.lengthCm!, widthCm: box.widthCm!, heightCm: box.heightCm!,
      // A partial box has different contents/tare. Its weight must be measured again.
      weightKg: quantity === box.quantity && consumed === 0 ? box.weightKg : null,
    })
    remaining -= quantity
    if (!remaining) break
  }
  return remaining ? [] : result
}
