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
  /** 사용자에게 보여줄 8자리 internal_no — orders 와 LEFT JOIN 결과 */
  orderInternalNo: string | null
  createdAt: Date
}

export interface InventoryFilters {
  page?: number
  pageSize?: number
  /** 상품명 검색 (products.name ilike) */
  search?: string
  /** 품번코드 검색 (products.internalSku ilike) */
  productCode?: string
  /** 단품코드/옵션명 검색 (inventory.optionName 또는 inventory.sku ilike) */
  optionCode?: string
  /** 재고가 N개 이하인 항목만 조회 */
  maxStock?: number
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
