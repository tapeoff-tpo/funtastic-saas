/**
 * 카카오톡스토어 order status mapping to internal OrderStatus.
 *
 * Maps 카카오톡스토어's status codes to our normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** 카카오톡스토어 order status -> internal OrderStatus mapping */
export const KAKAO_STORE_STATUS_MAP: Record<string, OrderStatus> = {
  PayComplete: 'new',
  ShippingRequest: 'new',
  ShippingWaiting: 'confirmed',
  ShippingProgress: 'shipped',
  ShippingComplete: 'delivered',
  PayCancelComplete: 'cancelled',
  ShippingCancelComplete: 'cancelled',
  ReturnCancelComplete: 'cancelled',
  ExchangeShippingComplete: 'delivered',
  ORDERED: 'new',
  ACCEPTED: 'confirmed',
  PREPARING: 'preparing',
  SHIPPING: 'shipped',
  DELIVERED: 'delivered',
}

/**
 * Map a 카카오톡스토어 order status to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapKakaoStoreStatus(code: string): OrderStatus {
  const mapped = KAKAO_STORE_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown 카카오톡스토어 status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** 카카오톡스토어 claim type -> internal claim type mapping */
export const KAKAO_STORE_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/**
 * Map a 카카오톡스토어 claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapKakaoStoreClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = KAKAO_STORE_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown 카카오톡스토어 claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** 카카오톡스토어 claim status -> internal claim status mapping */
export const KAKAO_STORE_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  REQUESTED: 'requested',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

/**
 * Map a 카카오톡스토어 claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapKakaoStoreClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = KAKAO_STORE_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown 카카오톡스토어 claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
