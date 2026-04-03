/**
 * TenByTen (텐바이텐) order status mapping.
 *
 * // TODO: Map real statuses when API documentation becomes available
 */

import type { OrderStatus } from '@/lib/orders/types'

/**
 * Map a TenByTen order status code to internal OrderStatus.
 * Currently always returns 'new' as a placeholder.
 */
export function mapTenByTenStatus(code: string): OrderStatus {
  console.warn(`TenByTen status mapping not implemented, received: ${code}, defaulting to 'new'`)
  return 'new'
}
