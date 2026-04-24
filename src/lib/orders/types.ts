/**
 * Order domain types and business rules.
 *
 * Defines the order status workflow, Korean labels,
 * valid transitions, and filter interfaces for queries.
 */

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'preparing'
  | 'shipped'
  | 'delivering'
  | 'delivered'
  | 'cancelled'

export type ClaimType = 'cancel' | 'return' | 'exchange'

export type ClaimStatus = 'requested' | 'processing' | 'completed' | 'rejected'

/** Korean labels for order statuses (per D-07) */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: '신규',
  confirmed: '확인',
  preparing: '출고대기',
  shipped: '출고완료',
  delivering: '배송중',
  delivered: '배송완료',
  cancelled: '취소',
}

/**
 * Valid status transitions per D-07.
 * Terminal statuses (delivered, cancelled) have no valid next states.
 */
export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivering'],
  delivering: ['delivered'],
  delivered: [],
  cancelled: [],
}

/** Check if a status transition is valid */
export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export type MappingStatus = 'mapped' | 'partial' | 'unmapped'

/** 주문 처리 단계 (워크플로우) */
export type OrderStage =
  | 'prep'        // 출고 준비 (매핑 필요 ∪ 확정 대기) — 매핑 먼저, 그 다음 몰 통보
  | 'mapping'     // 매핑 필요 (prep의 하위)
  | 'confirm'     // 확정 대기 (prep의 하위, 신규 + 매핑완료)
  | 'invoice'     // 송장 발급 (주문확인, 송장 없음)
  | 'shipping'    // 출고 대기 (출고대기/준비중, 송장 있음)
  | 'done'        // 완료 (출고/배송중/배송완료)

/** Filter interface for order listing queries */
export interface OrderFilters {
  page?: number
  pageSize?: number
  /** Scope to a specific user — REQUIRED for production queries (security + perf). */
  userId?: string
  status?: OrderStatus
  marketplace?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  sort?: string
  order?: 'asc' | 'desc'
  claimType?: ClaimType
  mapping?: 'mapped' | 'unmapped'
  stage?: OrderStage
  /** Filter to only held (미발송) orders */
  isHeld?: boolean
}
