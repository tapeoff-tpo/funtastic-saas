/**
 * Order business logic actions.
 *
 * Status transitions, hold/release management, and bulk operations.
 * All actions validate business rules before modifying data.
 */

import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { OrderStatus } from './types'
import { isValidTransition } from './types'
import { deductForOrder, restoreForOrder } from '@/lib/inventory/actions'
import { lockOrderItemsForOrders } from './locking'
import { logOrderChange, logOrderChanges } from './change-log'

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
        // 출고준비 전환 시점 기록 — 상세 페이지의 '출고준비일자' 표시용.
        // 다른 상태 전환은 기록하지 않으므로 undefined 분기.
        ...(newStatus === 'preparing' ? { preparingAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))
    await logOrderChange({
      orderId,
      userId: order.userId,
      action: 'status.changed',
      title: '주문상태변경',
      description: `${order.status} → ${newStatus}`,
      before: { status: order.status },
      after: { status: newStatus },
    }, tx)

    // Inventory hooks: auto-deduct on ship, auto-restore on cancel from shipped/delivering
    if (newStatus === 'shipped') {
      await lockOrderItemsForOrders(tx, order.userId, [orderId])
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

/**
 * Manual status override for admin/user operations.
 *
 * Unlike updateOrderStatus(), this intentionally does not validate workflow
 * direction and does not trigger marketplace calls or inventory side effects.
 * It is used for correction cases such as 출고대기 → 신규.
 */
export async function forceBulkUpdateStatus(
  userId: string,
  orderIds: string[],
  newStatus: OrderStatus,
): Promise<{ updated: number; errors: Array<{ orderId: string; error: string }> }> {
  const uniqueIds = Array.from(new Set(orderIds.filter(Boolean)))
  if (uniqueIds.length === 0) return { updated: 0, errors: [] }

  const ownedOrders = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(eq(orders.userId, userId), inArray(orders.id, uniqueIds)))

  const ownedIds = new Set(ownedOrders.map((order) => order.id))
  const errors = uniqueIds
    .filter((id) => !ownedIds.has(id))
    .map((orderId) => ({ orderId, error: 'Order not found' }))

  if (ownedOrders.length === 0) return { updated: 0, errors }

  const orderIdsToUpdate = ownedOrders.map((order) => order.id)
  const result = await db.transaction(async (tx) => {
    const updatedOrders = await tx
      .update(orders)
      .set({
        status: newStatus,
        previousStatus: null,
        isHeld: false,
        holdReason: null,
        heldAt: null,
        preparingAt: newStatus === 'preparing' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.userId, userId), inArray(orders.id, orderIdsToUpdate)))
      .returning({ id: orders.id })

    await logOrderChanges(ownedOrders.map((order) => ({
      orderId: order.id,
      userId,
      action: 'status.changed',
      title: '주문상태변경',
      description: `${order.status} → ${newStatus}`,
      before: { status: order.status },
      after: { status: newStatus },
      metadata: { source: 'manual-bulk' },
    })), tx)

    if (newStatus === 'shipped') {
      await lockOrderItemsForOrders(tx, userId, updatedOrders.map((order) => order.id))
    }

    return updatedOrders
  })

  return { updated: result.length, errors }
}
