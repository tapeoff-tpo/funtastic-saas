'use server'

/**
 * Claims server actions.
 *
 * Status updates and memo management for claims.
 * All actions require authentication and verify claim ownership.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { claims } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import type { ClaimStatus } from './types'

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

  const [updated] = await db
    .update(claims)
    .set({
      claimStatus: status,
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
