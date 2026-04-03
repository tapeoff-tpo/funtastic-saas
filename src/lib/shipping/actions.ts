/**
 * Server actions for invoice upload queueing.
 *
 * These actions create shipment records and add BullMQ jobs
 * for asynchronous invoice upload to marketplace APIs.
 */

import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createShipment } from './queries'
import { getCarrierName } from './carrier-codes'
import { queueInvoiceUploadJob } from '@/lib/jobs/queues'

/**
 * Queue a single invoice upload.
 *
 * 1. Looks up the order to get marketplace context
 * 2. Creates a shipment record (status: pending)
 * 3. Adds a BullMQ job for async upload
 */
export async function queueInvoiceUpload(
  orderId: string,
  trackingNumber: string,
  carrierId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Look up order for marketplace context
    const [order] = await db
      .select({
        id: orders.id,
        marketplaceId: orders.marketplaceId,
        marketplaceOrderId: orders.marketplaceOrderId,
        connectionId: orders.connectionId,
        userId: orders.userId,
      })
      .from(orders)
      .where(eq(orders.id, orderId))

    if (!order) {
      return { success: false, error: `Order not found: ${orderId}` }
    }

    // Create shipment record
    const shipment = await createShipment({
      orderId,
      userId,
      trackingNumber,
      carrierId,
      carrierName: getCarrierName(carrierId),
    })

    // Queue upload job
    await queueInvoiceUploadJob({
      orderId,
      shipmentId: shipment.id,
      marketplaceId: order.marketplaceId,
      marketplaceOrderId: order.marketplaceOrderId,
      connectionId: order.connectionId,
      trackingNumber,
      carrierId,
      attempt: 1,
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Queue invoice uploads for multiple orders.
 *
 * Processes each order individually, collecting errors without
 * stopping the batch.
 */
export async function bulkQueueInvoiceUpload(
  uploadOrders: Array<{ orderId: string; trackingNumber: string; carrierId: string }>,
  userId: string,
): Promise<{ queued: number; errors: Array<{ orderId: string; error: string }> }> {
  let queued = 0
  const errors: Array<{ orderId: string; error: string }> = []

  for (const item of uploadOrders) {
    const result = await queueInvoiceUpload(
      item.orderId,
      item.trackingNumber,
      item.carrierId,
      userId,
    )

    if (result.success) {
      queued++
    } else {
      errors.push({ orderId: item.orderId, error: result.error || 'Unknown error' })
    }
  }

  return { queued, errors }
}
