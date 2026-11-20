import { planAutomaticBoxSplit } from './china-outbound-auto-packing'
import { dimensionNumber, estimateChinaOutboundBoxDimensions } from './china-outbound-dimensions'
import {
  normalizeChinaInventoryPackingGroup,
  proportionalInventoryPackingShare,
  type ChinaInventoryPackingGroup,
} from './china-inventory-packing-group'

export type MixedInventoryPackingPiece = {
  sourceBoxIndex: number
  quantity: number
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
  grossWeightKg: number | null
  manualCbm: number | null
}

/** Options occupy stable ranges in one shared source-carton plan. Measurements
 * are shares of the whole group, while dimensions describe the physical box. */
export function planMixedInventoryPacking(input: {
  group: ChinaInventoryPackingGroup
  memberReferenceQuantity: number
  quantity: number
  consumedQuantity?: number
}): MixedInventoryPackingPiece[] {
  const group = normalizeChinaInventoryPackingGroup(input.group)
  const consumed = input.consumedQuantity ?? 0
  if (!group || group.totalBoxCount > 5_000 || group.totalBoxCount > group.referenceQuantity
    || !Number.isSafeInteger(input.memberReferenceQuantity) || input.memberReferenceQuantity < 1
    || !Number.isSafeInteger(input.quantity) || input.quantity < 1
    || !Number.isSafeInteger(consumed) || consumed < 0 || !Number.isSafeInteger(consumed + input.quantity)
    || group.memberStartQuantity + input.memberReferenceQuantity > group.referenceQuantity) return []

  let start = 0
  const sources = planAutomaticBoxSplit(group.referenceQuantity, { boxCount: group.totalBoxCount }, []).map((box, index) => {
    const source = { start, end: start + box.quantity, quantity: box.quantity, index }
    start = source.end
    return source
  })
  const measuredSide = (value: number | null) => {
    const number = dimensionNumber(value)
    return number == null || number < 0.01 || number > 9_999_999.99 ? null : Math.round(number * 100) / 100
  }
  const physicalDimensions = sources.map((source) => {
    const manualCbm = proportionalInventoryPackingShare(group.manualCbm, group.referenceQuantity, source.start, source.quantity, 1_000_000)
    const dimensions = { lengthCm: measuredSide(group.lengthCm), widthCm: measuredSide(group.widthCm), heightCm: measuredSide(group.heightCm) }
    return { ...dimensions, ...estimateChinaOutboundBoxDimensions({ ...dimensions, manualCbm }) }
  })

  let cursor = consumed
  let remaining = input.quantity
  const pieces: MixedInventoryPackingPiece[] = []
  while (remaining > 0) {
    if (pieces.length >= 5_000) return []
    const cycle = Math.floor(cursor / input.memberReferenceQuantity)
    const memberOffset = cursor % input.memberReferenceQuantity
    const groupOffset = group.memberStartQuantity + memberOffset
    let low = 0, high = sources.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (groupOffset < sources[middle].end) high = middle
      else low = middle + 1
    }
    const source = sources[low]
    const quantity = Math.min(remaining, source.end - groupOffset, input.memberReferenceQuantity - memberOffset)
    const sourceBoxIndex = cycle * group.totalBoxCount + source.index
    if (quantity < 1 || !Number.isSafeInteger(sourceBoxIndex)) return []
    pieces.push({
      sourceBoxIndex, quantity, ...physicalDimensions[source.index],
      grossWeightKg: proportionalInventoryPackingShare(group.grossWeightKg, group.referenceQuantity, groupOffset, quantity, 1_000),
      manualCbm: proportionalInventoryPackingShare(group.manualCbm, group.referenceQuantity, groupOffset, quantity, 1_000_000),
    })
    cursor += quantity
    remaining -= quantity
  }
  return pieces
}
