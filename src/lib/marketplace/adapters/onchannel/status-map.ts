/**
 * Onchannel order status mapping to internal OrderStatus.
 *
 * Maps Onchannel status codes to normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Onchannel order status -> internal OrderStatus mapping */
export const ONCHANNEL_STATUS_MAP: Record<string, OrderStatus> = {
  PAID: 'new',
  CONFIRMED: 'confirmed',
  READY_TO_SHIP: 'preparing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
}

/**
 * Map an Onchannel order status code to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapOnchannelStatus(code: string): OrderStatus {
  const mapped = ONCHANNEL_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Onchannel status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** Onchannel claim type -> internal claim type mapping */
export const ONCHANNEL_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/**
 * Map an Onchannel claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapOnchannelClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = ONCHANNEL_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Onchannel claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** Onchannel claim status -> internal claim status mapping */
export const ONCHANNEL_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  REQUESTED: 'requested',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

/**
 * Map an Onchannel claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapOnchannelClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = ONCHANNEL_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Onchannel claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
