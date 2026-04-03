/**
 * ESM Trading API order status mapping to internal OrderStatus.
 *
 * Maps ESM's status values to normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning (Pitfall 4).
 */

import type { OrderStatus } from '@/lib/orders/types'

/** ESM order status -> internal OrderStatus mapping */
export const ESM_STATUS_MAP: Record<string, OrderStatus> = {
  ORDER_RECEIVED: 'new',        // 주문접수
  PAYMENT_COMPLETE: 'new',      // 결제완료
  PRODUCT_PREPARE: 'preparing', // 상품준비중
  DELIVERING: 'shipped',        // 배송중
  DELIVERY_COMPLETE: 'delivered', // 배송완료
}

/**
 * Map an ESM status string to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapEsmStatus(esmStatus: string): OrderStatus {
  const mapped = ESM_STATUS_MAP[esmStatus]
  if (!mapped) {
    console.warn(`Unknown ESM status: ${esmStatus}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** ESM claim type -> internal claim type mapping */
export const ESM_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/**
 * Map an ESM claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapEsmClaimType(claimType: string): 'cancel' | 'return' | 'exchange' {
  const mapped = ESM_CLAIM_TYPE_MAP[claimType]
  if (!mapped) {
    console.warn(`Unknown ESM claim type: ${claimType}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** ESM claim status -> internal claim status mapping */
export const ESM_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  CLAIM_REQUESTED: 'requested',     // 클레임 접수
  CLAIM_PROCESSING: 'processing',   // 처리중
  CLAIM_COMPLETED: 'completed',     // 처리완료
  CLAIM_REJECTED: 'rejected',       // 거부
  RETURN_REQUESTED: 'requested',    // 반품접수
  RETURN_COLLECTING: 'processing',  // 수거중
  RETURN_COMPLETED: 'completed',    // 반품완료
  CANCEL_REQUESTED: 'requested',    // 취소접수
  CANCEL_COMPLETED: 'completed',    // 취소완료
}

/**
 * Map an ESM claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapEsmClaimStatus(status: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = ESM_CLAIM_STATUS_MAP[status]
  if (!mapped) {
    console.warn(`Unknown ESM claim status: ${status}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
