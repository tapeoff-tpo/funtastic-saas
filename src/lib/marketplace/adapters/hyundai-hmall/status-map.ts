/**
 * Hyundai Hmall order status mapping to internal OrderStatus.
 *
 * TODO: Map real statuses when API documentation becomes available.
 */

import type { OrderStatus } from '@/lib/orders/types'

/**
 * Map a Hyundai Hmall order status code to internal OrderStatus.
 * Always returns 'new' as a placeholder until real status codes are known.
 */
export function mapHyundaiHmallStatus(code: string): OrderStatus {
  console.warn(`[hyundai-hmall] Placeholder status mapping for: ${code}, defaulting to 'new'`)
  return 'new'
}
