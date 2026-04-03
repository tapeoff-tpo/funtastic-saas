/**
 * Ssgmall order status mapping to internal OrderStatus.
 *
 * Maps Ssgmall status codes to normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Ssgmall order status -> internal OrderStatus mapping */
export const SSGMALL_STATUS_MAP: Record<string, OrderStatus> = {
  ORDER_PLACED: 'new',
  ORDER_CONFIRMED: 'confirmed',
  READY_TO_SHIP: 'preparing',
  IN_TRANSIT: 'shipped',
  DELIVERED: 'delivered',
}

/**
 * Map a Ssgmall order status code to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapSsgmallStatus(code: string): OrderStatus {
  const mapped = SSGMALL_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ssgmall status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** Ssgmall claim type -> internal claim type mapping */
export const SSGMALL_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/**
 * Map a Ssgmall claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapSsgmallClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = SSGMALL_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ssgmall claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** Ssgmall claim status -> internal claim status mapping */
export const SSGMALL_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  REQUESTED: 'requested',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

/**
 * Map a Ssgmall claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapSsgmallClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = SSGMALL_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ssgmall claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
