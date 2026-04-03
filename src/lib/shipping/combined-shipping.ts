/**
 * Combined shipping detection algorithm (합포장).
 *
 * Pure functions for grouping orders by buyer + address + date,
 * sub-grouping by fulfillment code, and splitting by maxPackQuantity.
 *
 * No database access -- takes data in, returns groups out.
 */

import { format } from 'date-fns'
import type { ShipmentGroup } from './types'

/** Minimal order shape needed for merge detection */
export interface OrderWithItems {
  id: string
  buyerName: string
  shippingAddress: {
    zipCode: string
    address1: string
    address2?: string
  } | null
  orderedAt: Date
  items: Array<{
    id: string
    fulfillmentCode?: string | null
    quantity: number
  }>
}

/**
 * Normalize an address into a comparable key.
 * Trims whitespace, collapses multiple spaces, joins components with pipe.
 */
export function normalizeAddress(address: {
  zipCode: string
  address1: string
  address2?: string
}): string {
  const zip = address.zipCode.trim()
  const addr1 = address.address1.trim().replace(/\s+/g, ' ')
  const addr2 = (address.address2 ?? '').trim().replace(/\s+/g, ' ')
  return `${zip}|${addr1}|${addr2}`
}

/**
 * Determine the fulfillment code for an order based on its items.
 * - All same code -> that code
 * - Mixed codes -> 'mixed'
 * - No code / null -> defaults to 'normal'
 */
export function getFulfillmentCode(
  items: Array<{ fulfillmentCode?: string | null; quantity: number }>,
): string {
  const codes = new Set(
    items.map((item) => item.fulfillmentCode || 'normal'),
  )
  if (codes.size === 0) return 'normal'
  if (codes.size === 1) return [...codes][0]
  return 'mixed'
}

/**
 * Find merge candidates among a set of orders.
 *
 * Algorithm (per research Pattern 2):
 * 1. Group by buyerName + normalizedAddress + orderDate
 * 2. Filter to groups with 2+ orders
 * 3. Sub-group each by fulfillmentCode
 * 4. Chunk sub-groups exceeding maxPackQuantity
 * 5. Only include sub-groups with 2+ orders
 *
 * @param orders - Orders with their items
 * @param maxPackQuantity - Maximum orders per shipment group (default 10)
 * @returns Array of ShipmentGroup merge candidates
 */
export function findMergeCandidates(
  orders: OrderWithItems[],
  maxPackQuantity: number = 10,
): ShipmentGroup[] {
  // Step 1: Group by buyer + address + date
  const primaryGroups = new Map<string, OrderWithItems[]>()

  for (const order of orders) {
    if (!order.shippingAddress) continue

    const addressKey = normalizeAddress(order.shippingAddress)
    const dateKey = format(order.orderedAt, 'yyyy-MM-dd')
    const groupKey = `${order.buyerName}|${addressKey}|${dateKey}`

    const group = primaryGroups.get(groupKey) ?? []
    group.push(order)
    primaryGroups.set(groupKey, group)
  }

  const result: ShipmentGroup[] = []

  for (const [groupKey, groupOrders] of primaryGroups) {
    // Step 2: Need 2+ orders to form a merge group
    if (groupOrders.length < 2) continue

    // Step 3: Sub-group by fulfillment code
    const subGroups = new Map<string, OrderWithItems[]>()
    for (const order of groupOrders) {
      const code = getFulfillmentCode(order.items)
      const sub = subGroups.get(code) ?? []
      sub.push(order)
      subGroups.set(code, sub)
    }

    // Step 4 & 5: Chunk and filter
    for (const [fulfillmentCode, subOrders] of subGroups) {
      if (subOrders.length < 2) continue

      // Chunk if exceeding maxPackQuantity
      const chunks = chunkArray(subOrders, maxPackQuantity)
      for (const chunk of chunks) {
        if (chunk.length < 2) continue

        result.push({
          groupKey: `${groupKey}|${fulfillmentCode}`,
          orders: chunk.map((o) => o.id),
          fulfillmentCode,
          suggestedAction: 'merge',
          reason: `${chunk.length} orders from same buyer to same address`,
        })
      }
    }
  }

  return result
}

/** Split an array into chunks of at most `size` elements */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
