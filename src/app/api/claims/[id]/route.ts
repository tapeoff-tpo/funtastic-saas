/**
 * PATCH /api/claims/[id] — update a claim's status
 * Body: { claimStatus: 'requested' | 'processing' | 'completed' | 'rejected' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { claims } from '@/lib/db/schema'

const VALID_STATUSES = ['requested', 'processing', 'completed', 'rejected'] as const
type ClaimStatus = (typeof VALID_STATUSES)[number]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { claimStatus?: ClaimStatus }
  if (!body.claimStatus || !VALID_STATUSES.includes(body.claimStatus)) {
    return NextResponse.json(
      { error: `유효한 상태: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
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
