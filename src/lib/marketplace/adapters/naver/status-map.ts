/**
 * Naver order status mapping to internal OrderStatus.
 *
 * Maps Naver Commerce API status values to normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning (Pitfall 4).
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Naver product order status -> internal OrderStatus mapping */
export const NAVER_STATUS_MAP: Record<string, OrderStatus> = {
  PAYMENT_WAITING: 'new',       // 결제대기
  PAYED: 'new',                 // 결제완료
  DELIVERING: 'delivering',     // 배송중
  DELIVERED: 'delivered',       // 배송완료
  PURCHASE_DECIDED: 'delivered', // 구매확정
  EXCHANGED: 'confirmed',       // 교환완료
  CANCELED: 'cancelled',        // 취소완료
  RETURNED: 'cancelled',        // 반품완료
  CANCEL_DONE: 'cancelled',     // 취소처리완료
}

/**
 * Map a Naver status string to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapNaverStatus(naverStatus: string): OrderStatus {
  const mapped = NAVER_STATUS_MAP[naverStatus]
  if (!mapped) {
    console.warn(`Unknown Naver status: ${naverStatus}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** Naver claim type mapping */
export const NAVER_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/** Naver claim status mapping */
export const NAVER_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  CANCEL_REQUEST: 'requested',
  CANCELING: 'processing',
  CANCEL_DONE: 'completed',
  CANCEL_REJECT: 'rejected',
  RETURN_REQUEST: 'requested',
  COLLECTING: 'processing',
  COLLECT_DONE: 'processing',
  RETURN_DONE: 'completed',
  RETURN_REJECT: 'rejected',
  EXCHANGE_REQUEST: 'requested',
  EXCHANGING: 'processing',
  EXCHANGE_DONE: 'completed',
  EXCHANGE_REJECT: 'rejected',
}

/**
 * Map a Naver claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapNaverClaimStatus(status: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = NAVER_CLAIM_STATUS_MAP[status]
  if (!mapped) {
    console.warn(`Unknown Naver claim status: ${status}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
