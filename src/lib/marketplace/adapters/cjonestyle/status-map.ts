/**
 * CJ온스타일 order status mapping to internal OrderStatus.
 *
 * Maps CJ온스타일's status codes to our normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** CJ온스타일 order status -> internal OrderStatus mapping */
export const CJONESTYLE_STATUS_MAP: Record<string, OrderStatus> = {
  PAID: 'new',          // 결제완료
  배송지시: 'new',
  PREPARING: 'confirmed', // 상품준비중
  READY: 'preparing',   // 출고대기
  SHIPPED: 'shipped',   // 배송중
  출고: 'shipped',
  DELIVERED: 'delivered', // 배송완료
  배송완료: 'delivered',
}

/**
 * Map a CJ온스타일 order status to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapCjOnestyleStatus(code: string): OrderStatus {
  const mapped = CJONESTYLE_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown CJ온스타일 status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** CJ온스타일 claim type -> internal claim type mapping */
export const CJONESTYLE_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/**
 * Map a CJ온스타일 claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapCjOnestyleClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = CJONESTYLE_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown CJ온스타일 claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** CJ온스타일 claim status -> internal claim status mapping */
export const CJONESTYLE_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  REQUESTED: 'requested',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

/**
 * Map a CJ온스타일 claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapCjOnestyleClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = CJONESTYLE_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown CJ온스타일 claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
