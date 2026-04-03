/**
 * Order splitting into multiple shipments.
 *
 * Allows an order to be split so different items ship in different packages,
 * each with its own tracking number and carrier.
 */

import { db } from '@/lib/db'
import { orderItems } from '@/lib/db/schema'
import { eq, inArray, and } from 'drizzle-orm'
import { createShipmentWithItems } from './queries'
import type { ShipmentRecord } from './types'

export interface SplitDefinition {
  trackingNumber: string
  carrierId: string
  carrierName: string
  itemIds: string[]
}

/**
 * Split an order into multiple shipments, each with specific items.
 *
 * @param orderId - The order to split
 * @param userId - The user performing the split
 * @param splits - Array of split definitions with tracking info and item assignments
 * @returns Array of created shipment records
 * @throws Error if any itemIds don't belong to the given order
 */
export async function splitOrderToShipments(
  orderId: string,
  userId: string,
  splits: SplitDefinition[],
): Promise<ShipmentRecord[]> {
  // Collect all requested itemIds
  const allItemIds = splits.flatMap((s) => s.itemIds)

  // Validate all items belong to the order
  const validItems = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(
      and(
        eq(orderItems.orderId, orderId),
        inArray(orderItems.id, allItemIds),
      ),
    )

  const validIds = new Set(validItems.map((item) => item.id))
  const invalidIds = allItemIds.filter((id) => !validIds.has(id))

  if (invalidIds.length > 0) {
    throw new Error(
      `Items do not belong to order ${orderId}: ${invalidIds.join(', ')}`,
    )
  }

  // Create shipments in a transaction
  return db.transaction(async () => {
    const shipments: ShipmentRecord[] = []

    for (const split of splits) {
      const shipment = await createShipmentWithItems({
        orderId,
        userId,
        trackingNumber: split.trackingNumber,
        carrierId: split.carrierId,
        carrierName: split.carrierName,
        items: split.itemIds.map((itemId) => ({
          orderItemId: itemId,
          quantity: 1,
        })),
      })
      shipments.push(shipment)
    }

    return shipments
  })
}
