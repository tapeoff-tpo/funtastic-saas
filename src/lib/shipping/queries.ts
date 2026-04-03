/**
 * Shipment CRUD queries for use by actions and workers.
 *
 * Follows the established Drizzle query pattern from orders/queries.ts.
 * All queries run server-side.
 */

import { db } from '@/lib/db'
import { shipments, shipmentItems, orders } from '@/lib/db/schema'
import { eq, and, inArray, sql, desc, lt } from 'drizzle-orm'
import type { InvoiceUploadStatus, ShipmentRecord } from './types'

/**
 * Create a new shipment record.
 */
export async function createShipment(data: {
  orderId: string
  userId: string
  trackingNumber: string
  carrierId: string
  carrierName: string
}): Promise<ShipmentRecord> {
  const [created] = await db
    .insert(shipments)
    .values({
      orderId: data.orderId,
      userId: data.userId,
      trackingNumber: data.trackingNumber,
      carrierId: data.carrierId,
      carrierName: data.carrierName,
    })
    .returning()

  return created as unknown as ShipmentRecord
}

/**
 * Create a shipment with associated items in a transaction.
 */
export async function createShipmentWithItems(data: {
  orderId: string
  userId: string
  trackingNumber: string
  carrierId: string
  carrierName: string
  items: Array<{ orderItemId: string; quantity: number }>
}): Promise<ShipmentRecord> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(shipments)
      .values({
        orderId: data.orderId,
        userId: data.userId,
        trackingNumber: data.trackingNumber,
        carrierId: data.carrierId,
        carrierName: data.carrierName,
      })
      .returning()

    if (data.items.length > 0) {
      await tx.insert(shipmentItems).values(
        data.items.map((item) => ({
          shipmentId: created.id,
          orderItemId: item.orderItemId,
          quantity: item.quantity,
        })),
      )
    }

    return created as unknown as ShipmentRecord
  })
}

/**
 * Update shipment upload status.
 * Increments uploadAttempts, sets lastUploadAt, and optionally records error.
 */
export async function updateShipmentStatus(
  shipmentId: string,
  status: InvoiceUploadStatus,
  error?: string,
): Promise<void> {
  await db
    .update(shipments)
    .set({
      uploadStatus: status,
      uploadAttempts: sql`${shipments.uploadAttempts} + 1`,
      lastUploadAt: sql`now()`,
      marketplaceUploadError: error ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(shipments.id, shipmentId))
}

/**
 * Get all shipments for a given order, ordered by most recent first.
 */
export async function getShipmentsByOrderId(
  orderId: string,
): Promise<ShipmentRecord[]> {
  const rows = await db
    .select()
    .from(shipments)
    .where(eq(shipments.orderId, orderId))
    .orderBy(desc(shipments.createdAt))

  return rows as unknown as ShipmentRecord[]
}

/**
 * Get shipments pending upload (status 'pending' or 'failed' with < 3 attempts).
 * Joins with orders to include marketplaceId and connectionId context.
 */
export async function getPendingUploads(
  userId: string,
): Promise<ShipmentRecord[]> {
  const rows = await db
    .select()
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .where(
      and(
        eq(shipments.userId, userId),
        inArray(shipments.uploadStatus, ['pending', 'failed']),
        lt(shipments.uploadAttempts, 3),
      ),
    )
    .orderBy(desc(shipments.createdAt))

  return rows.map((r) => r.shipments) as unknown as ShipmentRecord[]
}

/**
 * Get a single shipment by ID.
 */
export async function getShipmentById(
  shipmentId: string,
): Promise<ShipmentRecord | null> {
  const [row] = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, shipmentId))

  return (row as unknown as ShipmentRecord) ?? null
}
