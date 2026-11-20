import type { PurchaseInspection } from './purchase-inspection'
import { dimensionNumber, estimateChinaOutboundBoxDimensions } from './china-outbound-dimensions'

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

export function planAutomaticBoxSplit(quantity: number, input: { quantityPerBox?: number; boxCount?: number }, occupied: Iterable<string>, existingBoxNumbers: Iterable<string> = []) {
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
  const existing = [...existingBoxNumbers].map((number) => number.trim()).filter(Boolean)
  const additionalCount = Math.max(0, quantities.length - existing.length)
  const numbers = [...existing, ...(additionalCount ? nextAvailableBoxNumbers(additionalCount, [...occupied, ...existing]) : [])]
  return quantities.map((quantity, index) => ({ boxNo: numbers[index], quantity }))
}

export type InventoryPackingPiece = {
  quantity: number
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
  grossWeightKg: number | null
  manualCbm: number | null
}

/** Copy optional inventory packaging into a new reservation only. Box capacity
 * is based on the whole inventory balance, so a partial shipment does not reuse
 * the entire source box count or manufacture any extra product units. Weight
 * and CBM are inventory totals by default; rounding stays in the last source box. */
export function planInventoryPacking(input: {
  onHandQuantity: number
  totalBoxCount?: number | null
  quantity: number
  consumedQuantity?: number
  lengthCm?: number | string | null
  widthCm?: number | string | null
  heightCm?: number | string | null
  grossWeightKg?: number | string | null
  manualCbm?: number | string | null
  measurementBasis?: 'per_box' | 'total'
}): InventoryPackingPiece[] {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new Error('실제 출고수량을 확인해주세요.')
  const consumedQuantity = input.consumedQuantity ?? 0
  if (!Number.isSafeInteger(consumedQuantity) || consumedQuantity < 0) throw new Error('기존 출고 예약수량을 확인해주세요.')
  if (!Number.isSafeInteger(input.onHandQuantity) || input.onHandQuantity < 1) return []
  const measurement = (value: number | string | null | undefined, min: number, max: number, precision: number) => {
    const numeric = dimensionNumber(value)
    if (numeric == null || numeric < min || numeric > max) return null
    return Math.round(numeric * precision) / precision
  }
  const measurements = {
    lengthCm: measurement(input.lengthCm, 0.01, 9_999_999.99, 100), widthCm: measurement(input.widthCm, 0.01, 9_999_999.99, 100), heightCm: measurement(input.heightCm, 0.01, 9_999_999.99, 100),
    grossWeightKg: measurement(input.grossWeightKg, 0.001, 999_999_999, 1_000), manualCbm: measurement(input.manualCbm, 0.000001, 999_999_999, 1_000_000),
  }
  const hasMeasurements = Object.values(measurements).some((value) => value != null)
  const sourceCount = input.totalBoxCount == null || input.totalBoxCount === 0
    ? hasMeasurements ? 1 : null
    : input.totalBoxCount
  // Inventory spreadsheets allow large stock counts. Unsupported automatic
  // plans stay in the existing manual split workflow instead of blocking stock.
  if (sourceCount == null || !Number.isSafeInteger(sourceCount) || sourceCount < 1 || sourceCount > 5_000) return []
  const boxCount = Math.min(sourceCount, input.onHandQuantity)
  if (Math.floor(input.quantity / input.onHandQuantity) * boxCount > 5_000) return []
  const boxMeasurement = (total: number | null, precision: number, index: number, sourceQuantity: number, start: number, quantity: number) => {
    if (total == null || input.measurementBasis === 'per_box') return total
    const units = Math.round(total * precision)
    const base = Math.floor(units / boxCount)
    const sourceUnits = base + (index === boxCount - 1 ? units % boxCount : 0)
    // Adjacent reservations share the same rounded boundary, so adding pieces
    // later cannot multiply a partial carton's aggregate weight or volume.
    const value = (Math.round(sourceUnits * (start + quantity) / sourceQuantity) - Math.round(sourceUnits * start / sourceQuantity)) / precision
    return value > 0 ? value : null
  }
  const pieces: InventoryPackingPiece[] = []
  let remaining = input.quantity
  const sourceBoxes = planAutomaticBoxSplit(input.onHandQuantity, { boxCount }, [])
  let offset = consumedQuantity % input.onHandQuantity
  let sourceIndex = 0
  while (offset >= sourceBoxes[sourceIndex].quantity) {
    offset -= sourceBoxes[sourceIndex].quantity
    sourceIndex += 1
  }
  while (remaining > 0) {
    if (pieces.length === 5_000) return []
    const source = sourceBoxes[sourceIndex]
    const quantity = Math.min(source.quantity - offset, remaining)
    if (quantity <= 0) break
    const packaging = {
      ...measurements,
      grossWeightKg: boxMeasurement(measurements.grossWeightKg, 1_000, sourceIndex, source.quantity, offset, quantity),
      manualCbm: boxMeasurement(measurements.manualCbm, 1_000_000, sourceIndex, source.quantity, offset, quantity),
    }
    pieces.push({ quantity, ...packaging, ...estimateChinaOutboundBoxDimensions(packaging) })
    remaining -= quantity
    offset = 0
    sourceIndex = (sourceIndex + 1) % sourceBoxes.length
  }
  return pieces
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
