/**
 * Domeggook order status mapping to internal OrderStatus.
 *
 * Maps Korean status strings from the Domeggook API to normalized statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** Domeggook order status -> internal OrderStatus mapping */
export const DOMEGGOOK_STATUS_MAP: Record<string, OrderStatus> = {
  '결제완료': 'new',
  '상품준비중': 'confirmed',
  '배송준비': 'preparing',
  '배송중': 'shipped',
  '배송완료': 'delivered',
}

/**
 * Map a Domeggook order status code to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapDomeggookStatus(code: string): OrderStatus {
  const mapped = DOMEGGOOK_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Domeggook status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** Domeggook claim type -> internal claim type mapping */
export const DOMEGGOOK_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  '취소': 'cancel',
  '반품': 'return',
  '교환': 'exchange',
}

/**
 * Map a Domeggook claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapDomeggookClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = DOMEGGOOK_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Domeggook claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** Domeggook claim status -> internal claim status mapping */
export const DOMEGGOOK_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  '접수': 'requested',
  '처리중': 'processing',
  '완료': 'completed',
  '거부': 'rejected',
}

/**
 * Map a Domeggook claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapDomeggookClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = DOMEGGOOK_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown Domeggook claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
