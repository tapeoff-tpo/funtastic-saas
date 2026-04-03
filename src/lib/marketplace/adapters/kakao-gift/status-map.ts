/**
 * 카카오선물하기 order status mapping to internal OrderStatus.
 *
 * Maps 카카오선물하기's status codes to our normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** 카카오선물하기 order status -> internal OrderStatus mapping */
export const KAKAO_GIFT_STATUS_MAP: Record<string, OrderStatus> = {
  ORDERED: 'new',        // 주문완료
  ACCEPTED: 'confirmed', // 접수완료
  PREPARING: 'preparing', // 상품준비중
  SHIPPING: 'shipped',   // 배송중
  DELIVERED: 'delivered', // 배송완료
}

/**
 * Map a 카카오선물하기 order status to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapKakaoGiftStatus(code: string): OrderStatus {
  const mapped = KAKAO_GIFT_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown 카카오선물하기 status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** 카카오선물하기 claim type -> internal claim type mapping */
export const KAKAO_GIFT_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CANCEL: 'cancel',
  RETURN: 'return',
  EXCHANGE: 'exchange',
}

/**
 * Map a 카카오선물하기 claim type to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapKakaoGiftClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = KAKAO_GIFT_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown 카카오선물하기 claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** 카카오선물하기 claim status -> internal claim status mapping */
export const KAKAO_GIFT_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  REQUESTED: 'requested',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

/**
 * Map a 카카오선물하기 claim status to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapKakaoGiftClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = KAKAO_GIFT_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown 카카오선물하기 claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
