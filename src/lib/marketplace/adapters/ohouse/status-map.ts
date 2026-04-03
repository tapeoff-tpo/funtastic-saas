/**
 * Ohouse order status mapping to internal OrderStatus.
 *
 * Maps Ohouse status codes to our normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Ohouse order status -> internal OrderStatus mapping */
export const OHOUSE_STATUS_MAP: Record<string, OrderStatus> = {
  PAID: 'new',
  PREPARING: 'preparing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
}

/**
 * Map an Ohouse order status code to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapOhouseStatus(code: string): OrderStatus {
  const mapped = OHOUSE_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ohouse status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** Ohouse claim type -> internal claim type mapping */
export const OHOUSE_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/**
 * Map an Ohouse claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapOhouseClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = OHOUSE_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ohouse claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** Ohouse claim status -> internal claim status mapping */
export const OHOUSE_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  REQUESTED: 'requested',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

/**
 * Map an Ohouse claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapOhouseClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = OHOUSE_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ohouse claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
