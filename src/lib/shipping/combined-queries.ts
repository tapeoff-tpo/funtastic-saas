/**
 * Shipment group CRUD queries.
 *
 * Manages the lifecycle of combined shipping groups:
 * suggested -> confirmed/rejected -> shipped
 */

import { db } from '@/lib/db'
import {
  shipmentGroups,
  shipmentGroupOrders,
} from '@/lib/db/schema'
import { eq, and, sql, count } from 'drizzle-orm'
/** Status type matching shipmentGroupStatusEnum */
type ShipmentGroupStatus = 'suggested' | 'confirmed' | 'rejected' | 'shipped'

export interface ShipmentGroupWithCount {
  id: string
  userId: string
  groupKey: string
  status: string
  fulfillmentCode: string
  maxPackQuantity: number
  createdAt: Date
  updatedAt: Date
  orderCount: number
}

/**
 * Create a shipment group with associated orders in a transaction.
 */
export async function createShipmentGroup(data: {
  userId: string
  groupKey: string
  fulfillmentCode: string
  orderIds: string[]
}): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [group] = await tx
      .insert(shipmentGroups)
      .values({
        userId: data.userId,
        groupKey: data.groupKey,
        fulfillmentCode: data.fulfillmentCode,
      })
      .returning({ id: shipmentGroups.id })

    if (data.orderIds.length > 0) {
      await tx.insert(shipmentGroupOrders).values(
        data.orderIds.map((orderId) => ({
          shipmentGroupId: group.id,
          orderId,
        })),
      )
    }

    return { id: group.id }
  })
}

/**
 * Confirm a shipment group (approve for shipping).
 */
export async function confirmShipmentGroup(groupId: string): Promise<void> {
  await db
    .update(shipmentGroups)
    .set({
      status: 'confirmed',
      updatedAt: sql`now()`,
    })
    .where(eq(shipmentGroups.id, groupId))
}

/**
 * Reject a shipment group (orders will ship separately).
 */
export async function rejectShipmentGroup(groupId: string): Promise<void> {
  await db
    .update(shipmentGroups)
    .set({
      status: 'rejected',
      updatedAt: sql`now()`,
    })
    .where(eq(shipmentGroups.id, groupId))
}

/**
 * Get shipment groups with order counts, filtered by userId and optional status.
 */
export async function getShipmentGroups(
  userId: string,
  status?: string,
): Promise<ShipmentGroupWithCount[]> {
  const conditions = [eq(shipmentGroups.userId, userId)]
  if (status) {
    conditions.push(
      eq(shipmentGroups.status, status as any),
    )
  }

  const rows = await db
    .select({
      shipment_groups: shipmentGroups,
      order_count: count(shipmentGroupOrders.orderId),
    })
    .from(shipmentGroups)
    .leftJoin(
      shipmentGroupOrders,
      eq(shipmentGroupOrders.shipmentGroupId, shipmentGroups.id),
    )
    .where(and(...conditions))
    .groupBy(shipmentGroups.id)

  return rows.map((row) => ({
    id: row.shipment_groups.id,
    userId: row.shipment_groups.userId,
    groupKey: row.shipment_groups.groupKey,
    status: row.shipment_groups.status,
    fulfillmentCode: row.shipment_groups.fulfillmentCode,
    maxPackQuantity: row.shipment_groups.maxPackQuantity,
    createdAt: row.shipment_groups.createdAt,
    updatedAt: row.shipment_groups.updatedAt,
    orderCount: Number(row.order_count),
  }))
}

/**
 * Delete a shipment group. CASCADE deletes associated group_orders.
 */
export async function deleteShipmentGroup(groupId: string): Promise<void> {
  await db
    .delete(shipmentGroups)
    .where(eq(shipmentGroups.id, groupId))
}
