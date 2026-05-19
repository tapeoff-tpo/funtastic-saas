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
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createShipment } from './queries'
import { getCarrierName } from './carrier-codes'
import { queueInvoiceUploadJob } from '@/lib/jobs/queues'
import { logOrderChange } from '@/lib/orders/change-log'

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
        status: orders.status,
        mappedAt: orders.mappedAt,
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
    if (order.status !== 'confirmed') {
      return { success: false, error: '확인 상태 주문만 송장 등록할 수 있습니다.' }
    }
    if (!order.mappedAt) {
      return { success: false, error: '매핑완료된 주문만 송장 등록할 수 있습니다.' }
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

    if (order.status === 'confirmed') {
      await db
        .update(orders)
        .set({
          status: 'preparing',
          preparingAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), eq(orders.userId, userId), eq(orders.status, 'confirmed')))
      await logOrderChange({
        orderId,
        userId,
        action: 'invoice.registered',
        title: '송장번호등록',
        description: `${getCarrierName(carrierId)} ${trackingNumber}`,
        before: { status: order.status },
        after: { status: 'preparing', trackingNumber, carrierId },
      })
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Register a tracking number locally without sending it to the marketplace.
 *
 * The separate "몰에 송장 전송" flow reads these shipment rows and performs
 * the actual marketplace upload later.
 */
export async function registerInvoice(
  orderId: string,
  trackingNumber: string,
  carrierId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const [order] = await db
      .select({
        id: orders.id,
        status: orders.status,
        mappedAt: orders.mappedAt,
        userId: orders.userId,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
      .limit(1)

    if (!order) {
      return { success: false, error: `Order not found: ${orderId}` }
    }
    if (order.status !== 'confirmed') {
      return { success: false, error: '확인 상태 주문만 송장 등록할 수 있습니다.' }
    }
    if (!order.mappedAt) {
      return { success: false, error: '매핑완료된 주문만 송장 등록할 수 있습니다.' }
    }

    const [existing] = await db
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(eq(shipments.orderId, orderId), eq(shipments.userId, userId)))
      .limit(1)

    if (existing) {
      await db.update(shipments).set({
        trackingNumber,
        carrierId,
        carrierName: getCarrierName(carrierId),
        uploadStatus: 'pending',
        marketplaceUploadError: null,
        updatedAt: new Date(),
      }).where(eq(shipments.id, existing.id))
    } else {
      await createShipment({
        orderId,
        userId,
        trackingNumber,
        carrierId,
        carrierName: getCarrierName(carrierId),
      })
    }

    if (order.status === 'confirmed') {
      await db
        .update(orders)
        .set({
          status: 'preparing',
          preparingAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), eq(orders.userId, userId), eq(orders.status, 'confirmed')))
      await logOrderChange({
        orderId,
        userId,
        action: 'invoice.registered',
        title: '송장번호등록',
        description: `${getCarrierName(carrierId)} ${trackingNumber}`,
        before: { status: order.status },
        after: { status: 'preparing', trackingNumber, carrierId },
      })
    }

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

export async function bulkRegisterInvoice(
  uploadOrders: Array<{ orderId: string; trackingNumber: string; carrierId: string }>,
  userId: string,
): Promise<{ queued: number; errors: Array<{ orderId: string; error: string }> }> {
  let queued = 0
  const errors: Array<{ orderId: string; error: string }> = []

  for (const item of uploadOrders) {
    const result = await registerInvoice(
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
          preparingAt: new Date(),
          isHeld: false,
          holdReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), eq(orders.userId, user.id)))
    })

    revalidatePath('/shipping/held')
    revalidateTag('orders', 'max')
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
    revalidateTag('orders', 'max')
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    }
  }
}
