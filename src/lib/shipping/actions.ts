'use server'

/**
 * Server actions for invoice upload queueing and held shipment management.
 *
 * These actions create shipment records and add BullMQ jobs
 * for asynchronous invoice upload to marketplace APIs.
 *
 * Also provides reprocessHeldOrder and updateHeldMemo for the
 * /shipping/held management page.
 */

import { db } from '@/lib/db'
import { orders, shipments } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
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

// ─── Held Shipment Actions ────────────────────────────────────────

/**
 * Reprocess a held order.
 *
 * Deletes the shipment record so the order returns to a no-tracking-number
 * state, resets the order status to 'preparing', and clears any hold flag.
 */
export async function reprocessHeldOrder(
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '인증이 필요합니다' }

    await db.transaction(async (tx) => {
      // Delete the shipment record for this order
      await tx
        .delete(shipments)
        .where(and(eq(shipments.orderId, orderId), eq(shipments.userId, user.id)))

      // Reset order status to preparing, clear hold
      await tx
        .update(orders)
        .set({
          status: 'preparing',
          isHeld: false,
          holdReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), eq(orders.userId, user.id)))
    })

    revalidatePath('/shipping/held')
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    }
  }
}

/**
 * Update the memo/note on a held order.
 *
 * Stores the memo in holdReason and marks the order as held so it surfaces
 * in the /shipping/held view.
 */
export async function updateHeldMemo(
  orderId: string,
  memo: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: '인증이 필요합니다' }

    await db
      .update(orders)
      .set({
        holdReason: memo || null,
        isHeld: true,
        heldAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.userId, user.id)))

    revalidatePath('/shipping/held')
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    }
  }
}
