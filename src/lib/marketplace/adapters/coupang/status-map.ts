/**
 * Coupang order status mapping to internal OrderStatus.
 *
 * Maps Coupang's status values to our normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning (Pitfall 4).
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Coupang order status -> internal OrderStatus mapping */
export const COUPANG_STATUS_MAP: Record<string, OrderStatus> = {
  ACCEPT: 'new',           // 결제완료 -> 신규
  INSTRUCT: 'preparing',   // 상품준비중 -> 출고대기
  DEPARTURE: 'shipped',    // 배송지시 -> 출고완료
  DELIVERING: 'delivering', // 배송중
  FINAL_DELIVERY: 'delivered', // 배송완료
}

/**
 * Map a Coupang status string to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapCoupangStatus(coupangStatus: string): OrderStatus {
  const mapped = COUPANG_STATUS_MAP[coupangStatus]
  if (!mapped) {
    console.warn(`Unknown Coupang status: ${coupangStatus}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** Coupang return request status -> claim status mapping */
export const COUPANG_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  RECEIPT: 'requested',       // 접수
  RETURNS_APPROVED: 'processing', // 반품승인
  RETURNS_COMPLETED: 'completed', // 반품완료
  RETURNS_REJECTED: 'rejected',   // 반품거부
}

/**
 * Map a Coupang return status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapCoupangClaimStatus(status: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = COUPANG_CLAIM_STATUS_MAP[status]
  if (!mapped) {
    console.warn(`Unknown Coupang claim status: ${status}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
