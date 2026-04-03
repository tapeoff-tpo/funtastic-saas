/**
 * Tobizon (투비즈온) order status mapping.
 *
 * // TODO: Map real statuses when API documentation becomes available
 */

import type { OrderStatus } from '@/lib/orders/types'

/**
 * Map a Tobizon order status code to internal OrderStatus.
 * Currently always returns 'new' as a placeholder.
 */
export function mapTobizonStatus(code: string): OrderStatus {
  console.warn(`Tobizon status mapping not implemented, received: ${code}, defaulting to 'new'`)
  return 'new'
}
