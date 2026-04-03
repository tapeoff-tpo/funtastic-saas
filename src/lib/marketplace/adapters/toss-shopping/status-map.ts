/**
 * Toss Shopping (토스쇼핑) order status mapping.
 *
 * // TODO: Map real statuses when API documentation becomes available
 */

import type { OrderStatus } from '@/lib/orders/types'

/**
 * Map a Toss Shopping order status code to internal OrderStatus.
 * Currently always returns 'new' as a placeholder.
 */
export function mapTossShoppingStatus(code: string): OrderStatus {
  console.warn(`TossShopping status mapping not implemented, received: ${code}, defaulting to 'new'`)
  return 'new'
}
