'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  updateOrderStatus,
  holdOrder,
  releaseOrder,
  bulkUpdateStatus,
  forceBulkUpdateStatus,
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
  revalidateTag('orders', 'max')
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
  revalidateTag('orders', 'max')
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
  revalidateTag('orders', 'max')
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
  revalidateTag('orders', 'max')
  return result
}

/**
 * Server action: selected orders manual status override.
 * This is intentionally "status only": no marketplace notification, no inventory side effects.
 */
export async function forceBulkChangeStatusAction(
  orderIds: string[],
  newStatus: OrderStatus,
): Promise<{ updated: number; errors: Array<{ orderId: string; error: string }> }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { updated: 0, errors: [{ orderId: '', error: 'Unauthorized' }] }

  const result = await forceBulkUpdateStatus(user.id, orderIds, newStatus)
  revalidatePath('/orders')
  revalidateTag('orders', 'max')
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
  revalidateTag('orders', 'max')
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
  revalidateTag('orders', 'max')
  return result
}

/**
 * Server action: 주문 복사.
 * 원본 주문의 모든 정보(상품/수량/수취인/주문자/배송지/배송비 등)를 동일하게 복제하되,
 * 내부 UUID 는 새로 발급되며 마켓플레이스 unique 제약(marketplaceId+marketplaceOrderId)
 * 충돌을 피하기 위해 marketplaceOrderId 에 '-copy-XXXX' 접미를 붙인다.
 *
 * 복사본 초기 상태:
 * - status: 'new' (재출고 워크플로우 시작점)
 * - isHeld/holdReason/heldAt: 초기화
 * - claims/shipments: 복제하지 않음 (출고/클레임은 새 주문에서 새로 발생)
 * - 메모: 복제하지 않음
 */
export async function copyOrderAction(
  orderId: string,
): Promise<{ success: boolean; newOrderId?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthorized' }

  const { copyOrder } = await import('@/lib/orders/copy-order')
  const result = await copyOrder(orderId, user.id)
  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  return result
}

/**
 * Server action: 선택한 주문 일괄 삭제.
 * 관련 shipments/claims/shipmentGroupOrders 삭제, inventoryHistory 의 orderId 는 NULL.
 */
export async function bulkDeleteOrdersAction(
  orderIds: string[],
): Promise<{ deleted: number; errors: string[] }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { deleted: 0, errors: ['Unauthorized'] }
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return { deleted: 0, errors: ['선택된 주문이 없습니다.'] }
  }

  const { deleteOrdersForUser } = await import('@/lib/orders/delete-orders')
  const result = await deleteOrdersForUser(orderIds, user.id)
  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  return result
}
