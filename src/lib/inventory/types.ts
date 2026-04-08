/**
 * Inventory domain types and constants.
 *
 * Defines adjustment reasons, record interfaces, and Korean labels
 * for the inventory management system.
 */

export type AdjustmentReason =
  | 'incoming'
  | 'defective'
  | 'physical_count'
  | 'return'
  | 'order_ship'
  | 'order_cancel'
  | 'other'

export interface InventoryRecord {
  id: string
  userId: string
  sku: string
  productName: string
  warehouseZone: string | null
  sectorCode: string | null
  totalStock: number
  reservedStock: number
  availableStock: number
  createdAt: Date
  updatedAt: Date
}

export interface InventoryHistoryRecord {
  id: string
  inventoryId: string
  userId: string
  adjustmentReason: AdjustmentReason
  delta: number
  previousTotal: number
  newTotal: number
  note: string | null
  orderId: string | null
  createdAt: Date
}

export interface InventoryFilters {
  page?: number
  pageSize?: number
  search?: string
  sort?: string
  order?: 'asc' | 'desc'
  warehouseZone?: string
}

/** Korean labels for adjustment reasons */
export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  incoming: '입고',
  defective: '불량',
  physical_count: '실사',
  return: '반품복구',
  order_ship: '출고차감',
  order_cancel: '주문취소복구',
  other: '기타',
}
