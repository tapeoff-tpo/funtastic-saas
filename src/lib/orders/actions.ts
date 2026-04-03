/**
 * Order business logic actions.
 *
 * Status transitions, hold/release management, and bulk operations.
 * All actions validate business rules before modifying data.
 */

import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { OrderStatus } from './types'
import { isValidTransition } from './types'
import { deductForOrder, restoreForOrder } from '@/lib/inventory/actions'

type ActionResult = { success: boolean; error?: string }

/**
 * Update order status with transition validation.
 * Rejects invalid transitions and held orders (per D-11).
 */
export async function updateOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    // Lock the row for update
    const [order] = await tx
      .select({
        id: orders.id,
        userId: orders.userId,
        status: orders.status,
        isHeld: orders.isHeld,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')

    if (!order) {
      return { success: false, error: 'Order not found' }
    }

    if (order.isHeld) {
      return { success: false, error: 'Cannot change status: order is held' }
    }

    if (!isValidTransition(order.status, newStatus)) {
      return {
        success: false,
        error: `Invalid transition from '${order.status}' to '${newStatus}'`,
      }
    }

    await tx
      .update(orders)
      .set({
        status: newStatus,
        previousStatus: order.status,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))

    // Inventory hooks: auto-deduct on ship, auto-restore on cancel from shipped/delivering
    if (newStatus === 'shipped') {
      await deductForOrder(tx, order.userId, orderId)
    } else if (
      newStatus === 'cancelled' &&
      (order.status === 'shipped' || order.status === 'delivering')
    ) {
      await restoreForOrder(tx, order.userId, orderId)
    }

    return { success: true }
  })
}

/**
 * Hold an order with a reason (per D-11).
 * Stores current status as previousStatus for later restoration.
 */
export async function holdOrder(
  orderId: string,
  reason: string,
): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        isHeld: orders.isHeld,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')

    if (!order) {
      return { success: false, error: 'Order not found' }
    }

    if (order.isHeld) {
      return { success: false, error: 'Order is already held' }
    }

    await tx
      .update(orders)
      .set({
        isHeld: true,
        holdReason: reason,
        heldAt: new Date(),
        previousStatus: order.status,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))

    return { success: true }
  })
}

/**
 * Release a held order, restoring previous status (per D-11).
 */
export async function releaseOrder(orderId: string): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        isHeld: orders.isHeld,
        previousStatus: orders.previousStatus,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')

    if (!order) {
      return { success: false, error: 'Order not found' }
    }

    if (!order.isHeld) {
      return { success: false, error: 'Order is not held' }
    }

    await tx
      .update(orders)
      .set({
        isHeld: false,
        holdReason: null,
        heldAt: null,
        status: order.previousStatus ?? order.status,
        previousStatus: null,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))

    return { success: true }
  })
}

/**
 * Bulk update status for multiple orders.
 * Validates each order individually, returns per-order results.
 */
export async function bulkUpdateStatus(
  orderIds: string[],
  newStatus: OrderStatus,
): Promise<{ updated: number; errors: Array<{ orderId: string; error: string }> }> {
  const errors: Array<{ orderId: string; error: string }> = []
  let updated = 0

  for (const orderId of orderIds) {
    const result = await updateOrderStatus(orderId, newStatus)
    if (result.success) {
      updated++
    } else {
      errors.push({ orderId, error: result.error ?? 'Unknown error' })
    }
  }

  return { updated, errors }
}
