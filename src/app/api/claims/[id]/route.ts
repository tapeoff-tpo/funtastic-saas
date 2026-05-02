/**
 * PATCH /api/claims/[id] — update a claim's status
 * Body: { claimStatus: 'requested' | 'processing' | 'completed' | 'rejected' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { claims } from '@/lib/db/schema'
import { completeReturnClaim, getReturnableItemsForClaim } from '@/lib/inventory/actions'

const VALID_STATUSES = ['requested', 'processing', 'completed', 'rejected'] as const
type ClaimStatus = (typeof VALID_STATUSES)[number]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items = await getReturnableItemsForClaim(user.id, id)
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

  const body = (await req.json()) as {
    claimStatus?: ClaimStatus
    returnCompletion?: {
      disposition?: 'available' | 'defective'
      quantities?: Array<{ sku: string; quantity: number }>
    }
  }
  if (!body.claimStatus || !VALID_STATUSES.includes(body.claimStatus)) {
    return NextResponse.json(
      { error: `유효한 상태: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  if (body.claimStatus === 'completed' && body.returnCompletion) {
    const disposition = body.returnCompletion.disposition
    const quantities = body.returnCompletion.quantities
    if ((disposition !== 'available' && disposition !== 'defective') || !Array.isArray(quantities)) {
      return NextResponse.json({ error: '반품완료 처리 정보가 올바르지 않습니다.' }, { status: 400 })
    }

    const result = await completeReturnClaim(user.id, id, disposition, quantities)
    if (!result.success) {
      return NextResponse.json({ error: result.error ?? '반품완료 처리 실패' }, { status: 400 })
    }
    return NextResponse.json({ success: true, claim: { id, claimStatus: 'completed' } })
  }

  const updated = await db
    .update(claims)
    .set({ claimStatus: body.claimStatus, updatedAt: new Date() })
    .where(and(eq(claims.id, id), eq(claims.userId, user.id)))
    .returning({ id: claims.id, claimStatus: claims.claimStatus })

  if (updated.length === 0) {
    return NextResponse.json({ error: '클레임을 찾을 수 없습니다.' }, { status: 404 })
  }

  return NextResponse.json({ success: true, claim: updated[0] })
}
