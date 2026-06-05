/**
 * Shipment CRUD queries for use by actions and workers.
 *
 * Follows the established Drizzle query pattern from orders/queries.ts.
 * All queries run server-side.
 */

import { db } from '@/lib/db'
import { shipments, shipmentItems, orders, orderItems } from '@/lib/db/schema'
import { eq, and, inArray, sql, desc, lt, isNull, isNotNull } from 'drizzle-orm'
import type { InvoiceUploadStatus, ShipmentRecord } from './types'
import { normalizeTrackingNumber } from './tracking-number'

// ─── Held Shipments ──────────────────────────────────────────────

export interface HeldShipmentRow {
  // Order fields
  orderId: string
  marketplaceOrderId: string
  marketplaceId: string
  marketplaceName: string | null
  buyerName: string
  recipientName: string
  status: string
  isHeld: boolean
  holdReason: string | null
  // Shipment fields
  shipmentId: string
  trackingNumber: string
  carrierId: string
  carrierName: string
  uploadStatus: string
  shipmentCreatedAt: Date
  // First item (representative)
  productName: string | null
  quantity: number | null
}

/**
 * Get orders that have a tracking number but have not been shipped yet (shippedAt IS NULL).
 * These are "held" in limbo — tracking was assigned but the parcel hasn't left.
 * Returns up to 200 rows, ordered by shipment creation date descending.
 */
export async function getHeldShipments(userId: string): Promise<HeldShipmentRow[]> {
  const rows = await db
    .select({
      orderId: orders.id,
      marketplaceOrderId: orders.marketplaceOrderId,
      marketplaceId: orders.marketplaceId,
      marketplaceName: sql<string | null>`COALESCE(
        NULLIF(${orders.rawData}->'sabangnetRaw'->>'쇼핑몰명', ''),
        NULLIF(${orders.rawData}->'sabangnetSync'->>'mallName', ''),
        NULLIF(CASE
          WHEN ${orders.rawData}->>'mallName' IN ('사방넷', 'sabangnet', 'SABANGNET') THEN NULL
          ELSE ${orders.rawData}->>'mallName'
        END, ''),
        (
          SELECT COALESCE(
            NULLIF(o2.raw_data->'sabangnetRaw'->>'쇼핑몰명', ''),
            NULLIF(o2.raw_data->'sabangnetSync'->>'mallName', ''),
            NULLIF(CASE
              WHEN o2.raw_data->>'mallName' IN ('사방넷', 'sabangnet', 'SABANGNET') THEN NULL
              ELSE o2.raw_data->>'mallName'
            END, '')
          )
          FROM ${orders} o2
          WHERE o2.user_id = ${orders.userId}
            AND o2.marketplace_id = ${orders.marketplaceId}
            AND COALESCE(
              NULLIF(o2.raw_data->'sabangnetRaw'->>'쇼핑몰명', ''),
              NULLIF(o2.raw_data->'sabangnetSync'->>'mallName', ''),
              NULLIF(CASE
                WHEN o2.raw_data->>'mallName' IN ('사방넷', 'sabangnet', 'SABANGNET') THEN NULL
                ELSE o2.raw_data->>'mallName'
              END, '')
            ) IS NOT NULL
          ORDER BY o2.updated_at DESC
          LIMIT 1
        )
      )`,
      buyerName: orders.buyerName,
      recipientName: orders.recipientName,
      status: orders.status,
      isHeld: orders.isHeld,
      holdReason: orders.holdReason,
      shipmentId: shipments.id,
      trackingNumber: shipments.trackingNumber,
      carrierId: shipments.carrierId,
      carrierName: shipments.carrierName,
      uploadStatus: shipments.uploadStatus,
      shipmentCreatedAt: shipments.createdAt,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
    })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(shipments.userId, userId),
        isNull(shipments.shippedAt),
        isNotNull(shipments.trackingNumber),
      ),
    )
    .orderBy(desc(shipments.createdAt))
    .limit(200)

  // Deduplicate: keep one row per shipment (leftJoin with orderItems produces multiple rows)
  const seen = new Set<string>()
  const deduped: HeldShipmentRow[] = []
  for (const row of rows) {
    if (!seen.has(row.shipmentId)) {
      seen.add(row.shipmentId)
      deduped.push(row as HeldShipmentRow)
    }
  }
  return deduped
}

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
      normalizedTrackingNumber: normalizeTrackingNumber(data.trackingNumber),
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
        normalizedTrackingNumber: normalizeTrackingNumber(data.trackingNumber),
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
