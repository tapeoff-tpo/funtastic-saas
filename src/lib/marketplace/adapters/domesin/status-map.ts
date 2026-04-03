/**
 * Domesin order status mapping to internal OrderStatus.
 *
 * TODO: Map real statuses when API documentation becomes available.
 */

import type { OrderStatus } from '@/lib/orders/types'

/**
 * Map a Domesin order status code to internal OrderStatus.
 * Always returns 'new' as a placeholder until real status codes are known.
 */
export function mapDomesinStatus(code: string): OrderStatus {
  console.warn(`[domesin] Placeholder status mapping for: ${code}, defaulting to 'new'`)
  return 'new'
}
