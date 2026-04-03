/**
 * Always (올웨이즈) order status mapping.
 *
 * // TODO: Map real statuses when API documentation becomes available
 */

import type { OrderStatus } from '@/lib/orders/types'

/**
 * Map an Always order status code to internal OrderStatus.
 * Currently always returns 'new' as a placeholder.
 */
export function mapAlwaysStatus(code: string): OrderStatus {
  console.warn(`Always status mapping not implemented, received: ${code}, defaulting to 'new'`)
  return 'new'
}
