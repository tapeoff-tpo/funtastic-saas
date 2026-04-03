/**
 * Cafe24 order status mapping to internal OrderStatus.
 *
 * Maps Cafe24's status codes to our normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Cafe24 order status code -> internal OrderStatus mapping */
export const CAFE24_STATUS_MAP: Record<string, OrderStatus> = {
  N00: 'new',         // 입금전
  N10: 'confirmed',   // 결제완료
  N20: 'preparing',   // 상품준비중
  N30: 'shipped',     // 배송중
  N40: 'delivered',   // 배송완료
}

/**
 * Map a Cafe24 order status code to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapCafe24Status(code: string): OrderStatus {
  const mapped = CAFE24_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Cafe24 status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** Cafe24 claim type -> internal claim type mapping */
export const CAFE24_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  cancellation: 'cancel',
  return: 'return',
  exchange: 'exchange',
}

/**
 * Map a Cafe24 claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapCafe24ClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = CAFE24_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Cafe24 claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** Cafe24 claim status -> internal claim status mapping */
export const CAFE24_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  requested: 'requested',
  processing: 'processing',
  completed: 'completed',
  rejected: 'rejected',
}

/**
 * Map a Cafe24 claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapCafe24ClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = CAFE24_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Cafe24 claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
