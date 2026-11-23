import { calculateChinaOutboundBoxCbm, type ChinaOutboundBoxDimensions } from './china-outbound-dimensions'
import { calculateChinaOutboundPalletWeight } from './china-outbound-pallet-weight'

type Box = ChinaOutboundBoxDimensions & { id: string; palletId: string | null; grossWeightKg?: string | number | null }
type Pallet = ChinaOutboundBoxDimensions & { id: string; tareWeightKg?: string | number | null }

/** Physical shipment totals: palletized boxes contribute through their pallet, once. */
export function chinaOutboundFinalTotals(pallets: Pallet[], boxes: Box[]) {
  const physicalBoxes = [...new Map(boxes.map((box) => [box.id, box])).values()]
  const usedPallets = [...new Map(pallets.map((pallet) => [pallet.id, pallet])).values()].filter((pallet) => physicalBoxes.some((box) => box.palletId === pallet.id))
  const palletIds = new Set(usedPallets.map((pallet) => pallet.id))
  const loose = physicalBoxes.filter((box) => !box.palletId || !palletIds.has(box.palletId))
  const cbms = [...usedPallets, ...loose].map(calculateChinaOutboundBoxCbm)
  const weights = [...usedPallets.map((pallet) => calculateChinaOutboundPalletWeight(physicalBoxes.filter((box) => box.palletId === pallet.id), pallet.tareWeightKg).grossWeightKg), ...loose.map((box) => calculateChinaOutboundPalletWeight([box], 0).grossWeightKg)]
  return { palletCount: usedPallets.length, looseBoxCount: loose.length, totalBoxCount: physicalBoxes.length,
    cbm: cbms.some((value) => value == null) ? null : Math.round(cbms.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 1000000) / 1000000,
    weightKg: weights.some((value) => value == null) ? null : Math.round(weights.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 1000) / 1000 }
}
