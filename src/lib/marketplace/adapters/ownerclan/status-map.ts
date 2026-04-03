/**
 * Ownerclan order status mapping to internal OrderStatus.
 *
 * Maps Ownerclan status codes to normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Ownerclan order status -> internal OrderStatus mapping */
export const OWNERCLAN_STATUS_MAP: Record<string, OrderStatus> = {
  PAID: 'new',
  CONFIRMED: 'confirmed',
  READY_TO_SHIP: 'preparing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
}

/**
 * Map an Ownerclan order status code to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapOwnerclanStatus(code: string): OrderStatus {
  const mapped = OWNERCLAN_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ownerclan status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** Ownerclan claim type -> internal claim type mapping */
export const OWNERCLAN_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/**
 * Map an Ownerclan claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapOwnerclanClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = OWNERCLAN_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ownerclan claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** Ownerclan claim status -> internal claim status mapping */
export const OWNERCLAN_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  REQUESTED: 'requested',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

/**
 * Map an Ownerclan claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapOwnerclanClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = OWNERCLAN_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Ownerclan claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
