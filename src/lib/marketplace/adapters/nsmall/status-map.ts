/**
 * NS Mall order status mapping to internal OrderStatus.
 *
 * TODO: Map real statuses when API documentation becomes available.
 */

import type { OrderStatus } from '@/lib/orders/types'

/**
 * Map an NS Mall order status code to internal OrderStatus.
 * Always returns 'new' as a placeholder until real status codes are known.
 */
export function mapNsmallStatus(code: string): OrderStatus {
  console.warn(`[nsmall] Placeholder status mapping for: ${code}, defaulting to 'new'`)
  return 'new'
}
