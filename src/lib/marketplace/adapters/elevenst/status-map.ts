/**
 * 11st order status mapping to internal OrderStatus.
 *
 * Maps 11st's numeric status codes to our normalized internal statuses.
 * Unknown statuses fall back to 'new' with a console warning.
 */

import type { OrderStatus } from '@/lib/orders/types'

/** 11st order status code -> internal OrderStatus mapping */
export const ELEVENST_STATUS_MAP: Record<string, OrderStatus> = {
  '202': 'new',        // 결제완료
  '301': 'confirmed',  // 상품준비중
  '302': 'preparing',  // 배송준비중
  '303': 'shipped',    // 배송중
  '304': 'delivered',  // 배송완료
}

/**
 * Map an 11st order status code to internal OrderStatus.
 * Returns 'new' as fallback for unknown statuses with console.warn.
 */
export function mapElevenstStatus(code: string): OrderStatus {
  const mapped = ELEVENST_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown 11st status: ${code}, defaulting to 'new'`)
    return 'new'
  }
  return mapped
}

/** 11st claim type code -> internal claim type mapping */
export const ELEVENST_CLAIM_TYPE_MAP: Record<string, 'cancel' | 'return' | 'exchange'> = {
  CNC: 'cancel',
  RTN: 'return',
  EXC: 'exchange',
}

/**
 * Map an 11st claim type code to internal claim type.
 * Returns 'cancel' as fallback.
 */
export function mapElevenstClaimType(code: string): 'cancel' | 'return' | 'exchange' {
  const mapped = ELEVENST_CLAIM_TYPE_MAP[code]
  if (!mapped) {
    console.warn(`Unknown 11st claim type: ${code}, defaulting to 'cancel'`)
    return 'cancel'
  }
  return mapped
}

/** 11st claim status code -> internal claim status mapping */
export const ELEVENST_CLAIM_STATUS_MAP: Record<string, 'requested' | 'processing' | 'completed' | 'rejected'> = {
  '100': 'requested',   // 접수
  '200': 'processing',  // 처리중
  '300': 'completed',   // 완료
  '400': 'rejected',    // 거부
}

/**
 * Map an 11st claim status code to internal claim status.
 * Returns 'requested' as fallback.
 */
export function mapElevenstClaimStatus(code: string): 'requested' | 'processing' | 'completed' | 'rejected' {
  const mapped = ELEVENST_CLAIM_STATUS_MAP[code]
  if (!mapped) {
    console.warn(`Unknown 11st claim status: ${code}, defaulting to 'requested'`)
    return 'requested'
  }
  return mapped
}
