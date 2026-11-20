/** Persisted packing changes returned by a save without reloading the full page. */
export type ChinaOutboundBoxSplitSavedState = {
  shipmentId: string
  shipmentItemId: string
  shipmentStatus: 'draft' | 'packing' | 'ready' | 'dispatched' | 'cancelled'
  packedQuantity: number
  boxSplitStatus: 'in_progress' | 'completed'
  /** Merge these physical boxes by ID, including boxes no longer used by this item. */
  boxes: Array<{
    id: string
    shipmentId: string
    editable: boolean
    palletId: string | null
    boxNo: string
    status: string
    completionStatus: 'in_progress' | 'completed' | null
    note: string | null
    lengthCm: number | null
    widthCm: number | null
    heightCm: number | null
    grossWeightKg: number | null
    manualCbm?: number | null
    inventoryPackingGroupKey?: string | null
    inventoryPackingGroupBoxIndex?: number | null
  }>
  /** Replace this item's allocations only; other products in mixed boxes stay intact. */
  boxItems: Array<{ id: string; boxId: string; shipmentItemId: string; quantity: number; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; grossWeightKg?: number | null; manualCbm?: number | null }>
  updatedOtherBoxItems?: ChinaOutboundBoxSplitSavedState['boxItems']
  reopenedPalletIds: string[]
}
