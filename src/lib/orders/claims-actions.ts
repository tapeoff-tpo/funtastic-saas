'use server'

/**
 * Claims server actions.
 *
 * Status updates and memo management for claims.
 * All actions require authentication and verify claim ownership.
 */

import { revalidatePath, revalidateTag, updateTag } from 'next/cache'
import { db } from '@/lib/db'
import { claims, orders } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import type { ClaimStatus } from './types'
import { isValidTransition } from './types'
import { updateOrderStatus } from './actions'

type ActionResult = { success: boolean; error?: string }

/**
 * Update the processing status of a claim.
 * Verifies claim belongs to the authenticated user before updating.
 */
export async function updateClaimStatus(
  claimId: string,
  status: ClaimStatus,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)

  if (status === 'completed') {
    const [claim] = await db
      .select({
        id: claims.id,
        orderId: claims.orderId,
        claimType: claims.claimType,
        orderStatus: orders.status,
      })
      .from(claims)
      .innerJoin(orders, eq(orders.id, claims.orderId))
      .where(and(
        eq(claims.id, claimId),
        eq(claims.userId, workspaceUserId),
        eq(orders.userId, workspaceUserId),
      ))
      .limit(1)

    if (!claim) {
      return { success: false, error: 'Claim not found or access denied' }
    }

    if (claim.claimType === 'cancel' && claim.orderStatus !== 'cancelled') {
      if (!isValidTransition(claim.orderStatus, 'cancelled')) {
        return { success: false, error: '이 주문은 취소로 변경할 수 없는 상태입니다.' }
      }
      const statusResult = await updateOrderStatus(claim.orderId, 'cancelled')
      if (!statusResult.success) {
        return { success: false, error: statusResult.error ?? '주문 취소 처리 실패' }
      }
    }
  }

  const [updated] = await db
    .update(claims)
    .set({
      claimStatus: status,
      updatedAt: new Date(),
    })
    .where(and(eq(claims.id, claimId), eq(claims.userId, workspaceUserId)))
    .returning({ id: claims.id, orderId: claims.orderId })

  if (!updated) {
    return { success: false, error: 'Claim not found or access denied' }
  }

  if (status === 'rejected' || status === 'withdrawn') {
    await db
      .update(orders)
      .set({ marketplaceStatus: null, updatedAt: new Date() })
      .where(and(eq(orders.id, updated.orderId), eq(orders.userId, workspaceUserId)))
  }

  revalidatePath('/orders/claims')
  revalidatePath('/cs')
  revalidateTag('orders', 'max')
  revalidatePath('/analytics')
  updateTag('analytics')
  return { success: true }
}

/**
 * Update the memo/note for a claim.
 * Overwrites the reason field with the admin-supplied memo.
 * Verifies claim belongs to the authenticated user before updating.
 */
export async function updateClaimMemo(
  claimId: string,
  memo: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)

  const [updated] = await db
    .update(claims)
    .set({
      reason: memo,
      updatedAt: new Date(),
    })
    .where(and(eq(claims.id, claimId), eq(claims.userId, workspaceUserId)))
    .returning({ id: claims.id })

  if (!updated) {
    return { success: false, error: 'Claim not found or access denied' }
  }

  revalidatePath('/orders/claims')
  revalidatePath('/cs')
  revalidateTag('orders', 'max')
  return { success: true }
}
