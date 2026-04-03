'use server'

import { revalidatePath } from 'next/cache'
import {
  updateOrderStatus,
  holdOrder,
  releaseOrder,
  bulkUpdateStatus,
} from '@/lib/orders/actions'
import type { OrderStatus } from '@/lib/orders/types'

/**
 * Server action: change a single order's status.
 * Wraps updateOrderStatus with cache revalidation.
 */
export async function changeStatusAction(
  orderId: string,
  newStatus: OrderStatus,
): Promise<{ success: boolean; error?: string }> {
  const result = await updateOrderStatus(orderId, newStatus)
  revalidatePath('/orders')
  return result
}

/**
 * Server action: hold an order with a reason.
 * Validates reason is non-empty before calling business logic.
 */
export async function holdOrderAction(
  orderId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const trimmed = reason.trim()
  if (!trimmed) {
    return { success: false, error: 'Hold reason is required' }
  }
  const result = await holdOrder(orderId, trimmed)
  revalidatePath('/orders')
  return result
}

/**
 * Server action: release a held order back to its previous status.
 */
export async function releaseOrderAction(
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await releaseOrder(orderId)
  revalidatePath('/orders')
  return result
}

/**
 * Server action: bulk status change for multiple orders.
 * Returns count of updated orders and per-order errors.
 */
export async function bulkChangeStatusAction(
  orderIds: string[],
  newStatus: OrderStatus,
): Promise<{ updated: number; errors: Array<{ orderId: string; error: string }> }> {
  const result = await bulkUpdateStatus(orderIds, newStatus)
  revalidatePath('/orders')
  return result
}
