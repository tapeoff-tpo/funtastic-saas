'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { claims, orders } from '@/lib/db/schema'
import {
  updateOrderStatus,
  holdOrder,
  releaseOrder,
  bulkUpdateStatus,
  forceBulkUpdateStatus,
} from '@/lib/orders/actions'
import {
  registerInvoice,
  bulkRegisterInvoice,
} from '@/lib/shipping/actions'
import type { OrderStatus } from '@/lib/orders/types'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { and, eq, inArray } from 'drizzle-orm'

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

  const result = await forceBulkUpdateStatus(await getWorkspaceUserId(user.id), orderIds, newStatus)
  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  return result
}

/**
 * Server action: selected orders manual claim classification.
 * This only makes the orders visible in 교환/반품 tabs; it does not create pickup/reship copies.
 */
export async function forceBulkClaimStatusAction(
  orderIds: string[],
  claimType: 'return' | 'exchange',
): Promise<{ updated: number; errors: Array<{ orderId: string; error: string }> }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { updated: 0, errors: [{ orderId: '', error: 'Unauthorized' }] }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const uniqueIds = Array.from(new Set(orderIds.filter(Boolean)))
  if (uniqueIds.length === 0) return { updated: 0, errors: [] }

  const ownedOrders = await db
    .select({
      id: orders.id,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
      internalNo: orders.internalNo,
    })
    .from(orders)
    .where(and(eq(orders.userId, workspaceUserId), inArray(orders.id, uniqueIds)))

  const ownedIds = new Set(ownedOrders.map((order) => order.id))
  const errors = uniqueIds
    .filter((id) => !ownedIds.has(id))
    .map((orderId) => ({ orderId, error: 'Order not found' }))

  if (ownedOrders.length === 0) return { updated: 0, errors }

  const inserted = await db
    .insert(claims)
    .values(ownedOrders.map((order) => ({
      orderId: order.id,
      userId: workspaceUserId,
      marketplaceId: order.marketplaceId,
      marketplaceClaimId: `manual-status-${claimType}-${order.id}`,
      claimType,
      claimStatus: 'requested' as const,
      reason: '주문상태변경',
      rawData: {
        source: 'manual-status-change',
        marketplaceOrderId: order.marketplaceOrderId,
        internalNo: order.internalNo,
      },
      requestedAt: new Date(),
      updatedAt: new Date(),
    })))
    .onConflictDoNothing()
    .returning({ id: claims.id })

  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  return { updated: inserted.length, errors }
}

/**
 * Server action: selected orders manual hold classification (미발송).
 */
export async function forceBulkHoldOrdersAction(
  orderIds: string[],
): Promise<{ updated: number; errors: Array<{ orderId: string; error: string }> }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { updated: 0, errors: [{ orderId: '', error: 'Unauthorized' }] }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const uniqueIds = Array.from(new Set(orderIds.filter(Boolean)))
  if (uniqueIds.length === 0) return { updated: 0, errors: [] }

  const ownedOrders = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(eq(orders.userId, workspaceUserId), inArray(orders.id, uniqueIds)))

  const ownedIds = new Set(ownedOrders.map((order) => order.id))
  const errors = uniqueIds
    .filter((id) => !ownedIds.has(id))
    .map((orderId) => ({ orderId, error: 'Order not found' }))

  const updatedOrders = await db.transaction(async (tx) => {
    const result: Array<{ id: string }> = []
    for (const order of ownedOrders) {
      const [updated] = await tx
        .update(orders)
        .set({
          isHeld: true,
          holdReason: '주문상태변경: 미발송',
          heldAt: new Date(),
          previousStatus: order.status,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id))
        .returning({ id: orders.id })
      if (updated) result.push(updated)
    }
    return result
  })

  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  return { updated: updatedOrders.length, errors }
}

/**
 * Server action: register invoice for a single order.
 * Stores the tracking number locally. Marketplace upload is handled separately.
 */
export async function uploadInvoiceAction(
  orderId: string,
  trackingNumber: string,
  carrierId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthorized' }
  const result = await registerInvoice(orderId, trackingNumber, carrierId, await getWorkspaceUserId(user.id))
  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  return result
}

/**
 * Server action: bulk register invoices for multiple orders.
 */
export async function bulkUploadInvoiceAction(
  orders: Array<{ orderId: string; trackingNumber: string; carrierId: string }>,
): Promise<{ queued: number; errors: Array<{ orderId: string; error: string }> }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { queued: 0, errors: [] }
  const result = await bulkRegisterInvoice(orders, await getWorkspaceUserId(user.id))
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
  const result = await copyOrder(orderId, await getWorkspaceUserId(user.id))
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
  const result = await deleteOrdersForUser(orderIds, await getWorkspaceUserId(user.id))
  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  return result
}

/**
 * Server action: super_admin 전용 출고 스냅샷 잠금 해제.
 * 잠금 해제 후에는 매핑/상품/재고 현재값이 다시 표시될 수 있다.
 */
export async function unlockOrderSnapshotsAction(
  orderIds: string[],
): Promise<{ unlocked: number; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { unlocked: 0, error: 'Unauthorized' }
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return { unlocked: 0, error: '선택된 주문이 없습니다.' }
  }

  const { unlockOrderItemsForOrders } = await import('@/lib/orders/locking')
  const result = await unlockOrderItemsForOrders(await getWorkspaceUserId(user.id), user.id, orderIds)
  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  return result
}
