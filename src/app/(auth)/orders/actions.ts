'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  updateOrderStatus,
  holdOrder,
  releaseOrder,
  bulkUpdateStatus,
} from '@/lib/orders/actions'
import {
  queueInvoiceUpload,
  bulkQueueInvoiceUpload,
} from '@/lib/shipping/actions'
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

/**
 * Server action: upload invoice for a single order.
 * Queues invoice upload via BullMQ worker.
 */
export async function uploadInvoiceAction(
  orderId: string,
  trackingNumber: string,
  carrierId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthorized' }
  const result = await queueInvoiceUpload(orderId, trackingNumber, carrierId, user.id)
  revalidatePath('/orders')
  return result
}

/**
 * Server action: bulk upload invoices for multiple orders.
 */
export async function bulkUploadInvoiceAction(
  orders: Array<{ orderId: string; trackingNumber: string; carrierId: string }>,
): Promise<{ queued: number; errors: Array<{ orderId: string; error: string }> }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { queued: 0, errors: [] }
  const result = await bulkQueueInvoiceUpload(orders, user.id)
  revalidatePath('/orders')
  return result
}
