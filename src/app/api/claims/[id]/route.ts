/**
 * PATCH /api/claims/[id] — update a claim's status
 * Body: { claimStatus: 'requested' | 'processing' | 'completed' | 'rejected' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, or, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { claims, orders } from '@/lib/db/schema'
import { completeReturnClaim, getReturnableItemsForClaim } from '@/lib/inventory/actions'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { updateOrderStatus } from '@/lib/orders/actions'
import { isValidTransition } from '@/lib/orders/types'

const VALID_STATUSES = ['requested', 'processing', 'completed', 'rejected', 'withdrawn'] as const
type ClaimStatus = (typeof VALID_STATUSES)[number]
type ReasonHistoryEntry = { reason: string; registeredAt: string }

function getReasonHistory(rawData: Record<string, unknown> | null, requestedAt: Date): ReasonHistoryEntry[] {
  const stored = rawData?.reasonHistory
  if (Array.isArray(stored)) {
    const parsed = stored.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const row = entry as { reason?: unknown; registeredAt?: unknown }
      if (typeof row.reason !== 'string' || !row.reason.trim() || typeof row.registeredAt !== 'string') return []
      return [{ reason: row.reason.trim(), registeredAt: row.registeredAt }]
    })
    if (parsed.length > 0) return parsed
  }

  const originalReason = rawData?.originalReason
  if (typeof originalReason !== 'string' || !originalReason.trim()) return []
  const registeredAt = typeof rawData?.reasonRegisteredAt === 'string'
    ? rawData.reasonRegisteredAt
    : requestedAt.toISOString()
  return [{ reason: originalReason.trim(), registeredAt }]
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const items = await getReturnableItemsForClaim(workspaceUserId, id)
  return NextResponse.json({ items })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const body = (await req.json()) as {
    claimStatus?: ClaimStatus
    requestReason?: string
    returnCompletion?: {
      quantities?: Array<{ sku: string; availableQuantity: number; defectiveQuantity: number }>
    }
  }

  if (typeof body.requestReason === 'string') {
    const requestReason = body.requestReason.trim()
    if (!requestReason) {
      return NextResponse.json({ error: '접수 사유를 입력해주세요.' }, { status: 400 })
    }

    const [claim] = await db
      .select({ id: claims.id, rawData: claims.rawData, requestedAt: claims.requestedAt })
      .from(claims)
      .where(and(eq(claims.id, id), eq(claims.userId, workspaceUserId)))
      .limit(1)
    if (!claim) {
      return NextResponse.json({ error: '클레임을 찾을 수 없습니다.' }, { status: 404 })
    }

    const linkedOriginalClaimId = claim.rawData && typeof claim.rawData === 'object'
      ? (claim.rawData as { originalClaimId?: unknown }).originalClaimId
      : null
    const originalClaimId = typeof linkedOriginalClaimId === 'string' ? linkedOriginalClaimId : claim.id
    const reasonRegisteredAt = new Date().toISOString()
    const reasonHistory = [
      ...getReasonHistory(claim.rawData, claim.requestedAt),
      { reason: requestReason, registeredAt: reasonRegisteredAt },
    ]
    const reasonData = JSON.stringify({ reasonHistory })

    await db
      .update(claims)
      .set({
        rawData: sql`COALESCE(${claims.rawData}, '{}'::jsonb) || ${reasonData}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(claims.userId, workspaceUserId),
        or(
          eq(claims.id, originalClaimId),
          sql`${claims.rawData}->>'originalClaimId' = ${originalClaimId}`,
        ),
      ))

    return NextResponse.json({ success: true, reasonHistory })
  }

  if (!body.claimStatus || !VALID_STATUSES.includes(body.claimStatus)) {
    return NextResponse.json(
      { error: `유효한 상태: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  if (body.claimStatus === 'completed') {
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
        eq(claims.id, id),
        eq(claims.userId, workspaceUserId),
        eq(orders.userId, workspaceUserId),
      ))
      .limit(1)

    if (!claim) {
      return NextResponse.json({ error: '클레임을 찾을 수 없습니다.' }, { status: 404 })
    }

    if (claim.claimType === 'cancel' && claim.orderStatus !== 'cancelled') {
      if (!isValidTransition(claim.orderStatus, 'cancelled')) {
        return NextResponse.json({ error: '이 주문은 취소로 변경할 수 없는 상태입니다.' }, { status: 400 })
      }
      const statusResult = await updateOrderStatus(claim.orderId, 'cancelled')
      if (!statusResult.success) {
        return NextResponse.json({ error: statusResult.error ?? '주문 취소 처리 실패' }, { status: 400 })
      }
    }
  }

  if (body.claimStatus === 'completed' && body.returnCompletion) {
    const quantities = body.returnCompletion.quantities
    if (!Array.isArray(quantities)) {
      return NextResponse.json({ error: '반품완료 처리 정보가 올바르지 않습니다.' }, { status: 400 })
    }

    const result = await completeReturnClaim(workspaceUserId, id, quantities)
    if (!result.success) {
      return NextResponse.json({ error: result.error ?? '반품완료 처리 실패' }, { status: 400 })
    }
    return NextResponse.json({ success: true, claim: { id, claimStatus: 'completed' } })
  }

  const updated = await db
    .update(claims)
    .set({ claimStatus: body.claimStatus, updatedAt: new Date() })
    .where(and(eq(claims.id, id), eq(claims.userId, workspaceUserId)))
    .returning({ id: claims.id, orderId: claims.orderId, claimStatus: claims.claimStatus })

  if (updated.length === 0) {
    return NextResponse.json({ error: '클레임을 찾을 수 없습니다.' }, { status: 404 })
  }

  if (body.claimStatus === 'rejected' || body.claimStatus === 'withdrawn') {
    await db
      .update(orders)
      .set({ marketplaceStatus: null, updatedAt: new Date() })
      .where(and(eq(orders.id, updated[0].orderId), eq(orders.userId, workspaceUserId)))
  }

  return NextResponse.json({ success: true, claim: updated[0] })
}
