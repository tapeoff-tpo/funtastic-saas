import type { ChinaOutboundBoxSplitSavedState } from '@/lib/purchasing/china-outbound-save-state'
import type { ChinaShipmentDetailView } from './china-shipments-board'

/** Apply persisted packing rows without refetching names, photos, and the page. */
export function applyChinaShipmentBoxSplitSavedState(detail: ChinaShipmentDetailView | null, saved: ChinaOutboundBoxSplitSavedState): ChinaShipmentDetailView | null {
  if (!detail || detail.shipment.id !== saved.shipmentId || !detail.items.some((item) => item.id === saved.shipmentItemId)) return detail
  const boxes = new Map(detail.boxes.map((box) => [box.id, box]))
  for (const box of saved.boxes) if (box.shipmentId === saved.shipmentId) boxes.set(box.id, box)
  const reopenedPallets = new Set(saved.reopenedPalletIds)
  const otherMeasurements = new Map((saved.updatedOtherBoxItems ?? []).map((allocation) => [allocation.id, allocation]))
  return {
    ...detail,
    shipment: { ...detail.shipment, status: saved.shipmentStatus },
    items: detail.items.map((item) => item.id === saved.shipmentItemId
      ? { ...item, packedQuantity: saved.packedQuantity, boxSplitStatus: saved.boxSplitStatus } : item),
    boxes: [...boxes.values()],
    boxItems: [...detail.boxItems.filter((allocation) => allocation.shipmentItemId !== saved.shipmentItemId)
      .map((allocation) => otherMeasurements.get(allocation.id) ?? allocation),
      ...saved.boxItems.filter((allocation) => allocation.shipmentItemId === saved.shipmentItemId)],
    pallets: detail.pallets.map((pallet) => reopenedPallets.has(pallet.id) ? { ...pallet, completionStatus: 'in_progress' } : pallet),
  }
}
