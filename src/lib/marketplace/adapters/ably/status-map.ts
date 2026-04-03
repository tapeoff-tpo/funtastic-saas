/**
 * Ably order status mapping to internal OrderStatus.
 *
 * Maps Ably status codes to normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Ably order status -> internal OrderStatus mapping */
export const ABLY_STATUS_MAP: Record<string, OrderStatus> = {
  ORDERED: 'new',
  CONFIRMED: 'confirmed',
  PACKING: 'preparing',
  SHIPPING: 'shipped',
  COMPLETE: 'delivered',
}

/**
 * Map an Ably order status code to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapAblyStatus(code: string): OrderStatus {
  const mapped = ABLY_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ably status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** Ably claim type -> internal claim type mapping */
export const ABLY_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/**
 * Map an Ably claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapAblyClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = ABLY_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ably claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** Ably claim status -> internal claim status mapping */
export const ABLY_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  REQUESTED: 'requested',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

/**
 * Map an Ably claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapAblyClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = ABLY_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ably claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
